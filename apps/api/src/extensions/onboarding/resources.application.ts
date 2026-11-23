import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import type { DataSource, EntityManager } from "typeorm";

import {
  ManageQaProjectResources,
  ManageTestAccountLease,
  type QaAccountPoolReference,
  type QaProjectEnvironmentRevision,
  QaProjectResourceRepository,
  type QaPublishedHumanActor,
  type QaTestAccountLease,
  TestAccountLeaseRepository,
  type TestAccountLeaseStorePort,
} from "@awp/competency-qa/node";
import {
  createOnboardingRevision,
  defaultClassificationCatalog,
  type ExactRevisionRef,
  type ProjectOnboardingRevision,
  type ProjectScope,
} from "@awp/platform-core";

import {
  type AdministrativeAuthority,
  appendOnboarding,
  auditAndEvent,
  authorizeAdministrative,
  command,
  digest,
  exact,
  exacts,
  integer,
  lockOnboarding,
  object,
  type OnboardingRequest,
  ref,
  reject,
  same,
  text,
  uuid,
  validHash,
} from "./durable-http.ts";
import { activeMember } from "./registry.application.ts";

export const RESOURCES_HTTP_APPLICATION = "RESOURCES_HTTP_APPLICATION";
export interface AccountInventoryPort {
  slots(scope: ProjectScope, pool: QaAccountPoolReference): Promise<readonly string[]>;
}
export class FileAccountInventory implements AccountInventoryPort {
  constructor(private readonly path: string | undefined) {}
  async slots(scope: ProjectScope, pool: QaAccountPoolReference): Promise<readonly string[]> {
    if (!this.path) return reject("ACCOUNT_INVENTORY_REQUIRED", 503);
    if (pool.resolverRef.key !== "file-account-inventory")
      return reject("ACCOUNT_RESOLVER_UNAVAILABLE", 503);
    const inventories: unknown = JSON.parse(await readFile(this.path, "utf8"));
    if (!Array.isArray(inventories) || inventories.length > 1000)
      return reject("ACCOUNT_INVENTORY_INVALID", 503);
    const entries = inventories.map((v) =>
      object(v, ["id", "version", "workspaceId", "projectId", "opaqueAccountRefs"]),
    );
    const matches = entries.filter(
      (v) =>
        v.workspaceId === scope.workspaceId &&
        v.projectId === scope.projectId &&
        v.id === pool.resolverRef.resourceRef.id &&
        v.version === pool.resolverRef.resourceRef.version &&
        digest(v) === pool.resolverRef.resourceRef.contentHash,
    );
    if (matches.length !== 1) return reject("ACCOUNT_INVENTORY_UNAVAILABLE", 503);
    const slots = matches[0]!.opaqueAccountRefs;
    if (
      !Array.isArray(slots) ||
      slots.length > 10000 ||
      slots.length < pool.maximumConcurrentLeases ||
      new Set(slots).size !== slots.length ||
      slots.some((v) => typeof v !== "string" || !/^accountref:\/\/[a-z0-9/._-]{1,200}$/u.test(v))
    )
      return reject("ACCOUNT_INVENTORY_INVALID", 503);
    return slots as string[];
  }
}
const publishedActor = (authority: AdministrativeAuthority): QaPublishedHumanActor => ({
  kind: "HUMAN",
  principalId: authority.actor.principalId,
  roleKey: authority.human.roleKey,
  authorizationBasisHash: digest(authority.basis),
  authenticationContextRef: authority.human.authenticationContextRef.contentHash,
  ...(authority.human.stepUpAt ? { stepUpAt: authority.human.stepUpAt } : {}),
});
const scopeOf = (r: ProjectScope) => ({ workspaceId: r.workspaceId, projectId: r.projectId });
const schemaBound = (value: unknown) => {
  const b = object(value, ["key", "schemaRef", "resourceRef"]),
    s = object(b.schemaRef, ["id", "version", "digest"]);
  const schema = exact({ id: s.id, version: s.version, contentHash: s.digest });
  return {
    key: text(b.key, 128),
    schemaRef: { id: schema.id, version: schema.version, digest: schema.contentHash },
    resourceRef: exact(b.resourceRef),
  };
};
const positive = (v: unknown, max: number) => {
  const n = integer(v);
  return n <= max ? n : reject("RESOURCE_LIMIT_INVALID", 400);
};

