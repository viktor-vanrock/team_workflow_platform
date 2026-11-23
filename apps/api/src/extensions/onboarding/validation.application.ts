import { randomUUID } from "node:crypto";

import type { DataSource, EntityManager } from "typeorm";

import { qaValidationCapabilityRequirementSetV1 } from "@awp/competency-qa/node";
import {
  type CapabilityProbeResult,
  createOnboardingRevision,
  createValidationReport,
  defaultClassificationCatalog,
  type ExactRevisionRef,
  type ProjectOnboardingRevision,
  type ProjectScope,
  type ValidationIssue,
} from "@awp/platform-core";
import { ProjectBindingRepository } from "@awp/platform-persistence-typeorm";
import {
  acceptBindingFunctionally,
  type CapabilityProbeRequest,
  type RequestedProbeTarget,
} from "@awp/runtime-composition";

import { acceptedSuitePins, automationObservations } from "./automation-facts.ts";
import {
  bindingHead,
  type BindingRevision,
  bindingRevision,
  configurationFacts,
  contextFact,
  publicationFacts,
} from "./binding-facts.ts";
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
  validHash,
} from "./durable-http.ts";

export const VALIDATION_HTTP_APPLICATION = "VALIDATION_HTTP_APPLICATION";
type Document = Record<string, unknown>;
const document = (v: unknown): Document => {
  if (!v || typeof v !== "object" || Array.isArray(v))
    return reject("BINDING_CONFIGURATION_INVALID", 409);
  return v as Document;
};
const documents = (v: unknown): Document[] => {
  if (!Array.isArray(v) || v.length > 100) return reject("BINDING_CONFIGURATION_INVALID", 409);
  return v.map(document);
};
const scopeOf = (s: ProjectScope) => ({ workspaceId: s.workspaceId, projectId: s.projectId });

