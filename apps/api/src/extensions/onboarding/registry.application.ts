import { randomUUID } from "node:crypto";

import { HttpException } from "@nestjs/common";
import type { DataSource, EntityManager } from "typeorm";

import {
  type AuthorizationBasisRef,
  createOnboardingRevision,
  createProjectEntitlementRevision,
  defaultClassificationCatalog,
  entitlementSetHash,
  type ProjectEntitlementRevision,
  type ProjectScope,
} from "@awp/platform-core";
import {
  ProjectEntitlementRepository,
  ProjectOnboardingRepository,
} from "@awp/platform-persistence-typeorm";
import { ProjectRegistrationService, workspaceRolePermissions } from "@awp/runtime-composition";

import {
  authorizeQaApi,
  qaInteractionSession,
  type QaSessionRequest,
} from "../qa-api-authorization.ts";
import {
  appendOnboarding,
  auditAndEvent,
  authorizeAdministrative,
  command,
  currentAuthority,
  digest,
  lockOnboarding,
  object,
  type OnboardingRequest,
  ref,
  reject,
  text,
  uuid,
  validHash,
} from "./durable-http.ts";

export const REGISTRY_HTTP_APPLICATION = "REGISTRY_HTTP_APPLICATION";
const starterPermissions = [
  "project.catalog.read",
  "project.onboarding.read",
  "project.entitlement.grant",
  "project.entitlement.revoke",
];
const scopeOf = (request: ProjectScope): ProjectScope => ({
  workspaceId: request.workspaceId,
  projectId: request.projectId,
});
const timestamp = (value: unknown) => {
  const v = text(value, 40);
  if (
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/u.test(v) ||
    !Number.isFinite(Date.parse(v))
  )
    return reject("COMMAND_TIMESTAMP_INVALID", 400);
  return new Date(v).toISOString();
};
const classification = (value: unknown) => {
  const key = text(value, 64);
  try {
    return defaultClassificationCatalog.assignableReference(key, new Date());
  } catch {
    return reject("CLASSIFICATION_INVALID", 400);
  }
};

export async function activeMember(
  manager: EntityManager,
  workspaceId: string,
  principalId: string,
) {
  const rows = (await manager.query(
    "SELECT wm.id FROM workspace_memberships wm JOIN identities i ON i.id=wm.principal_id AND i.kind='HUMAN' WHERE wm.workspace_id=$1 AND wm.principal_id=$2 AND wm.state='ACTIVE' AND wm.valid_from<=clock_timestamp() AND (wm.valid_until IS NULL OR wm.valid_until>clock_timestamp()) AND wm.revoked_at IS NULL FOR SHARE OF wm,i",
    [workspaceId, principalId],
  )) as unknown[];
  if (rows.length !== 1) return reject("ACTIVE_WORKSPACE_MEMBER_REQUIRED", 403);
}

export class DurableRegistryHttpApplication {
  constructor(
    private readonly source: DataSource,
    private readonly authorizeRegistration?: (
      request: QaSessionRequest,
      workspaceId: string,
      operation?: "READ" | "MUTATE",
      permission?: string,
    ) => Promise<AuthorizationBasisRef>,
  ) {}

