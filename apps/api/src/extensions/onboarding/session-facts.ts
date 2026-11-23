import type { EntityManager } from "typeorm";

import {
  buildTargetSnapshot,
  ManualExecutionUnitOfWork,
  type QaTargetSnapshotV2,
  type QaTestSession,
} from "@awp/competency-qa/node";
import { designContractRegistry, type JsonValue } from "@awp/platform-contracts";
import type { ExactRevisionRef, ProjectOnboardingRevision, ProjectScope } from "@awp/platform-core";
import { integrationConfigurationHash } from "@awp/runtime-composition";

import { digest, exact, ref, reject, same, validHash } from "./durable-http.ts";

type Source = Pick<EntityManager, "query">;
type Document = Record<string, unknown>;
const object = (v: unknown) => v as Document;
const refs = (v: unknown) => {
  if (!Array.isArray(v)) return reject("QA_SESSION_CONTEXT_INVALID", 409);
  return v.map(exact);
};
const external = (v: {
  id: string;
  version: string;
  contentHash: `sha256:${string}`;
}): ExactRevisionRef => exact({ id: v.id, version: Number(v.version), contentHash: v.contentHash });
const args = (scope: ProjectScope) => [scope.workspaceId, scope.projectId];

/** Lock the same Core header that administrative changes update. Legacy records retain their original path. */
async function onboarding(source: Source, scope: ProjectScope) {
  const [row] = (await source.query(
    "SELECT r.semantic_body,r.content_hash,r.reason_code,h.current_operational_state FROM project_onboarding_headers h JOIN project_onboarding_revisions r ON r.workspace_id=h.workspace_id AND r.project_id=h.project_id AND r.version=h.current_version WHERE h.workspace_id=$1 AND h.project_id=$2 FOR SHARE OF h",
    args(scope),
  )) as {
    semantic_body: ProjectOnboardingRevision;
    content_hash: string;
    reason_code: string;
    current_operational_state: string;
  }[];
  if (!row) return undefined;
  if (row.current_operational_state !== "ACTIVE") return reject("PROJECT_SUSPENDED", 409);
  if (row.reason_code === "HISTORICAL_BOOTSTRAP" && !row.semantic_body.qaProjectContextRef)
    return undefined;
  if (
    row.content_hash !== row.semantic_body.contentHash ||
    !validHash({ ...row.semantic_body }) ||
    row.semantic_body.workspaceId !== scope.workspaceId ||
    row.semantic_body.projectId !== scope.projectId
  )
    return reject("QA_SESSION_ONBOARDING_UNVERIFIED", 409);
  return row.semantic_body;
}
export async function assertOnboardingAutomationMode(source: Source, scope: ProjectScope) {
  const [head] = (await source.query(
    "SELECT current_operational_state,current_capability_mode FROM project_onboarding_headers WHERE workspace_id=$1 AND project_id=$2 FOR SHARE",
    args(scope),
  )) as { current_operational_state: string; current_capability_mode: string }[];
  if (head?.current_operational_state !== undefined && head.current_operational_state !== "ACTIVE")
    return reject("PROJECT_SUSPENDED", 409);
  if (head && head.current_capability_mode !== "FULL_QA")
    return reject("AUTOMATION_REQUIRES_FULL_QA", 409);
}
async function context(source: Source, current: ProjectOnboardingRevision) {
  if (
    !["SHADOW", "PILOT_ACTIVE"].includes(current.stage) ||
    !current.bindingRef ||
    !current.qaProjectContextRef
  )
    return reject("QA_SESSION_ONBOARDING_NOT_READY", 409);
  const target = current.qaProjectContextRef;
  const [row] = (await source.query(
    "SELECT r.semantic_body,r.content_hash FROM qa_project_context_headers_v2 h JOIN qa_project_context_revisions_v2 r ON (r.workspace_id,r.project_id,r.context_id,r.version)=(h.workspace_id,h.project_id,h.context_id,h.current_published_version) WHERE h.workspace_id=$1 AND h.project_id=$2 AND h.context_id=$3 AND r.version=$4 AND r.state='PUBLISHED' FOR SHARE OF h,r",
    [...args(current), target.id, target.version],
  )) as { semantic_body: Document; content_hash: string }[];
  if (
    !row ||
    row.content_hash !== target.contentHash ||
    !validHash(row.semantic_body as { contentHash: string })
  )
    return reject("QA_SESSION_CONTEXT_STALE", 409);
  return row.semantic_body;
}
async function environment(source: Source, scope: ProjectScope, target: ExactRevisionRef) {
  const [row] = (await source.query(
    "SELECT r.semantic_body,r.content_hash FROM qa_project_environment_headers h JOIN qa_project_environment_revisions r ON (r.workspace_id,r.project_id,r.environment_id,r.version)=(h.workspace_id,h.project_id,h.environment_id,h.current_published_version) WHERE h.workspace_id=$1 AND h.project_id=$2 AND h.environment_id=$3 AND r.version=$4 AND r.state='PUBLISHED' FOR SHARE OF h,r",
    [...args(scope), target.id, target.version],
  )) as { semantic_body: Document; content_hash: string }[];
  if (
    !row ||
    row.content_hash !== target.contentHash ||
    !validHash(row.semantic_body as { contentHash: string }) ||
    !["LOCAL", "NON_PROD", "PREPROD"].includes(String(row.semantic_body.scope))
  )
    return reject("QA_SESSION_ENVIRONMENT_STALE", 409);
  return {
    environmentId: target.id,
    revision: target.version,
    scope: row.semantic_body.scope as "LOCAL" | "NON_PROD" | "PREPROD",
  };
}
/** Read the published v2 context directly; do not manufacture a legacy policy revision. */
export async function onboardingSessionContext(
  source: Source,
  scope: ProjectScope,
  target: ExactRevisionRef,
) {
  const current = await onboarding(source, scope);
  if (!current) return undefined;
  if (!same(current.qaProjectContextRef, target)) return reject("QA_SESSION_CONTEXT_STALE", 409);
  const body = await context(source, current),
    allowedEnvironments = [];
  for (const target of refs(body.environmentRefs))
    allowedEnvironments.push(await environment(source, scope, target));
  return { allowedEnvironments };
}
async function configuration(source: Source, current: ProjectOnboardingRevision) {
  const target = current.bindingRef;
  if (!target) return reject("QA_SESSION_BINDING_REQUIRED", 409);
  const [row] = (await source.query(
    "SELECT r.content,r.content_hash FROM project_integration_binding_headers h JOIN project_integration_binding_revisions r ON r.workspace_id=h.workspace_id AND r.project_id=h.project_id AND r.header_id=h.id AND r.version=h.current_published_version WHERE h.workspace_id=$1 AND h.project_id=$2 AND h.id=$3 AND r.version=$4 AND r.status='PUBLISHED' FOR SHARE OF h,r",
    [...args(current), target.id, target.version],
  )) as { content: Document; content_hash: string }[];
  if (
    !row ||
    row.content_hash !== target.contentHash ||
    integrationConfigurationHash("project_integration_binding", row.content) !== target.contentHash
  )
    return reject("QA_SESSION_BINDING_STALE", 409);
  const [report] = (await source.query(
    "SELECT id,report,content_hash,subject_version,outcome FROM integration_validation_reports WHERE workspace_id=$1 AND project_id=$2 AND subject_kind='BINDING' AND subject_id=$3 ORDER BY created_at DESC,id DESC LIMIT 1",
    [...args(current), target.id],
  )) as {
    id: string;
    report: Document;
    content_hash: string;
    subject_version: number;
    outcome: string;
  }[];
  if (
    !report ||
    report.subject_version !== target.version ||
    report.content_hash !== target.contentHash ||
    report.outcome !== "VALID"
  )
    return reject("QA_SESSION_BINDING_VALIDATION_STALE", 409);
  const validationReportRef = ref(report.id, 1, digest(report.report));
  const load = async (
    table: "connector_profile" | "connection" | "connector_mapping",
    pin: Document,
  ) => {
    const [value] = (await source.query(
      `SELECT r.content,r.content_hash FROM ${table}_headers h JOIN ${table}_revisions r ON r.workspace_id=h.workspace_id AND r.header_id=h.id AND r.version=h.current_published_version WHERE h.workspace_id=$1 AND h.id=$2 AND r.version=$3 AND r.status='PUBLISHED' FOR SHARE OF h,r`,
      [current.workspaceId, pin.id, pin.version],
    )) as { content: Document; content_hash: `sha256:${string}` }[];
    if (
      !value ||
      integrationConfigurationHash(table, value.content) !== value.content_hash ||
      (pin.contentHash && pin.contentHash !== value.content_hash)
    )
      return reject("QA_SESSION_CONFIGURATION_STALE", 409);
    return {
      body: value.content,
      ref: ref(String(pin.id), Number(pin.version), value.content_hash),
    };
  };
  const pins: QaTargetSnapshotV2["configurationPins"][number][] = [];
  for (const entry of row.content.entries as Document[]) {
    const profile = await load("connector_profile", object(entry.profileRef)),
      connection = await load("connection", object(profile.body.connectionRef));
    const mapping = profile.body.mappingRef
      ? await load("connector_mapping", object(profile.body.mappingRef))
      : undefined;
    const capabilities = (profile.body.capabilityConfigurations as Document[]).filter(
      (c) =>
        c.capabilityKey === entry.capabilityKey &&
        c.exactContractVersion === entry.exactContractVersion,
    );
    if (
      capabilities.length !== 1 ||
      !(capabilities[0]!.environmentScopes as string[]).includes(String(entry.environmentScope)) ||
      !same(
        profile.body.connectorRef ?? profile.body.connectorKey,
        connection.body.connectorRef ?? connection.body.connectorKey,
      )
    )
      return reject("QA_SESSION_CONFIGURATION_STALE", 409);
    pins.push({
      ordinal: pins.length + 1,
      logicalRole: String(entry.logicalRole),
      capabilityKey: String(entry.capabilityKey),
      exactContractVersion: String(entry.exactContractVersion),
      bindingRef: target,
      profileRef: profile.ref,
      connectionRef: connection.ref,
      ...(mapping ? { mappingRef: mapping.ref } : {}),
      validationReportRef,
      operationSetHash: digest(capabilities[0]!.operations),
      externalScopeHash: digest(entry.externalScope),
    });
  }
  if (!pins.length) return reject("QA_SESSION_BINDING_REQUIRED", 409);
  return pins;
}
export async function onboardingSessionProfiles(
  source: Source,
  scope: ProjectScope,
  binding: { id: string; version: number },
) {
  const current = await onboarding(source, scope);
  if (!current) return undefined;
  await context(source, current);
  if (current.bindingRef?.id !== binding.id || current.bindingRef.version !== binding.version)
    return reject("QA_SESSION_BINDING_STALE", 409);
  return [
    ...new Map(
      (await configuration(source, current)).map((pin) => [
        pin.profileRef.id,
        { id: pin.profileRef.id, version: pin.profileRef.version },
      ]),
    ).values(),
  ];
}
/** Capture the additive immutable v2 record in the very transaction that starts the Session. */
export async function captureOnboardingSessionTarget(
  manager: EntityManager,
  session: QaTestSession,
) {
  const current = await onboarding(manager, session);
  if (!current) return;
  const body = await context(manager, current),
    pins = await configuration(manager, current),
    legacy = session.targetSnapshot;
  if (
    current.bindingRef!.id !== legacy.bindingRef.id ||
    current.bindingRef!.version !== legacy.bindingRef.version
  )
    return reject("QA_SESSION_BINDING_STALE", 409);
  const environmentRef = refs(body.environmentRefs).find(
    (r) => r.id === legacy.environmentRef.id && r.version === legacy.environmentRef.revision,
  );
  if (!environmentRef) return reject("QA_SESSION_ENVIRONMENT_NOT_ALLOWED", 409);
  await environment(manager, session, environmentRef);
  const testDataRefs = legacy.testDataRef ? [external(legacy.testDataRef)] : [],
    accountLeaseRefs = legacy.accountLeaseRef ? [external(legacy.accountLeaseRef)] : [];
  for (const target of testDataRefs) {
    if (!refs(body.testDataCatalogRefs).some((r) => same(r, target)))
      return reject("QA_SESSION_TEST_DATA_NOT_ALLOWED", 409);
    const [row] = (await manager.query(
      "SELECT semantic_body,content_hash FROM qa_test_data_catalog_entries WHERE workspace_id=$1 AND project_id=$2 AND entry_id=$3 ORDER BY version DESC LIMIT 1 FOR SHARE",
      [...args(session), target.id],
    )) as { semantic_body: Document; content_hash: string }[];
    if (
      !row ||
      row.content_hash !== target.contentHash ||
      !validHash(row.semantic_body as { contentHash: string }) ||
      row.semantic_body.version !== target.version ||
      row.semantic_body.state !== "PUBLISHED" ||
      !refs(row.semantic_body.allowedEnvironmentRefs).some((r) => same(r, environmentRef))
    )
      return reject("QA_SESSION_TEST_DATA_STALE", 409);
  }
  for (const target of accountLeaseRefs) {
    const [row] = (await manager.query(
      "SELECT r.semantic_body,r.content_hash FROM qa_test_account_lease_heads h JOIN qa_test_account_leases r ON r.workspace_id=h.workspace_id AND r.project_id=h.project_id AND r.lease_id=h.lease_id AND r.version=h.current_version WHERE h.workspace_id=$1 AND h.project_id=$2 AND h.lease_id=$3 AND h.state='ACTIVE' FOR SHARE OF h,r",
      [...args(session), target.id],
    )) as { semantic_body: Document; content_hash: string }[];
    if (
      !row ||
      row.content_hash !== target.contentHash ||
      !validHash(row.semantic_body as { contentHash: string }) ||
      row.semantic_body.version !== target.version ||
      !Number.isFinite(Date.parse(String(row.semantic_body.expiresAt))) ||
      Date.parse(String(row.semantic_body.expiresAt)) <= Date.now() ||
      !same(row.semantic_body.environmentRef, environmentRef) ||
      row.semantic_body.subjectRef !== `work-item:${session.workItemId}`
    )
      return reject("QA_SESSION_ACCOUNT_LEASE_NOT_ACTIVE", 409);
  }
  const definitions = legacy.checklistRefs.map(external);
  if (definitions.some((target) => !refs(body.checklistPolicyRefs).some((r) => same(r, target))))
    return reject("QA_SESSION_CHECKLIST_STALE", 409);
  const [stored] = (await manager.query(
    "SELECT semantic_body FROM qa_target_snapshots_v2 WHERE workspace_id=$1 AND project_id=$2 AND session_id=$3",
    [...args(session), session.id],
  )) as { semantic_body: QaTargetSnapshotV2 }[];
  if (stored) {
    if (
      !validHash({ ...stored.semantic_body }) ||
      !same(stored.semantic_body.environmentRef, environmentRef) ||
      !same(stored.semantic_body.configurationPins, pins) ||
      !same(stored.semantic_body.testDataRefs, testDataRefs) ||
      !same(stored.semantic_body.accountLeaseRefs, accountLeaseRefs) ||
      !same(stored.semantic_body.modeConfiguration.value, body)
    )
      return reject("QA_SESSION_CAPTURED_TARGET_STALE", 409);
    return;
  }
  const modeSchema = "urn:awp:schemas:007:qa-project-context:v2";
  designContractRegistry.validateById(modeSchema, body);
  const snapshot = buildTargetSnapshot({
    snapshotId: session.id,
    ...{ workspaceId: session.workspaceId, projectId: session.projectId },
    workItemId: session.workItemId,
    sessionId: session.id,
    mode: "MANUAL",
    sourceRefs: [
      session.planRevisionRef,
      ref(current.revisionId, current.version, current.contentHash),
    ],
    buildRef: external(legacy.buildRef),
    environmentRef,
    testDataRefs,
    accountLeaseRefs,
    definitionRefs: definitions,
    configurationPins: pins,
    policyRefs: [current.qaProjectContextRef!, ...refs(body.checklistPolicyRefs)],
    modeConfiguration: {
      schemaRef: {
        id: modeSchema,
        version: 2,
        digest: designContractRegistry.document(modeSchema).digest,
      },
      value: body as JsonValue,
      contentHash: digest(body),
    },
    capturedAt: session.startedAt!,
  });
  designContractRegistry.validateById("urn:awp:schemas:007:target-snapshot:v2", snapshot);
  await new ManualExecutionUnitOfWork(manager).persistTargetSnapshotV2(snapshot);
}