async function configurationChecks(
  manager: EntityManager,
  scope: ProjectScope,
  binding: BindingRevision,
) {
  const refs = await configurationFacts(manager, scope, binding),
    entries = documents(binding.content.entries);
  const classification = defaultClassificationCatalog.reference(
    String(binding.content.dataClassificationKey),
  );
  const tuples = new Set<string>();
  for (const entry of entries) {
    const tuple = JSON.stringify([
      entry.logicalRole,
      entry.capabilityKey,
      entry.exactContractVersion,
      entry.environmentScope,
    ]);
    if (
      tuples.has(tuple) ||
      !["LOCAL", "NON_PROD", "PREPROD"].includes(String(entry.environmentScope))
    )
      return reject("BINDING_ENTRY_INVALID", 409);
    tuples.add(tuple);
    const profileRef = document(entry.profileRef),
      [profile] = (await manager.query(
        "SELECT content FROM connector_profile_revisions WHERE workspace_id=$1 AND header_id=$2 AND version=$3",
        [scope.workspaceId, profileRef.id, profileRef.version],
      )) as { content: Document }[];
    if (!profile) return reject("BINDING_PROFILE_UNAVAILABLE", 409);
    const configuration = documents(profile.content.capabilityConfigurations).find(
      (c) =>
        c.capabilityKey === entry.capabilityKey &&
        c.exactContractVersion === entry.exactContractVersion,
    )!;
    if (
      !Array.isArray(configuration.allowedDataClassifications) ||
      !configuration.allowedDataClassifications.includes(classification.key) ||
      !defaultClassificationCatalog.permits(
        defaultClassificationCatalog.reference(String(entry.classificationCeilingKey)),
        classification,
      )
    )
      return reject("BINDING_CLASSIFICATION_INVALID", 409);
    const operations = documents(configuration.operations);
    if (
      !operations.length ||
      new Set(operations.map((o) => o.operation)).size !== operations.length ||
      operations.some(
        (o) => typeof o.operation !== "string" || !["READ", "WRITE"].includes(String(o.effect)),
      )
    )
      return reject("BINDING_OPERATIONS_INVALID", 409);
    const required = qaValidationCapabilityRequirementSetV1.requirements.filter(
      (r) =>
        r.mode === "MANUAL" &&
        r.logicalRole === entry.logicalRole &&
        r.capabilityKey === entry.capabilityKey &&
        r.exactContractVersion === entry.exactContractVersion,
    );
    for (const requirement of required)
      if (requirement.operations.some((op) => !operations.some((o) => o.operation === op)))
        return reject("BINDING_MANUAL_OPERATION_MISSING", 409);
  }
  for (const requirement of qaValidationCapabilityRequirementSetV1.requirements.filter(
    (r) => r.mode === "MANUAL",
  ))
    if (
      !entries.some(
        (e) =>
          e.logicalRole === requirement.logicalRole &&
          e.capabilityKey === requirement.capabilityKey &&
          e.exactContractVersion === requirement.exactContractVersion,
      )
    )
      return reject("BINDING_MANUAL_ROLE_MISSING", 409);
  return refs;
}
async function latestValidation(
  manager: EntityManager,
  scope: ProjectScope,
  target: ExactRevisionRef,
) {
  const [row] = (await manager.query(
    "SELECT id,subject_version,outcome,content_hash,report,created_at FROM integration_validation_reports WHERE workspace_id=$1 AND project_id=$2 AND subject_kind='BINDING' AND subject_id=$3 ORDER BY created_at DESC,id DESC LIMIT 1",
    [scope.workspaceId, scope.projectId, target.id],
  )) as {
    id: string;
    subject_version: number;
    outcome: string;
    content_hash: string;
    report: Document;
    created_at: Date;
  }[];
  if (
    !row ||
    row.outcome !== "VALID" ||
    row.subject_version !== target.version ||
    row.content_hash !== target.contentHash ||
    row.created_at.getTime() > Date.now() ||
    row.report.id !== row.id ||
    row.report.workspaceId !== scope.workspaceId ||
    row.report.projectId !== scope.projectId ||
    row.report.subjectKind !== "BINDING" ||
    row.report.status !== "VALID" ||
    !Array.isArray(row.report.issues) ||
    row.report.issues.length ||
    !same(row.report.subjectRef, { id: target.id, version: target.version }) ||
    row.report.contentHash !== target.contentHash ||
    row.report.createdAt !== row.created_at.toISOString()
  )
    return reject("BINDING_VALIDATION_STALE", 409);
  return ref(row.id, 1, digest(row.report));
}
async function manualObservations(
  manager: EntityManager,
  current: ProjectOnboardingRevision,
  target: ExactRevisionRef,
  binding: BindingRevision,
  validationRef: ExactRevisionRef,
) {
  const configuration = await configurationFacts(manager, current, binding),
    entries = documents(binding.content.entries);
  const rows = (await manager.query(
    "SELECT DISTINCT ON(logical_role,capability_key,operation) semantic_body,content_hash FROM capability_probe_results WHERE workspace_id=$1 AND project_id=$2 AND binding_ref->>'id'=$3 ORDER BY logical_role,capability_key,operation,observed_at DESC,probe_id DESC",
    [current.workspaceId, current.projectId, target.id],
  )) as { semantic_body: CapabilityProbeResult; content_hash: string }[];
  const probes = rows
      .filter(
        (r) =>
          r.content_hash === r.semantic_body.contentHash &&
          validHash(r.semantic_body as unknown as { contentHash: string }),
      )
      .map((r) => r.semantic_body),
    used: ExactRevisionRef[] = [],
    issues: string[] = [],
    expiries: number[] = [];
  for (const requirement of qaValidationCapabilityRequirementSetV1.requirements.filter(
    (r) => r.mode === "MANUAL",
  )) {
    const entry = entries.find(
      (e) =>
        e.logicalRole === requirement.logicalRole &&
        e.capabilityKey === requirement.capabilityKey &&
        e.exactContractVersion === requirement.exactContractVersion,
    );
    if (!entry) {
      issues.push("MANUAL_ROLE_MISSING");
      continue;
    }
    const profile = configuration.find(
      (r) =>
        r.id === document(entry.profileRef).id && r.version === document(entry.profileRef).version,
    );
    const [profileRow] = (await manager.query(
      "SELECT content FROM connector_profile_revisions WHERE workspace_id=$1 AND header_id=$2 AND version=$3",
      [current.workspaceId, profile?.id, profile?.version],
    )) as { content: Document }[];
    const connection = profileRow
      ? configuration.find(
          (r) =>
            r.id === document(profileRow.content.connectionRef).id &&
            r.version === document(profileRow.content.connectionRef).version,
        )
      : undefined;
    for (const operation of requirement.operations) {
      const probe = probes.find(
        (p) =>
          p.logicalRole === requirement.logicalRole &&
          p.capabilityKey === requirement.capabilityKey &&
          p.operation === operation,
      );
      if (
        !probe ||
        !profile ||
        !connection ||
        probe.workspaceId !== current.workspaceId ||
        probe.projectId !== current.projectId ||
        probe.actorKind !== "SERVICE" ||
        probe.status !== "AVAILABLE" ||
        probe.safeIssueCodes.length ||
        !Number.isFinite(Date.parse(probe.observedAt)) ||
        Date.parse(probe.observedAt) > Date.now() ||
        !Number.isFinite(Date.parse(probe.validUntil)) ||
        Date.parse(probe.validUntil) <= Date.now() ||
        !same(probe.bindingRef, target) ||
        !same(probe.validationReportRef, validationRef) ||
        !same(probe.profileRef, profile) ||
        !same(probe.connectionRef, connection) ||
        probe.exactContractVersion !== requirement.exactContractVersion ||
        probe.environmentScope !== entry.environmentScope
      ) {
        issues.push("MANUAL_PROBES_STALE");
        continue;
      }
      if (
        profileRow?.content.mappingRef &&
        !same(
          probe.mappingRef,
          configuration.find((r) => r.id === document(profileRow.content.mappingRef).id),
        )
      ) {
        issues.push("MANUAL_PROBES_STALE");
        continue;
      }
      used.push(ref(probe.probeId, probe.version, probe.contentHash));
      expiries.push(Date.parse(probe.validUntil));
    }
  }
  return {
    refs: used,
    safeIssueCodes: [...new Set(issues)].sort(),
    validUntil: Math.min(Date.now() + 60_000, ...expiries),
  };
}
export class DurableValidationHttpApplication {
  constructor(private readonly source: DataSource) {}
  private async advance(
    manager: EntityManager,
    current: ProjectOnboardingRevision,
    authority: AdministrativeAuthority,
    reason: string,
  ) {
    const { contentHash: _hash, ...previous } = current;
    void _hash;
    const next = createOnboardingRevision({
      ...previous,
      version: current.version + 1,
      revisionId: randomUUID(),
      stage: "VALIDATING",
      gateResultRefs: [],
      actor: authority.human,
      reasonCode: reason,
      reason,
      correlationId: randomUUID(),
      createdAt: new Date().toISOString(),
    });
    await appendOnboarding(manager, next);
    return next.version;
  }
  async validate(
    request: OnboardingRequest,
    id: string,
    input: unknown,
    key: string,
    expectedVersion: number,
  ) {
    const b = object(input, ["bindingVersion", "bindingContentHash", "probeKeys"]),
      target = exact({ id, version: integer(b.bindingVersion), contentHash: b.bindingContentHash });
    if (
      !Array.isArray(b.probeKeys) ||
      b.probeKeys.length > 32 ||
      new Set(b.probeKeys).size !== b.probeKeys.length ||
      b.probeKeys.some(
        (key) =>
          !qaValidationCapabilityRequirementSetV1.requirements.some(
            (r) => r.requirementKey === key,
          ),
      )
    )
      return reject("CAPABILITY_PROBE_KEYS_INVALID", 400);
    const probeKeys = b.probeKeys as string[];
    return this.source.transaction("SERIALIZABLE", async (manager) => {
      const current = await lockOnboarding(manager, request),
        authority = await authorizeAdministrative(
          manager,
          request,
          "integration.validate",
          "system-administrator",
        );
      return command(
        manager,
        request,
        authority.actor.principalId,
        "integration.validate",
        key,
        { id, body: b, expectedVersion },
        async () => {
          const head = await bindingHead(manager, request, id);
          if (Number(head.row_version) !== expectedVersion)
            return reject("BINDING_VERSION_CONFLICT", 409);
          const binding = await bindingRevision(manager, request, target);
          if (!["DRAFT", "VALIDATED"].includes(binding.status))
            return reject("BINDING_DRAFT_REQUIRED", 409);
          const issues: ValidationIssue[] = [];
          try {
            await configurationChecks(manager, request, binding);
          } catch {
            issues.push({
              code: "BINDING_CONFIGURATION_INVALID",
              message: "Current published configuration or required manual operations are invalid",
            });
          }
          const report = createValidationReport({
            context: {
              actor: authority.actor,
              scope: { kind: "PROJECT", ...scopeOf(request) },
              authorizationBasis: authority.basis,
              correlationId: randomUUID(),
              causationId: randomUUID(),
            },
            subjectKind: "BINDING",
            subjectId: id,
            subjectVersion: target.version,
            contentHash: target.contentHash,
            issues,
            clock: { now: () => new Date() },
            ids: { next: () => randomUUID() },
          });
          const wire = { ...report, createdAt: report.createdAt.toISOString() },
            validationReportRef = ref(report.id, 1, digest(wire));
          await manager.query(
            "INSERT INTO integration_validation_reports(id,workspace_id,project_id,subject_kind,subject_id,subject_version,outcome,content_hash,report,created_at) VALUES($1,$2,$3,'BINDING',$4,$5,$6,$7,$8,$9)",
            [
              report.id,
              request.workspaceId,
              request.projectId,
              id,
              target.version,
              report.status,
              target.contentHash,
              wire,
              report.createdAt,
            ],
          );
          if (report.status === "VALID")
            await manager.query(
              "UPDATE project_integration_binding_revisions SET status='VALIDATED' WHERE workspace_id=$1 AND project_id=$2 AND header_id=$3 AND version=$4",
              [request.workspaceId, request.projectId, id, target.version],
            );
          await manager.query(
            "UPDATE project_integration_binding_headers SET row_version=row_version+1 WHERE workspace_id=$1 AND project_id=$2 AND id=$3",
            [request.workspaceId, request.projectId, id],
          );
          let probeRequestRef: ExactRevisionRef | undefined;
          if (report.status === "VALID" && probeKeys.length) {
            const configuration = await configurationFacts(manager, request, binding),
              entries = documents(binding.content.entries),
              targets: RequestedProbeTarget[] = [];
            for (const requirement of qaValidationCapabilityRequirementSetV1.requirements.filter(
              (r) => probeKeys.includes(r.requirementKey),
            )) {
              const entry = entries.find(
                (e) =>
                  e.logicalRole === requirement.logicalRole &&
                  e.capabilityKey === requirement.capabilityKey &&
                  e.exactContractVersion === requirement.exactContractVersion,
              );
              if (!entry) return reject("REQUESTED_CAPABILITY_NOT_CONFIGURED", 422);
              const profileRef = configuration.find(
                (r) =>
                  r.id === document(entry.profileRef).id &&
                  r.version === document(entry.profileRef).version,
              )!;
              const [profile] = (await manager.query(
                "SELECT content FROM connector_profile_revisions WHERE workspace_id=$1 AND header_id=$2 AND version=$3",
                [request.workspaceId, profileRef.id, profileRef.version],
              )) as { content: Document }[];
              const connectionRef = configuration.find(
                (r) =>
                  r.id === document(profile!.content.connectionRef).id &&
                  r.version === document(profile!.content.connectionRef).version,
              )!;
              const mappingRef = profile!.content.mappingRef
                ? configuration.find((r) => r.id === document(profile!.content.mappingRef).id)
                : undefined;
              for (const operation of requirement.operations)
                targets.push({
                  ...scopeOf(request),
                  bindingRef: target,
                  profileRef,
                  connectionRef,
                  ...(mappingRef ? { mappingRef } : {}),
                  validationReportRef,
                  logicalRole: requirement.logicalRole,
                  capabilityKey: requirement.capabilityKey,
                  exactContractVersion: requirement.exactContractVersion,
                  operation,
                  environmentScope:
                    entry.environmentScope as RequestedProbeTarget["environmentScope"],
                });
            }
            const job: CapabilityProbeRequest = {
              schemaVersion: 1,
              requestId: randomUUID(),
              ...scopeOf(request),
              actor: authority.actor,
              validationReportRef,
              targets,
              createdAt: new Date().toISOString(),
            };
            probeRequestRef = ref(job.requestId, 1, digest(job));
            await manager.query(
              "INSERT INTO capability_probe_requests(request_id,workspace_id,project_id,requested_by,validation_report_id,semantic_body,content_hash,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
              [
                job.requestId,
                job.workspaceId,
                job.projectId,
                job.actor.principalId,
                validationReportRef.id,
                job,
                probeRequestRef.contentHash,
                job.createdAt,
              ],
            );
          }
          const onboardingVersion = await this.advance(
            manager,
            current,
            authority,
            "BINDING_VALIDATED",
          );
          await auditAndEvent(
            manager,
            request,
            authority,
            "BINDING_VALIDATION_RECORDED",
            validationReportRef,
            "Configuration validation",
            "PROJECT_BINDING_CHANGED",
          );
          return {
            resultRef: validationReportRef,
            validationReportRef,
            ...(probeRequestRef ? { probeRequestRef } : {}),
            outcome: report.status,
            bindingState: report.status === "VALID" ? "VALIDATED" : binding.status,
            resourceVersion: expectedVersion + 1,
            onboardingVersion,
            safeIssueCodes: issues.map((i) => i.code),
          };
        },
      );
    });
  }
  async accept(request: OnboardingRequest, id: string, input: unknown, key: string) {
    const b = object(input, [
        "bindingRef",
        "validationReportRef",
        "qaProjectContextRef",
        "acceptedResourceRefs",
        "checklistRef",
        "outcome",
        "reason",
      ]),
      target = exact(b.bindingRef),
      validationRef = exact(b.validationReportRef),
      contextRef = exact(b.qaProjectContextRef),
      acceptedResourceRefs = exacts(b.acceptedResourceRefs),
      checklistRef = exact(b.checklistRef),
      reason = text(b.reason);
    if (target.id !== id || !["ACCEPTED", "REJECTED"].includes(String(b.outcome)))
      return reject("BINDING_ACCEPTANCE_INVALID", 400);
    return this.source.transaction("SERIALIZABLE", async (manager) => {
      const current = await lockOnboarding(manager, request),
        authority = await authorizeAdministrative(
          manager,
          request,
          "integration.accept",
          "qa-lead",
        );
      return command(
        manager,
        request,
        authority.actor.principalId,
        "integration.accept",
        key,
        { id, body: b },
        async () => {
          await bindingHead(manager, request, id);
          const binding = await bindingRevision(manager, request, target),
            configuration = await configurationFacts(manager, request, binding);
          if (
            !same(await contextFact(manager, current), contextRef) ||
            !same(await latestValidation(manager, request, target), validationRef)
          )
            return reject("BINDING_ACCEPTANCE_PREREQUISITES_STALE", 409);
          const [row] = (await manager.query(
            "SELECT semantic_body FROM qa_project_context_revisions_v2 WHERE workspace_id=$1 AND project_id=$2 AND context_id=$3 AND version=$4",
            [request.workspaceId, request.projectId, contextRef.id, contextRef.version],
          )) as { semantic_body: Document }[];
          const context = row!.semantic_body,
            checklists = Array.isArray(context.checklistPolicyRefs)
              ? context.checklistPolicyRefs
              : [];
          const allowed = [
            ...configuration,
            ...[
              "environmentRefs",
              "testDataCatalogRefs",
              "accountPoolRefs",
              "targetPolicyRefs",
              "scopePolicyRefs",
              "checklistPolicyRefs",
            ].flatMap((k) => (Array.isArray(context[k]) ? (context[k] as unknown[]) : [])),
          ];
          // Unknown resources may be current published Suite revisions. Resolve and validate them
          // against the exact Binding/profile/environment/policy pins before accepting any.
          if (acceptedResourceRefs.some((r) => !allowed.some((a) => same(a, r)))) {
            try {
              const suites = await acceptedSuitePins(
                manager,
                current,
                target,
                binding,
                context,
                acceptedResourceRefs,
              );
              allowed.push(
                ...suites.flatMap((s) => [s.suiteRef, s.environmentRef, s.evidencePolicyRef]),
              );
            } catch (error) {
              if (error && typeof error === "object" && "driverError" in error) throw error;
              return reject("BINDING_ACCEPTANCE_RESOURCE_UNAVAILABLE", 409);
            }
          }
          if (
            !checklists.some((r) => same(r, checklistRef)) ||
            acceptedResourceRefs.some((r) => !allowed.some((a) => same(a, r)))
          )
            return reject("BINDING_ACCEPTANCE_RESOURCE_UNAVAILABLE", 409);
          const acceptance = acceptBindingFunctionally({
            ...scopeOf(request),
            acceptanceId: randomUUID(),
            bindingRef: target,
            validationReportRef: validationRef,
            qaProjectContextRef: contextRef,
            acceptedResourceRefs,
            checklistRef,
            acceptedBy: authority.human,
            acceptedAt: new Date().toISOString(),
            safeIssueCodes: b.outcome === "REJECTED" ? ["QA_FUNCTIONAL_ACCEPTANCE_REJECTED"] : [],
          });
          await new ProjectBindingRepository(manager).appendFunctionalAcceptance(acceptance);
          const resultRef = ref(acceptance.acceptanceId, 1, acceptance.contentHash);
          await auditAndEvent(
            manager,
            request,
            authority,
            "BINDING_FUNCTIONAL_ACCEPTANCE_RECORDED",
            resultRef,
            reason,
            "PROJECT_BINDING_CHANGED",
          );
          return { resultRef, outcome: acceptance.outcome };
        },
      );
    });
  }
  async evaluate(request: OnboardingRequest, input: unknown, key: string, expectedVersion: number) {
    const b = object(input, [
      "gateKind",
      "projectRegistryRef",
      "starterEntitlementSetHash",
      "bindingRef",
      "qaProjectContextRef",
      "requestedCapabilityMode",
    ]);
    if (b.gateKind !== "L0") return reject("EXTERNAL_GATE_REQUIRES_PIPELINE_EVIDENCE", 422);
    if (b.requestedCapabilityMode !== "MANUAL_ONLY" && b.requestedCapabilityMode !== "FULL_QA")
      return reject("QA_CAPABILITY_MODE_INVALID", 400);
    const registryRef = exact(b.projectRegistryRef),
      target = exact(b.bindingRef),
      contextRef = exact(b.qaProjectContextRef);
    return this.source.transaction("SERIALIZABLE", async (manager) => {
      const current = await lockOnboarding(manager, request),
        authority = await authorizeAdministrative(
          manager,
          request,
          "project.onboarding.evaluate",
          "system-administrator",
        );
      return command(
        manager,
        request,
        authority.actor.principalId,
        "project.onboarding.evaluate",
        key,
        { body: b, expectedVersion },
        async () => {
          if (
            current.version !== expectedVersion ||
            current.operationalState !== "ACTIVE" ||
            !same(current.projectRegistryRef, registryRef) ||
            !same(current.qaProjectContextRef, contextRef) ||
            !same(current.bindingRef, target) ||
            current.starterEntitlementSetHash !== b.starterEntitlementSetHash
          )
            return reject("ONBOARDING_PREREQUISITES_STALE", 409);
          const [registry] = (await manager.query(
            "SELECT r.semantic_body,r.content_hash FROM projects p JOIN project_registry_revisions r ON r.workspace_id=p.workspace_id AND r.project_id=p.id AND r.version=p.current_registry_version WHERE p.workspace_id=$1 AND p.id=$2 AND r.revision_id=$3 AND r.version=$4 FOR SHARE OF p,r",
            [request.workspaceId, request.projectId, registryRef.id, registryRef.version],
          )) as { semantic_body: Document; content_hash: string }[];
          if (
            !registry ||
            registry.content_hash !== registryRef.contentHash ||
            !validHash(registry.semantic_body as { contentHash: string }) ||
            registry.semantic_body.verificationStatus !== "CURRENT" ||
            digest(registry.semantic_body.ownerIds) !== current.ownerSetHash
          )
            return reject("ONBOARDING_REGISTRY_STALE", 409);
          const head = await bindingHead(manager, request, target.id),
            binding = await bindingRevision(manager, request, target);
          if (head.current_published_version !== target.version || binding.status !== "PUBLISHED")
            return reject("BINDING_PUBLISHED_REVISION_REQUIRED", 409);
          const prerequisites = await publicationFacts(manager, current, target, binding),
            validationRef = await latestValidation(manager, request, target),
            probes = await manualObservations(manager, current, target, binding, validationRef);
          const automation =
            b.requestedCapabilityMode === "FULL_QA"
              ? await automationObservations(manager, current, target, binding, validationRef)
              : undefined;
          const evaluatedAt = Date.now();
          const safeIssueCodes = [
            ...new Set([
              ...probes.safeIssueCodes,
              ...(automation?.safeIssueCodes ?? []),
              ...(probes.validUntil <= evaluatedAt ? ["MANUAL_PROBES_STALE"] : []),
              ...(automation && automation.validUntil <= evaluatedAt
                ? ["AUTOMATION_CONFIGURATION_UNAVAILABLE"]
                : []),
            ]),
          ].sort();
          const outcome = safeIssueCodes.length ? "BLOCKED_INPUT" : "PASS",
            at = new Date(evaluatedAt).toISOString(),
            gateId = randomUUID();
          const mode =
            outcome === "PASS" && b.requestedCapabilityMode === "FULL_QA"
              ? "FULL_QA"
              : "MANUAL_ONLY";
          const body = {
            gateResultId: gateId,
            version: 1,
            ...scopeOf(request),
            gateKind: "L0",
            checkKey:
              b.requestedCapabilityMode === "FULL_QA"
                ? "onboarding-current-full-qa-facts"
                : "onboarding-current-manual-facts",
            checkVersion: "1",
            subjectRefs: [
              ref(current.revisionId, current.version, current.contentHash),
              registryRef,
              target,
              contextRef,
              ...prerequisites,
            ],
            outcome,
            safeIssueCodes,
            evidenceRefs: [...probes.refs, ...(automation?.refs ?? [])],
            evaluatedBy: authority.human,
            evaluatedAt: at,
            validUntil: new Date(
              outcome === "PASS"
                ? Math.min(probes.validUntil, automation?.validUntil ?? Infinity)
                : evaluatedAt + 60_000,
            ).toISOString(),
          };
          const gate = { ...body, contentHash: digest(body) },
            gateRef = ref(gateId, 1, gate.contentHash);
          await manager.query(
            "INSERT INTO project_onboarding_gate_results(gate_result_id,workspace_id,project_id,gate_kind,check_key,check_version,subject_refs,outcome,safe_issue_codes,evidence_refs,evaluated_by,evaluated_at,valid_until,semantic_body,content_hash) VALUES($1,$2,$3,'L0',$4,'1',$5,$6,$7,$8,$9,$10,$11,$12,$13)",
            [
              gateId,
              request.workspaceId,
              request.projectId,
              body.checkKey,
              JSON.stringify(body.subjectRefs),
              outcome,
              JSON.stringify(body.safeIssueCodes),
              JSON.stringify(body.evidenceRefs),
              authority.human,
              at,
              body.validUntil,
              gate,
              gate.contentHash,
            ],
          );
          const { contentHash: _hash, ...previous } = current;
          void _hash;
          const next = createOnboardingRevision({
            ...previous,
            revisionId: randomUUID(),
            version: current.version + 1,
            stage: outcome === "PASS" ? "SHADOW" : "NEEDS_FIX",
            qaCapabilityMode: mode,
            intendedCapabilityMode: b.requestedCapabilityMode as "MANUAL_ONLY" | "FULL_QA",
            gateResultRefs: [gateRef],
            actor: authority.human,
            reasonCode: `L0_${outcome}`,
            reason: `Evaluate current ${b.requestedCapabilityMode} capability observations`,
            correlationId: randomUUID(),
            createdAt: at,
          });
          await appendOnboarding(manager, next);
          const resultRef = ref(next.revisionId, next.version, next.contentHash);
          await auditAndEvent(
            manager,
            request,
            authority,
            "ONBOARDING_L0_EVALUATED",
            resultRef,
            next.reason,
          );
          return {
            resultRef,
            gateRef,
            outcome,
            stage: next.stage,
            version: next.version,
            capabilityMode: next.qaCapabilityMode,
            safeIssueCodes,
          };
        },
      );
    });
  }
}