export class DurableResourcesHttpApplication {
  constructor(
    private readonly source: DataSource,
    private readonly inventory: AccountInventoryPort,
  ) {}
  private async classify(
    manager: EntityManager,
    request: OnboardingRequest,
    authority: AdministrativeAuthority,
    key: unknown,
    permission: string,
  ) {
    const value = text(key, 64);
    let desired;
    try {
      desired = defaultClassificationCatalog.assignableReference(value, new Date());
    } catch {
      return reject("CLASSIFICATION_INVALID", 400);
    }
    const grants = (await manager.query(
      "SELECT id,classification_ceiling_key FROM project_entitlements WHERE workspace_id=$1 AND project_id=$2 AND principal_id=$3 AND effect='ALLOW' AND revoked_at IS NULL AND valid_from<=clock_timestamp() AND (valid_until IS NULL OR valid_until>clock_timestamp()) AND (permissions ? $4 OR permissions ? '*')",
      [request.workspaceId, request.projectId, authority.actor.principalId, permission],
    )) as { id: string; classification_ceiling_key: string }[];
    if (
      !grants.some(
        (g) =>
          authority.basis.entitlementRefs.some((r) => r.id === g.id) &&
          defaultClassificationCatalog.permits(
            defaultClassificationCatalog.reference(g.classification_ceiling_key),
            desired,
          ),
      )
    )
      return reject("CLASSIFICATION_CEILING_EXCEEDED", 403);
    return value;
  }
  private async environment(manager: EntityManager, scope: ProjectScope, target: ExactRevisionRef) {
    const [row] = (await manager.query(
      "SELECT r.semantic_body,r.content_hash FROM qa_project_environment_headers h JOIN qa_project_environment_revisions r ON (r.workspace_id,r.project_id,r.environment_id,r.version)=(h.workspace_id,h.project_id,h.environment_id,h.current_published_version) WHERE h.workspace_id=$1 AND h.project_id=$2 AND h.environment_id=$3 AND r.version=$4 AND r.state='PUBLISHED' FOR SHARE OF h,r",
      [scope.workspaceId, scope.projectId, target.id, target.version],
    )) as { semantic_body: QaProjectEnvironmentRevision; content_hash: string }[];
    if (
      !row ||
      row.content_hash !== target.contentHash ||
      !validHash(row.semantic_body as unknown as { contentHash: string })
    )
      return reject("QA_ENVIRONMENT_STALE", 409);
    return row.semantic_body;
  }
  private async pool(manager: EntityManager, scope: ProjectScope, target: ExactRevisionRef) {
    const [row] = (await manager.query(
      "SELECT semantic_body,content_hash FROM qa_account_pool_references WHERE workspace_id=$1 AND project_id=$2 AND pool_id=$3 ORDER BY version DESC LIMIT 1 FOR SHARE",
      [scope.workspaceId, scope.projectId, target.id],
    )) as { semantic_body: QaAccountPoolReference; content_hash: string }[];
    if (
      !row ||
      row.content_hash !== target.contentHash ||
      row.semantic_body.version !== target.version ||
      row.semantic_body.state !== "PUBLISHED" ||
      !validHash(row.semantic_body as unknown as { contentHash: string })
    )
      return reject("QA_ACCOUNT_POOL_STALE", 409);
    return row.semantic_body;
  }
  private async changed(
    manager: EntityManager,
    current: ProjectOnboardingRevision,
    authority: AdministrativeAuthority,
    reason: string,
    contextRef?: ExactRevisionRef,
  ) {
    const { contentHash: _hash, ...prior } = current;
    void _hash;
    const next = createOnboardingRevision({
      ...prior,
      revisionId: randomUUID(),
      version: current.version + 1,
      stage: "VALIDATING",
      qaCapabilityMode: "MANUAL_ONLY",
      gateResultRefs: [],
      ...(contextRef ? { qaProjectContextRef: contextRef } : {}),
      actor: authority.human,
      reasonCode: "QA_RESOURCES_CHANGED",
      reason,
      correlationId: randomUUID(),
      createdAt: new Date().toISOString(),
    });
    await appendOnboarding(manager, next);
    return next.version;
  }
  async publishEnvironment(
    request: OnboardingRequest,
    input: unknown,
    key: string,
    expectedVersion?: number,
  ) {
    const b = object(input, [
      "environmentId",
      "key",
      "name",
      "scope",
      "ownerPrincipalId",
      "dataClassificationKey",
      "configurationRef",
      "allowedTestDataPolicyRefs",
      "reason",
    ]);
    const id = uuid(b.environmentId),
      owner = uuid(b.ownerPrincipalId),
      reason = text(b.reason),
      environmentScope = b.scope;
    if (
      environmentScope !== "LOCAL" &&
      environmentScope !== "NON_PROD" &&
      environmentScope !== "PREPROD"
    )
      return reject("QA_ENVIRONMENT_SCOPE_INVALID", 400);
    const content = {
      key: text(b.key, 128),
      name: text(b.name, 256),
      scope: environmentScope as "LOCAL" | "NON_PROD" | "PREPROD",
      configurationRef: schemaBound(b.configurationRef),
      allowedTestDataPolicyRefs: exacts(b.allowedTestDataPolicyRefs),
    };
    return this.source.transaction("SERIALIZABLE", async (manager) => {
      const current = await lockOnboarding(manager, request),
        authority = await authorizeAdministrative(manager, request, "qa.environment.publish");
      return command(
        manager,
        request,
        authority.actor.principalId,
        "qa.environment.publish",
        key,
        { body: b, expectedVersion: expectedVersion ?? null },
        async () => {
          await activeMember(manager, request.workspaceId, owner);
          const classification = await this.classify(
            manager,
            request,
            authority,
            b.dataClassificationKey,
            "qa.environment.publish",
          );
          const [head] = (await manager.query(
            "SELECT current_version FROM qa_project_environment_headers WHERE workspace_id=$1 AND project_id=$2 AND environment_id=$3 FOR UPDATE",
            [request.workspaceId, request.projectId, id],
          )) as { current_version: number }[];
          if (head && head.current_version !== expectedVersion)
            return reject("QA_ENVIRONMENT_VERSION_CONFLICT", 409);
          const at = new Date().toISOString(),
            version = (head?.current_version ?? 0) + 1;
          const published = await new ManageQaProjectResources(
            new QaProjectResourceRepository(manager),
          ).publishEnvironment({
            ...scopeOf(request),
            ...content,
            schemaVersion: 1,
            revisionId: randomUUID(),
            environmentId: id,
            version,
            ownerPrincipalId: owner,
            dataClassificationKey: classification,
            status: "PUBLISHED",
            createdBy: publishedActor(authority),
            createdAt: at,
            publishedAt: at,
          });
          const resultRef = ref(id, version, published.contentHash),
            onboardingVersion = await this.changed(manager, current, authority, reason);
          await auditAndEvent(
            manager,
            request,
            authority,
            "QA_ENVIRONMENT_PUBLISHED",
            resultRef,
            reason,
          );
          return { resultRef, version, onboardingVersion };
        },
      );
    });
  }
  async publishResource(
    request: OnboardingRequest,
    kind: string,
    input: unknown,
    key: string,
    expectedVersion?: number,
  ) {
    if (kind !== "test-data" && kind !== "account-pools")
      return reject("QA_RESOURCE_KIND_INVALID", 400);
    const b = object(
      input,
      kind === "test-data"
        ? [
            "kind",
            "resourceId",
            "externalRef",
            "ownerPrincipalId",
            "allowedEnvironmentRefs",
            "dataClassificationKey",
            "retentionPolicyRef",
          ]
        : [
            "kind",
            "resourceId",
            "environmentRef",
            "resolverRef",
            "ownerPrincipalId",
            "maximumConcurrentLeases",
            "maximumLeaseDurationSeconds",
            "dataClassificationKey",
          ],
    );
    const id = uuid(b.resourceId),
      owner = uuid(b.ownerPrincipalId);
    return this.source.transaction("SERIALIZABLE", async (manager) => {
      const current = await lockOnboarding(manager, request),
        authority = await authorizeAdministrative(manager, request, "qa.resource.publish");
      return command(
        manager,
        request,
        authority.actor.principalId,
        "qa.resource.publish",
        key,
        { kind, body: b, expectedVersion: expectedVersion ?? null },
        async () => {
          await activeMember(manager, request.workspaceId, owner);
          const classification = await this.classify(
            manager,
            request,
            authority,
            b.dataClassificationKey,
            "qa.resource.publish",
          );
          const table =
              kind === "test-data" ? "qa_test_data_catalog_entries" : "qa_account_pool_references",
            column = kind === "test-data" ? "entry_id" : "pool_id";
          const [head] = (await manager.query(
            `SELECT max(version)::int AS version FROM ${table} WHERE workspace_id=$1 AND project_id=$2 AND ${column}=$3`,
            [request.workspaceId, request.projectId, id],
          )) as { version: number | null }[];
          if (head?.version && head.version !== expectedVersion)
            return reject("QA_RESOURCE_VERSION_CONFLICT", 409);
          const version = (head?.version ?? 0) + 1,
            service = new ManageQaProjectResources(new QaProjectResourceRepository(manager));
          let resultRef: ExactRevisionRef;
          if (kind === "test-data") {
            if (b.kind !== "DATASET" && b.kind !== "PREPARATION_PROCEDURE")
              return reject("QA_RESOURCE_KIND_INVALID", 400);
            const environments = exacts(b.allowedEnvironmentRefs);
            if (!environments.length) return reject("QA_ENVIRONMENT_REQUIRED", 400);
            for (const environment of environments)
              await this.environment(manager, request, environment);
            const data = await service.publishTestData({
              ...scopeOf(request),
              entryId: id,
              version,
              kind: b.kind,
              externalRef: exact(b.externalRef),
              ownerPrincipalId: owner,
              allowedEnvironmentRefs: environments,
              dataClassificationKey: classification,
              retentionPolicyRef: exact(b.retentionPolicyRef),
              state: "PUBLISHED",
            });
            resultRef = ref(id, version, data.contentHash);
          } else {
            if (b.kind !== "ACCOUNT_POOL") return reject("QA_RESOURCE_KIND_INVALID", 400);
            const environmentRef = exact(b.environmentRef);
            await this.environment(manager, request, environmentRef);
            const pool = await service.publishAccountPool({
              ...scopeOf(request),
              poolId: id,
              version,
              environmentRef,
              resolverRef: schemaBound(b.resolverRef),
              ownerPrincipalId: owner,
              maximumConcurrentLeases: positive(b.maximumConcurrentLeases, 10000),
              maximumLeaseDurationSeconds: positive(b.maximumLeaseDurationSeconds, 604800),
              dataClassificationKey: classification,
              state: "PUBLISHED",
            });
            resultRef = ref(id, version, pool.contentHash);
          }
          const onboardingVersion = await this.changed(
            manager,
            current,
            authority,
            "QA resource publication",
          );
          await auditAndEvent(
            manager,
            request,
            authority,
            "QA_RESOURCE_PUBLISHED",
            resultRef,
            "QA resource publication",
          );
          return { resultRef, version, onboardingVersion };
        },
      );
    });
  }
  async publishContext(
    request: OnboardingRequest,
    input: unknown,
    key: string,
    expectedVersion?: number,
  ) {
    const lists = [
      "environmentRefs",
      "testDataCatalogRefs",
      "accountPoolRefs",
      "targetPolicyRefs",
      "scopePolicyRefs",
      "checklistPolicyRefs",
      "defaultChecklistRefs",
    ] as const;
    const singles = [
      "defaultTargetPolicyRef",
      "defaultScopePolicyRef",
      "evidencePolicyRef",
      "retentionPolicyRef",
      "redactionPolicyRef",
      "exportPolicyRef",
      "riskReviewPolicyRef",
      "dorRuleSetRef",
      "dodRuleSetRef",
      "capabilityRequirementSetRef",
    ] as const;
    const b = object(input, [...lists, ...singles, "maximumClassificationKey", "reason"]),
      reason = text(b.reason);
    // Explicit keys preserve the published v2 wire format with numeric exact references.
    const refs = {
      environmentRefs: exacts(b.environmentRefs),
      testDataCatalogRefs: exacts(b.testDataCatalogRefs),
      accountPoolRefs: exacts(b.accountPoolRefs),
      targetPolicyRefs: exacts(b.targetPolicyRefs),
      scopePolicyRefs: exacts(b.scopePolicyRefs),
      checklistPolicyRefs: exacts(b.checklistPolicyRefs),
      defaultChecklistRefs: exacts(b.defaultChecklistRefs),
      defaultTargetPolicyRef: exact(b.defaultTargetPolicyRef),
      defaultScopePolicyRef: exact(b.defaultScopePolicyRef),
      evidencePolicyRef: exact(b.evidencePolicyRef),
      retentionPolicyRef: exact(b.retentionPolicyRef),
      redactionPolicyRef: exact(b.redactionPolicyRef),
      exportPolicyRef: exact(b.exportPolicyRef),
      riskReviewPolicyRef: exact(b.riskReviewPolicyRef),
      dorRuleSetRef: exact(b.dorRuleSetRef),
      dodRuleSetRef: exact(b.dodRuleSetRef),
      capabilityRequirementSetRef: exact(b.capabilityRequirementSetRef),
    };
    if (
      !refs.environmentRefs.length ||
      !refs.testDataCatalogRefs.length ||
      !refs.accountPoolRefs.length ||
      !refs.defaultChecklistRefs.length ||
      !refs.targetPolicyRefs.some((r) => same(r, refs.defaultTargetPolicyRef)) ||
      !refs.scopePolicyRefs.some((r) => same(r, refs.defaultScopePolicyRef)) ||
      refs.defaultChecklistRefs.some((d) => !refs.checklistPolicyRefs.some((r) => same(r, d)))
    )
      return reject("QA_CONTEXT_CATALOG_INVALID", 400);
    return this.source.transaction("SERIALIZABLE", async (manager) => {
      const current = await lockOnboarding(manager, request),
        authority = await authorizeAdministrative(manager, request, "qa.context.publish");
      return command(
        manager,
        request,
        authority.actor.principalId,
        "qa.context.publish",
        key,
        { body: b, expectedVersion: expectedVersion ?? null },
        async () => {
          const classification = await this.classify(
            manager,
            request,
            authority,
            b.maximumClassificationKey,
            "qa.context.publish",
          );
          const ceiling = defaultClassificationCatalog.reference(classification);
          const fits = (key: string) => {
            if (
              !defaultClassificationCatalog.permits(
                ceiling,
                defaultClassificationCatalog.reference(key),
              )
            )
              return reject("QA_CONTEXT_CLASSIFICATION_EXCEEDED", 409);
          };
          for (const env of refs.environmentRefs)
            fits((await this.environment(manager, request, env)).dataClassificationKey);
          for (const pool of refs.accountPoolRefs) {
            const value = await this.pool(manager, request, pool);
            fits(value.dataClassificationKey);
            if (!refs.environmentRefs.some((r) => same(r, value.environmentRef)))
              return reject("QA_CONTEXT_POOL_ENVIRONMENT_MISMATCH", 409);
          }
          const repository = new QaProjectResourceRepository(manager);
          for (const target of refs.testDataCatalogRefs) {
            const value = await repository.testDataEntry(request, target.id, target.version);
            if (
              !value ||
              value.state !== "PUBLISHED" ||
              value.contentHash !== target.contentHash ||
              !validHash(value as unknown as { contentHash: string }) ||
              value.allowedEnvironmentRefs.some(
                (r) => !refs.environmentRefs.some((e) => same(r, e)),
              )
            )
              return reject("QA_CONTEXT_DATA_STALE", 409);
            fits(value.dataClassificationKey);
          }
          const [head] = (await manager.query(
            "SELECT context_id,current_version FROM qa_project_context_headers_v2 WHERE workspace_id=$1 AND project_id=$2 FOR UPDATE",
            [request.workspaceId, request.projectId],
          )) as { context_id: string; current_version: number }[];
          if (head && head.current_version !== expectedVersion)
            return reject("QA_CONTEXT_VERSION_CONFLICT", 409);
          const version = (head?.current_version ?? 0) + 1,
            id = head?.context_id ?? randomUUID();
          const context = await new ManageQaProjectResources(repository).publishContext({
            ...scopeOf(request),
            ...refs,
            contextId: id,
            version,
            state: "PUBLISHED",
            maximumClassificationKey: classification,
            resourceVersion: version,
            createdBy: publishedActor(authority),
            publishedBy: publishedActor(authority),
            publishedAt: new Date().toISOString(),
          });
          const resultRef = ref(id, version, context.contentHash),
            onboardingVersion = await this.changed(manager, current, authority, reason, resultRef);
          await auditAndEvent(
            manager,
            request,
            authority,
            "QA_CONTEXT_PUBLISHED",
            resultRef,
            reason,
          );
          return { resultRef, version, onboardingVersion };
        },
      );
    });
  }
  private leaseStore(
    manager: EntityManager,
    scope: ProjectScope,
    authority: AdministrativeAuthority,
  ): TestAccountLeaseStorePort {
    const repository = new TestAccountLeaseRepository(this.source);
    const current = async (s: ProjectScope, id: string) => {
      const [row] = (await manager.query(
        "SELECT r.semantic_body FROM qa_test_account_lease_heads h JOIN qa_test_account_leases r ON (r.workspace_id,r.project_id,r.lease_id,r.version)=(h.workspace_id,h.project_id,h.lease_id,h.current_version) WHERE h.workspace_id=$1 AND h.project_id=$2 AND h.lease_id=$3 FOR UPDATE OF h",
        [s.workspaceId, s.projectId, id],
      )) as { semantic_body: QaTestAccountLease }[];
      if (row && !validHash(row.semantic_body as unknown as { contentHash: string }))
        return reject("QA_LEASE_UNVERIFIED", 409);
      return row?.semantic_body;
    };
    return {
      current,
      active: async () => {
        const rows = (await manager.query(
          "SELECT lease_id FROM qa_test_account_lease_heads WHERE workspace_id=$1 AND project_id=$2 AND state='ACTIVE' ORDER BY lease_id FOR UPDATE",
          [scope.workspaceId, scope.projectId],
        )) as { lease_id: string }[];
        return (await Promise.all(rows.map((r) => current(scope, r.lease_id)))).filter(
          (v): v is QaTestAccountLease => !!v,
        );
      },
      activeSlot: async (s, poolId, slot) => {
        const [head] = (await manager.query(
          "SELECT lease_id FROM qa_test_account_lease_heads WHERE workspace_id=$1 AND project_id=$2 AND pool_id=$3 AND opaque_account_ref=$4 AND state='ACTIVE' FOR UPDATE",
          [s.workspaceId, s.projectId, poolId, slot],
        )) as { lease_id: string }[];
        return head ? current(s, head.lease_id) : undefined;
      },
      append: (lease, audit) =>
        repository.appendInTransaction(manager, lease, {
          ...audit,
          actor: authority.actor,
          authorizationBasis: authority.basis,
        }),
    };
  }
  async acquireLease(request: OnboardingRequest, input: unknown, key: string) {
    const b = object(input, [
        "environmentRef",
        "accountPoolRef",
        "subjectRef",
        "purpose",
        "requestedUntil",
      ]),
      environmentRef = exact(b.environmentRef),
      poolRef = exact(b.accountPoolRef),
      purpose = text(b.purpose);
    const subject = /^(work-item|session):([a-z0-9._-]{1,256})$/u.exec(text(b.subjectRef, 100));
    if (!subject) return reject("QA_LEASE_SUBJECT_INVALID", 400);
    const subjectId = subject[1] === "work-item" ? uuid(subject[2]) : text(subject[2], 256),
      requestedUntil = text(b.requestedUntil, 40),
      until = Date.parse(requestedUntil);
    if (!Number.isFinite(until)) return reject("QA_LEASE_TIME_INVALID", 400);
    return this.source.transaction("SERIALIZABLE", async (manager) => {
      const current = await lockOnboarding(manager, request),
        authority = await authorizeAdministrative(manager, request, "qa.account-lease.acquire");
      return command(
        manager,
        request,
        authority.actor.principalId,
        "qa.account-lease.acquire",
        key,
        b,
        async () => {
          const [project] = (await manager.query(
            "SELECT state FROM projects WHERE workspace_id=$1 AND id=$2 FOR SHARE",
            [request.workspaceId, request.projectId],
          )) as { state: string }[];
          if (current.operationalState !== "ACTIVE" || project?.state !== "ACTIVE")
            return reject("PROJECT_SUSPENDED", 409);
          await this.environment(manager, request, environmentRef);
          const pool = await this.pool(manager, request, poolRef);
          await this.classify(
            manager,
            request,
            authority,
            pool.dataClassificationKey,
            "qa.account-lease.acquire",
          );
          if (!same(pool.environmentRef, environmentRef))
            return reject("QA_ACCOUNT_POOL_ENVIRONMENT_MISMATCH", 409);
          const table = subject[1] === "work-item" ? "work_items" : "qa_test_sessions",
            column = subject[1] === "work-item" ? "id" : "session_id";
          const subjects = (await manager.query(
            `SELECT ${column} FROM ${table} WHERE workspace_id=$1 AND project_id=$2 AND ${column}=$3 FOR SHARE`,
            [request.workspaceId, request.projectId, subjectId],
          )) as unknown[];
          if (subjects.length !== 1) return reject("QA_LEASE_SUBJECT_UNAVAILABLE", 404);
          const now = new Date().toISOString(),
            duration = (until - Date.parse(now)) / 1000;
          if (duration < 1 || duration > pool.maximumLeaseDurationSeconds)
            return reject("QA_LEASE_DURATION_INVALID", 400);
          const slots = await this.inventory.slots(scopeOf(request), pool);
          const store = this.leaseStore(manager, request, authority),
            service = new ManageTestAccountLease(store);
          await service.expire(request, now);
          const allActive = await store.active(request),
            active = allActive.filter((l) => l.poolRef.id === pool.poolId);
          if (active.length >= pool.maximumConcurrentLeases)
            return reject("QA_ACCOUNT_POOL_EXHAUSTED", 409);
          const slot = slots.find((s) => !allActive.some((l) => l.opaqueAccountRef === s));
          if (!slot) return reject("QA_ACCOUNT_POOL_EXHAUSTED", 409);
          const lease = await service.acquire({
            ...scopeOf(request),
            schemaVersion: 1,
            leaseId: randomUUID(),
            poolRef,
            environmentRef,
            subject: { kind: subject[1] === "work-item" ? "WORK_ITEM" : "SESSION", id: subjectId },
            leasedToPrincipalId: authority.actor.principalId,
            opaqueAccountRef: slot,
            maximumLeaseDurationSeconds: pool.maximumLeaseDurationSeconds,
            requestedDurationSeconds: duration,
            createdBy: publishedActor(authority),
            now,
          });
          const resultRef = ref(lease.leaseId, 1, lease.contentHash);
          await auditAndEvent(
            manager,
            request,
            authority,
            "QA_ACCOUNT_LEASE_ACQUIRED",
            resultRef,
            purpose,
          );
          return { leaseId: lease.leaseId, version: 1, resultRef, expiresAt: lease.expiresAt };
        },
      );
    });
  }
  async releaseLease(
    request: OnboardingRequest,
    id: string,
    input: unknown,
    key: string,
    expectedVersion: number,
  ) {
    const b = object(input, ["reason"]),
      reason = text(b.reason);
    return this.source.transaction("SERIALIZABLE", async (manager) => {
      await lockOnboarding(manager, request);
      const authority = await authorizeAdministrative(manager, request, "qa.account-lease.release");
      return command(
        manager,
        request,
        authority.actor.principalId,
        "qa.account-lease.release",
        key,
        { id, body: b, expectedVersion },
        async () => {
          const store = this.leaseStore(manager, request, authority),
            lease = await store.current(request, id);
          if (!lease || lease.leasedToPrincipalId !== authority.actor.principalId)
            return reject("QA_LEASE_NOT_AVAILABLE", 403);
          if (lease.version !== expectedVersion || lease.state !== "ACTIVE")
            return reject("QA_LEASE_VERSION_CONFLICT", 409);
          const released = await new ManageTestAccountLease(store).release({
            scope: request,
            leaseId: id,
            actor: authority.human,
            now: new Date().toISOString(),
            reasonCode: "LEASE_RELEASED_BY_HOLDER",
          });
          const resultRef = ref(id, released.version, released.contentHash);
          await auditAndEvent(
            manager,
            request,
            authority,
            "QA_ACCOUNT_LEASE_RELEASED",
            resultRef,
            reason,
          );
          return { leaseId: id, version: released.version, resultRef };
        },
      );
    });
  }
}