  async catalog(
    request: QaSessionRequest,
    workspaceId: string,
    query?: { limit?: string; cursor?: string },
  ) {
    const limit = query?.limit === undefined ? 50 : Number(query.limit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      return reject("CATALOG_LIMIT_INVALID", 400);
    const session = await qaInteractionSession(request);
    uuid(workspaceId);
    return this.source.transaction("REPEATABLE READ", async (manager) => {
      await activeMember(manager, workspaceId, session.principalId);
      const projects = (await manager.query(
        "SELECT DISTINCT project_id AS id FROM project_entitlements WHERE workspace_id=$1 AND principal_id=$2 AND effect='ALLOW' AND revoked_at IS NULL AND valid_from<=clock_timestamp() AND (valid_until IS NULL OR valid_until>clock_timestamp()) AND (permissions ? 'project.catalog.read' OR permissions ? '*') ORDER BY id",
        [workspaceId, session.principalId],
      )) as { id: string }[];
      const items: {
        id: string;
        key: string;
        name: string;
        classificationKey: string;
        stage?: string;
        capabilityMode?: string;
        operationalState?: string;
        version?: number;
      }[] = [];
      for (const project of projects) {
        try {
          const identity = await authorizeQaApi(
            this.source,
            request,
            workspaceId,
            project.id,
            "project.catalog.read",
          );
          if (identity.actor.principalId !== session.principalId)
            return reject("PROJECT_RESOURCE_NOT_AVAILABLE", 404);
          const access = await currentAuthority(
            manager,
            { kind: "PROJECT", workspaceId, projectId: project.id },
            session.principalId,
            "project.catalog.read",
            undefined,
            session.authentication,
          );
          if (
            !defaultClassificationCatalog.permits(
              defaultClassificationCatalog.reference(identity.classificationCeiling),
              defaultClassificationCatalog.reference(access.classification),
            )
          )
            continue;
        } catch (error) {
          if (error instanceof HttpException && error.getStatus() === 403) continue;
          throw error;
        }
        const [metadata] = (await manager.query(
          "SELECT key,name,classification_key FROM projects WHERE workspace_id=$1 AND id=$2",
          [workspaceId, project.id],
        )) as { key: string; name: string; classification_key: string }[];
        if (!metadata) return reject("PROJECT_RESOURCE_NOT_AVAILABLE", 404);
        const [head] = (await manager.query(
          "SELECT current_stage,current_capability_mode,current_operational_state,current_version FROM project_onboarding_headers WHERE workspace_id=$1 AND project_id=$2",
          [workspaceId, project.id],
        )) as {
          current_stage: string;
          current_capability_mode: string;
          current_operational_state: string;
          current_version: number;
        }[];
        items.push({
          id: project.id,
          key: metadata.key,
          name: metadata.name,
          classificationKey: metadata.classification_key,
          ...(head
            ? {
                stage: head.current_stage,
                capabilityMode: head.current_capability_mode,
                operationalState: head.current_operational_state,
                version: head.current_version,
              }
            : {}),
        });
      }
      items.sort((a, b) => a.key.localeCompare(b.key) || a.id.localeCompare(b.id));
      const fingerprint = digest({ workspaceId, principalId: session.principalId, items });
      let offset = 0;
      if (query?.cursor) {
        let cursor: Record<string, unknown>;
        try {
          if (query.cursor.length > 1024) throw new Error();
          cursor = object(JSON.parse(Buffer.from(query.cursor, "base64url").toString("utf8")), [
            "fingerprint",
            "offset",
          ]);
        } catch {
          return reject("CATALOG_CURSOR_INVALID", 400);
        }
        if (
          cursor.fingerprint !== fingerprint ||
          !Number.isSafeInteger(cursor.offset) ||
          Number(cursor.offset) < 0
        )
          return reject("CATALOG_CURSOR_STALE", 409);
        offset = Number(cursor.offset);
      }
      return {
        items: items.slice(offset, offset + limit),
        ...(offset + limit < items.length
          ? {
              nextCursor: Buffer.from(
                JSON.stringify({ fingerprint, offset: offset + limit }),
              ).toString("base64url"),
            }
          : {}),
      };
    });
  }

  async registrationOptions(request: QaSessionRequest, workspaceId: string) {
    uuid(workspaceId);
    const session = await qaInteractionSession(request);
    const basis = await this.authorizeRegistration?.(request, workspaceId, "READ");
    return this.source.transaction("REPEATABLE READ", async (manager) => {
      await currentAuthority(
        manager,
        { kind: "WORKSPACE", workspaceId },
        session.principalId,
        "project.register",
        undefined,
        session.authentication,
        basis,
      );
      const [workspace] = (await manager.query("SELECT name FROM workspaces WHERE id=$1", [
        workspaceId,
      ])) as { name: string }[];
      const owners = (await manager.query(
        `
        SELECT DISTINCT i.id,COALESCE(p.display_name,p.username,i.subject) AS "displayName",p.username
        FROM workspace_memberships m JOIN identities i ON i.id=m.principal_id AND i.kind='HUMAN'
        LEFT JOIN platform_user_profiles p ON p.principal_id=i.id
        WHERE m.workspace_id=$1 AND m.state='ACTIVE' AND m.revoked_at IS NULL
          AND m.valid_from<=clock_timestamp() AND (m.valid_until IS NULL OR m.valid_until>clock_timestamp())
        ORDER BY "displayName",i.id
      `,
        [workspaceId],
      )) as { id: string; displayName: string; username: string | null }[];
      await this.authorizeRegistration?.(request, workspaceId, "READ");
      return {
        schemaVersion: 1,
        workspaceId,
        workspaceName: workspace!.name,
        owners,
        criticalities: [
          {
            key: "STANDARD",
            label: "Стандартная",
            description: "Действующая стандартная критичность проекта.",
          },
        ],
        classifications: [
          { key: "PUBLIC", label: "Публичные", description: "Данные для открытого доступа." },
          {
            key: "INTERNAL",
            label: "Внутренние",
            description: "Данные для работы внутри организации.",
          },
          {
            key: "RESTRICTED",
            label: "Ограниченные",
            description: "Доступ только участникам с соответствующим уровнем допуска.",
          },
          {
            key: "CONFIDENTIAL",
            label: "Конфиденциальные",
            description: "Требуется максимальный уровень допуска к данным.",
          },
        ],
      };
    });
  }

  async register(request: QaSessionRequest, workspaceId: string, input: unknown, key: string) {
    return this.registerPrepared(request, workspaceId, input, key, "project.register");
  }

  async authorizeDialogue(
    request: QaSessionRequest,
    workspaceId: string,
    manager: EntityManager,
    mutate = false,
  ) {
    const session = await qaInteractionSession(request);
    const basis = await this.authorizeRegistration?.(
      request,
      workspaceId,
      mutate ? "MUTATE" : "READ",
      "project.request.create",
    );
    await currentAuthority(
      manager,
      { kind: "WORKSPACE", workspaceId },
      session.principalId,
      "project.request.create",
      undefined,
      session.authentication,
      basis,
    );
    return session;
  }

  async registerOwn(
    request: QaSessionRequest,
    workspaceId: string,
    draft: { key: string; name: string; purpose: string },
    key: string,
    manager: EntityManager,
  ) {
    const session = await qaInteractionSession(request);
    return this.registerPrepared(
      request,
      workspaceId,
      {
        key: draft.key,
        name: draft.name,
        ownerIds: Object.fromEntries(
          ["business", "technical", "qa", "security", "escalation"].map((key) => [
            key,
            session.principalId,
          ]),
        ),
        criticalityKey: "STANDARD",
        dataClassificationKey: "INTERNAL",
        reason: draft.purpose,
      },
      key,
      "project.request.create",
      manager,
    );
  }

  private async registerPrepared(
    request: QaSessionRequest,
    workspaceId: string,
    input: unknown,
    key: string,
    permission: string,
    transaction?: EntityManager,
  ) {
    uuid(workspaceId);
    await this.authorizeRegistration?.(request, workspaceId, "MUTATE", permission);
    const b = object(input, [
      "key",
      "name",
      "ownerIds",
      "criticalityKey",
      "dataClassificationKey",
      "reason",
    ]);
    const projectKey = text(b.key, 64);
    if (!/^[A-Z][A-Z0-9_-]{1,63}$/u.test(projectKey)) return reject("PROJECT_KEY_INVALID", 400);
    const owners = object(b.ownerIds, ["business", "technical", "qa", "security", "escalation"]);
    const ownerIds = [
      ...new Set(
        ["business", "technical", "qa", "security", "escalation"].map((k) => uuid(owners[k])),
      ),
    ].sort();
    const normalized = {
      key: projectKey,
      name: text(b.name, 256),
      ownerIds,
      criticalityKey: text(b.criticalityKey, 64),
      dataClassificationKey: classification(b.dataClassificationKey).key,
      reason: text(b.reason),
    };
    const session = await qaInteractionSession(request);
    const now = Date.now(),
      step = Date.parse(session.authentication?.stepUpAt ?? "");
    if (
      !session.authentication?.contextRef ||
      !Number.isFinite(step) ||
      step > now ||
      now - step > 300_000
    )
      return reject("STEP_UP_REQUIRED", 403);
    const execute = async (manager: EntityManager) => {
      await manager.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `project-onboarding:${workspaceId}`,
      ]);
      await manager.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [workspaceId]);
      const registrationBasis = await this.authorizeRegistration?.(
        request,
        workspaceId,
        "MUTATE",
        permission,
      );
      const authority = await currentAuthority(
        manager,
        { kind: "WORKSPACE", workspaceId },
        session.principalId,
        permission,
        undefined,
        session.authentication,
        registrationBasis,
      );
      let registrationValidUntil: string | undefined;
      if (permission === "project.request.create") {
        const ceilings = (await manager.query(
          "SELECT classification_ceiling_key AS key FROM role_assignments WHERE id=ANY($1::uuid[])",
          [authority.basis.roleAssignmentRefs.map((r) => r.id)],
        )) as { key: string | null }[];
        if (
          !ceilings.some(
            (c) =>
              c.key &&
              defaultClassificationCatalog.permits(
                defaultClassificationCatalog.reference(c.key),
                defaultClassificationCatalog.reference(normalized.dataClassificationKey),
              ),
          )
        )
          return reject("CLASSIFICATION_EXCEEDED", 403);
        const [expiry] = (await manager.query(
          "SELECT min(valid_until) AS until FROM (SELECT valid_until FROM role_assignments WHERE id=ANY($1::uuid[]) UNION ALL SELECT valid_until FROM workspace_memberships WHERE id=$2) limits",
          [authority.basis.roleAssignmentRefs.map((r) => r.id), authority.basis.membershipRef.id],
        )) as { until: Date | null }[];
        registrationValidUntil = expiry?.until?.toISOString();
      }
      // Registration has no Project yet. The workspace lock serializes its durable key across newly allocated Project IDs.
      const [replay] = (await manager.query(
        "SELECT request_hash,result_ref FROM client_request_idempotency WHERE workspace_id=$1 AND actor_id=$2 AND operation='project.register' AND client_key=$3",
        [workspaceId, session.principalId, key],
      )) as { request_hash: string; result_ref: { projectId: string } }[];
      if (replay) {
        if (replay.request_hash !== digest(normalized)) return reject("IDEMPOTENCY_CONFLICT", 409);
        return replay.result_ref;
      }
      const existing = (await manager.query(
        "SELECT id FROM projects WHERE workspace_id=$1 AND key=$2",
        [workspaceId, projectKey],
      )) as unknown[];
      if (existing.length) return reject("PROJECT_KEY_CONFLICT", 409);
      for (const ownerId of ownerIds) await activeMember(manager, workspaceId, ownerId);
      const scope = { workspaceId, projectId: randomUUID() },
        at = new Date().toISOString();
      const registrationPermissions =
        permission === "project.request.create"
          ? workspaceRolePermissions("requester").filter((p) => p !== "project.request.create")
          : authority.human.roleKey === "system-administrator"
            ? starterPermissions
            : ["project.catalog.read", "project.onboarding.read"];
      const starter = createProjectEntitlementRevision({
        ...scope,
        entitlementId: randomUUID(),
        revisionId: randomUUID(),
        version: 1,
        principalId: session.principalId,
        operation: "GRANT",
        effect: "ALLOW",
        permissions: registrationPermissions,
        classificationCeilingKey: normalized.dataClassificationKey,
        validFrom: at,
        ...(registrationValidUntil ? { validUntil: registrationValidUntil } : {}),
        actor: authority.human,
        reason: "Registration starter access",
        correlationId: randomUUID(),
        createdAt: at,
      });
      const teamAssignments = (await manager.query(
        `
        SELECT ra.principal_id,ra.permissions,ra.classification_ceiling_key,
          GREATEST(ra.valid_from,wm.valid_from) AS valid_from,
          LEAST(ra.valid_until,wm.valid_until) AS valid_until
        FROM role_assignments ra
        JOIN identities i ON i.id=ra.principal_id AND i.kind='HUMAN'
        JOIN workspace_memberships wm ON wm.workspace_id=ra.workspace_id AND wm.principal_id=ra.principal_id
        WHERE ra.workspace_id=$1 AND ra.role_key<>'requester' AND ra.project_access_scope='ALL_PROJECTS' AND ra.project_id IS NULL
          AND ra.effect='ALLOW' AND ra.revoked_at IS NULL AND ra.valid_from<=$2 AND (ra.valid_until IS NULL OR ra.valid_until>$2)
          AND wm.state='ACTIVE' AND wm.revoked_at IS NULL AND wm.valid_from<=$2 AND (wm.valid_until IS NULL OR wm.valid_until>$2)
        ORDER BY ra.id,wm.id FOR SHARE OF ra,wm
      `,
        [workspaceId, at],
      )) as {
        principal_id: string;
        permissions: string[];
        classification_ceiling_key: string;
        valid_from: Date;
        valid_until: Date | null;
      }[];
      const starters = [
        starter,
        ...teamAssignments.map((assignment) =>
          createProjectEntitlementRevision({
            ...scope,
            entitlementId: randomUUID(),
            revisionId: randomUUID(),
            version: 1,
            principalId: assignment.principal_id,
            operation: "GRANT",
            effect: "ALLOW",
            permissions: assignment.permissions,
            classificationCeilingKey: assignment.classification_ceiling_key,
            validFrom: assignment.valid_from.toISOString(),
            ...(assignment.valid_until ? { validUntil: assignment.valid_until.toISOString() } : {}),
            actor: authority.human,
            reason: "Workspace team access to registered project",
            correlationId: randomUUID(),
            createdAt: at,
          }),
        ),
      ];
      const repository = new ProjectOnboardingRepository(this.source);
      const service = new ProjectRegistrationService(
        { registerProject: (value) => repository.insertRegistration(manager, value) },
        { now: () => at, next: () => randomUUID() },
      );
      const registered = await service.register({
        ...scope,
        ...normalized,
        idempotencyKey: key,
        starterEntitlementSetHash: entitlementSetHash(starters),
        actor: authority.human,
        correlationId: randomUUID(),
      });
      await manager.query(
        "INSERT INTO role_assignments(id,workspace_id,project_id,principal_id,role_key,effect,permissions,valid_from,valid_until) VALUES($1,$2,$3,$4,$7,'ALLOW',$5,$6,$8)",
        [
          randomUUID(),
          workspaceId,
          scope.projectId,
          session.principalId,
          JSON.stringify(registrationPermissions),
          at,
          permission === "project.request.create" ? "requester" : authority.human.roleKey,
          registrationValidUntil ?? null,
        ],
      );
      const entitlements = new ProjectEntitlementRepository(this.source);
      for (const grant of starters) await entitlements.appendInTransaction(manager, grant);
      const result = {
        projectId: scope.projectId,
        version: 1,
        stage: "DRAFT",
        resultRef: ref(registered.onboarding.revisionId, 1, registered.onboarding.contentHash),
        registryRef: ref(registered.registry.revisionId, 1, registered.registry.contentHash),
        starterEntitlementRefs: starters.map((grant) =>
          ref(grant.revisionId, 1, grant.contentHash),
        ),
      };
      await manager.query(
        "INSERT INTO client_request_idempotency(workspace_id,project_id,actor_id,operation,client_key,request_hash,result_ref,created_at) VALUES($1,$2,$3,'project.register',$4,$5,$6,$7)",
        [workspaceId, scope.projectId, session.principalId, key, digest(normalized), result, at],
      );
      await this.authorizeRegistration?.(request, workspaceId, "MUTATE", permission);
      return result;
    };
    return transaction ? execute(transaction) : this.source.transaction("SERIALIZABLE", execute);
  }

  async onboarding(request: OnboardingRequest) {
    return this.source.transaction("REPEATABLE READ", async (manager) => {
      await authorizeAdministrative(manager, request, "project.onboarding.read");
      const current = await lockOnboarding(manager, request);
      const [row] = (await manager.query(
        "SELECT p.key,p.name,r.semantic_body FROM projects p JOIN project_registry_revisions r ON r.workspace_id=p.workspace_id AND r.project_id=p.id AND r.version=p.current_registry_version WHERE p.workspace_id=$1 AND p.id=$2",
        [request.workspaceId, request.projectId],
      )) as {
        key: string;
        name: string;
        semantic_body: { ownerIds: string[]; dataClassificationKey: string };
      }[];
      if (!row) return reject("PROJECT_RESOURCE_NOT_AVAILABLE", 404);
      const gates = (await manager.query(
        'SELECT gate_kind AS key,outcome,safe_issue_codes AS "safeIssueCodes",valid_until AS "validUntil" FROM (SELECT DISTINCT ON(gate_kind) * FROM project_onboarding_gate_results WHERE workspace_id=$1 AND project_id=$2 AND gate_result_id=ANY($3::uuid[]) ORDER BY gate_kind,evaluated_at DESC,gate_result_id DESC) latest ORDER BY gate_kind',
        [request.workspaceId, request.projectId, current.gateResultRefs.map((r) => r.id)],
      )) as { key: string; outcome: string; safeIssueCodes: string[]; validUntil: Date | null }[];
      const probes = (await manager.query(
        'SELECT logical_role AS "logicalRole",status,valid_until AS "validUntil" FROM (SELECT DISTINCT ON(logical_role,operation) * FROM capability_probe_results WHERE workspace_id=$1 AND project_id=$2 ORDER BY logical_role,operation,observed_at DESC,probe_id DESC) latest ORDER BY logical_role,operation',
        [request.workspaceId, request.projectId],
      )) as { logicalRole: string; status: string; validUntil: Date }[];
      return {
        project: {
          id: request.projectId,
          key: row.key,
          name: row.name,
          owners: row.semantic_body.ownerIds,
          classificationKey: row.semantic_body.dataClassificationKey,
        },
        stage: current.stage,
        capabilityMode: current.qaCapabilityMode,
        operationalState: current.operationalState,
        version: current.version,
        resultRef: ref(current.revisionId, current.version, current.contentHash),
        projectRegistryRef: current.projectRegistryRef,
        bindingRef: current.bindingRef,
        qaProjectContextRef: current.qaProjectContextRef,
        starterEntitlementSetHash: current.starterEntitlementSetHash,
        gates,
        probes,
        reasonCodes: [current.reasonCode],
      };
    });
  }

  async entitlement(
    request: OnboardingRequest,
    input: unknown,
    key: string,
    operation: "GRANT" | "REPLACE" | "REVOKE",
    entitlementId?: string,
    expectedVersion?: number,
  ) {
    const b = object(
      input,
      operation === "REVOKE"
        ? ["reason"]
        : [
            "principalId",
            "operation",
            "effect",
            "permissions",
            "classificationCeilingKey",
            "validFrom",
            "validUntil",
            "reason",
          ],
    );
    if (operation !== "REVOKE" && b.operation !== operation)
      return reject("ENTITLEMENT_OPERATION_INVALID", 400);
    const reason = text(b.reason);
    return this.source.transaction("SERIALIZABLE", async (manager) => {
      const current = await lockOnboarding(manager, request),
        permission =
          operation === "REVOKE" ? "project.entitlement.revoke" : "project.entitlement.grant";
      const authority = await authorizeAdministrative(
        manager,
        request,
        permission,
        "system-administrator",
        true,
      );
      return command(
        manager,
        request,
        authority.actor.principalId,
        permission,
        key,
        {
          operation,
          entitlementId: entitlementId ?? null,
          expectedVersion: expectedVersion ?? null,
          body: b,
        },
        async () => {
          if (
            operation === "GRANT" &&
            expectedVersion !== undefined &&
            current.version !== expectedVersion
          )
            return reject("ONBOARDING_VERSION_CONFLICT", 409);
          let before: ProjectEntitlementRevision | undefined;
          if (entitlementId) {
            const [row] = (await manager.query(
              "SELECT r.semantic_body FROM project_entitlement_headers h JOIN project_entitlement_revisions r ON r.workspace_id=h.workspace_id AND r.project_id=h.project_id AND r.entitlement_id=h.entitlement_id AND r.version=h.current_version WHERE h.workspace_id=$1 AND h.project_id=$2 AND h.entitlement_id=$3 FOR UPDATE OF h",
              [request.workspaceId, request.projectId, entitlementId],
            )) as { semantic_body: ProjectEntitlementRevision }[];
            before = row?.semantic_body;
            if (!before) return reject("ENTITLEMENT_NOT_AVAILABLE", 404);
            if (before.version !== expectedVersion || before.revokedAt)
              return reject("ENTITLEMENT_VERSION_CONFLICT", 409);
            if (!validHash(before as unknown as { contentHash: string }))
              return reject("ENTITLEMENT_REVISION_UNVERIFIED");
          }
          if (operation !== "GRANT" && !before) return reject("ENTITLEMENT_NOT_AVAILABLE", 404);
          const principalId = operation === "REVOKE" ? before!.principalId : uuid(b.principalId);
          if (before && before.principalId !== principalId)
            return reject("ENTITLEMENT_TARGET_IMMUTABLE", 409);
          if (operation !== "REVOKE") await activeMember(manager, request.workspaceId, principalId);
          const permissions = operation === "REVOKE" ? before!.permissions : b.permissions;
          if (
            !Array.isArray(permissions) ||
            permissions.length < 1 ||
            permissions.length > 100 ||
            permissions.some(
              (p) => typeof p !== "string" || !/^[a-z][a-z0-9.-]{1,127}$/u.test(p),
            ) ||
            new Set(permissions).size !== permissions.length
          )
            return reject("ENTITLEMENT_PERMISSIONS_INVALID", 400);
          const effect = operation === "REVOKE" ? before!.effect : b.effect;
          if (effect !== "ALLOW" && effect !== "DENY")
            return reject("ENTITLEMENT_EFFECT_INVALID", 400);
          const ceiling = classification(
            operation === "REVOKE" ? before!.classificationCeilingKey : b.classificationCeilingKey,
          );
          const grants = (await manager.query(
            "SELECT id,classification_ceiling_key FROM project_entitlements WHERE workspace_id=$1 AND project_id=$2 AND principal_id=$3 AND effect='ALLOW' AND revoked_at IS NULL AND valid_from<=clock_timestamp() AND (valid_until IS NULL OR valid_until>clock_timestamp()) AND (permissions ? $4 OR permissions ? '*')",
            [request.workspaceId, request.projectId, authority.actor.principalId, permission],
          )) as { id: string; classification_ceiling_key: string }[];
          if (
            operation !== "REVOKE" &&
            !grants.some(
              (g) =>
                authority.basis.entitlementRefs.some((r) => r.id === g.id) &&
                defaultClassificationCatalog.permits(
                  defaultClassificationCatalog.reference(g.classification_ceiling_key),
                  ceiling,
                ),
            )
          )
            return reject("CLASSIFICATION_CEILING_EXCEEDED", 403);
          const from = operation === "REVOKE" ? before!.validFrom : timestamp(b.validFrom),
            until =
              operation === "REVOKE"
                ? before!.validUntil
                : b.validUntil === undefined
                  ? undefined
                  : timestamp(b.validUntil);
          if (until && Date.parse(until) <= Date.parse(from))
            return reject("ENTITLEMENT_INTERVAL_INVALID", 400);
          const at = new Date().toISOString(),
            scope = scopeOf(request);
          const revision = createProjectEntitlementRevision({
            ...scope,
            revisionId: randomUUID(),
            entitlementId: entitlementId ?? randomUUID(),
            version: (before?.version ?? 0) + 1,
            principalId,
            operation,
            effect,
            permissions,
            classificationCeilingKey: ceiling.key,
            validFrom: from,
            ...(until ? { validUntil: until } : {}),
            ...(before
              ? { previousRevisionRef: ref(before.revisionId, before.version, before.contentHash) }
              : {}),
            ...(operation === "REVOKE" ? { revokedAt: at } : {}),
            actor: authority.human,
            reason,
            correlationId: randomUUID(),
            createdAt: at,
          });
          await new ProjectEntitlementRepository(this.source).appendInTransaction(
            manager,
            revision,
          );
          const revisions = (await manager.query(
            "SELECT r.semantic_body FROM project_entitlement_headers h JOIN project_entitlement_revisions r ON r.entitlement_id=h.entitlement_id AND r.version=h.current_version AND r.workspace_id=h.workspace_id AND r.project_id=h.project_id WHERE h.workspace_id=$1 AND h.project_id=$2",
            [request.workspaceId, request.projectId],
          )) as { semantic_body: ProjectEntitlementRevision }[];
          const { contentHash: _hash, ...prior } = current;
          void _hash;
          const next = createOnboardingRevision({
            ...prior,
            revisionId: randomUUID(),
            version: current.version + 1,
            starterEntitlementSetHash: entitlementSetHash(revisions.map((r) => r.semantic_body)),
            gateResultRefs: [],
            actor: authority.human,
            reasonCode: "PROJECT_ENTITLEMENTS_CHANGED",
            reason,
            correlationId: randomUUID(),
            createdAt: at,
          });
          await appendOnboarding(manager, next);
          const resultRef = ref(revision.revisionId, revision.version, revision.contentHash);
          await auditAndEvent(
            manager,
            scope,
            authority,
            `ENTITLEMENT_${operation}`,
            resultRef,
            reason,
            "PROJECT_ENTITLEMENTS_CHANGED",
          );
          return {
            entitlementId: revision.entitlementId,
            version: revision.version,
            resultRef,
            onboardingVersion: next.version,
          };
        },
      );
    });
  }
}
