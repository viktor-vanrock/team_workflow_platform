import type { EntityManager } from "typeorm";

import {
  type BindingFunctionalAcceptance,
  type ExactRevisionRef,
  type ProjectOnboardingRevision,
  type ProjectScope,
} from "@awp/platform-core";
import { integrationConfigurationHash as configurationHash } from "@awp/runtime-composition";

import { currentAuthority, digest, ref, reject, same, validHash } from "./durable-http.ts";

type Document = Record<string, unknown>;
const scopeArgs = (scope: ProjectScope) => [scope.workspaceId, scope.projectId];
const doc = (value: unknown): Document => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return reject("BINDING_CONTENT_INVALID", 409);
  return value as Document;
};
const docs = (value: unknown): Document[] => {
  if (!Array.isArray(value) || value.length > 100) return reject("BINDING_CONTENT_INVALID", 409);
  return value.map(doc);
};
function versionReference(value: unknown): { id: string; version: number; contentHash?: string } {
  const v = doc(value);
  if (
    typeof v.id !== "string" ||
    !Number.isSafeInteger(v.version) ||
    Number(v.version) < 1 ||
    (v.contentHash !== undefined &&
      (typeof v.contentHash !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(v.contentHash)))
  )
    return reject("BINDING_REFERENCE_INVALID", 409);
  return {
    id: v.id,
    version: Number(v.version),
    ...(typeof v.contentHash === "string" ? { contentHash: v.contentHash } : {}),
  };
}
export const sortedRefs = (refs: readonly ExactRevisionRef[]) =>
  [...refs].sort((a, b) => `${a.id}:${a.version}`.localeCompare(`${b.id}:${b.version}`));
export function signedDocument(value: unknown, hash: string): Document {
  const body = doc(value);
  if (body.contentHash !== hash || !validHash(body as { contentHash: string }))
    return reject("CONFIGURATION_HASH_INVALID", 409);
  return body;
}
export interface BindingHead {
  readonly current_published_version: number | null;
  readonly row_version: string | number;
  readonly max_version: number;
}
export interface BindingRevision {
  readonly id: string;
  readonly version: number;
  readonly status: string;
  readonly content: Document;
  readonly content_hash: `sha256:${string}`;
}
export async function bindingHead(
  manager: EntityManager,
  scope: ProjectScope,
  id: string,
): Promise<BindingHead> {
  const rows = (await manager.query(
    "SELECT current_published_version,row_version FROM project_integration_binding_headers WHERE workspace_id=$1 AND project_id=$2 AND id=$3 FOR UPDATE",
    [...scopeArgs(scope), id],
  )) as Omit<BindingHead, "max_version">[];
  if (!rows[0]) return reject("BINDING_RESOURCE_UNAVAILABLE", 404);
  const versions = (await manager.query(
    "SELECT max(version)::int AS max_version FROM project_integration_binding_revisions WHERE workspace_id=$1 AND project_id=$2 AND header_id=$3",
    [...scopeArgs(scope), id],
  )) as { max_version: number }[];
  return { ...rows[0], max_version: versions[0]?.max_version ?? 0 };
}
export async function bindingRevision(
  manager: EntityManager,
  scope: ProjectScope,
  target: ExactRevisionRef,
): Promise<BindingRevision> {
  const rows = (await manager.query(
    "SELECT id,version,status,content,content_hash FROM project_integration_binding_revisions WHERE workspace_id=$1 AND project_id=$2 AND header_id=$3 AND version=$4 FOR SHARE",
    [...scopeArgs(scope), target.id, target.version],
  )) as BindingRevision[];
  const row = rows[0];
  if (
    !row ||
    row.content_hash !== target.contentHash ||
    configurationHash("project_integration_binding", row.content) !== target.contentHash
  )
    return reject("BINDING_EXACT_REVISION_UNAVAILABLE", 409);
  if (
    row.content.revisionId &&
    (row.content.id !== target.id ||
      row.content.version !== target.version ||
      row.content.workspaceId !== scope.workspaceId ||
      row.content.projectId !== scope.projectId)
  )
    return reject("BINDING_EXACT_REVISION_UNAVAILABLE", 409);
  return row;
}
export const bindingHeadRef = (id: string, head: BindingHead) =>
  ref(`binding-head:${id}`, Number(head.row_version), digest(head));

/** Read actual published heads and lock them through the consuming transaction. */
export async function configurationFacts(
  manager: EntityManager,
  scope: ProjectScope,
  binding: BindingRevision,
): Promise<ExactRevisionRef[]> {
  const result: ExactRevisionRef[] = [];
  const load = async (
    table: "connector_profile" | "connection" | "connector_mapping",
    target: ReturnType<typeof versionReference>,
  ) => {
    const rows = (await manager.query(
      `SELECT r.content,r.content_hash FROM ${table}_headers h JOIN ${table}_revisions r ON r.workspace_id=h.workspace_id AND r.header_id=h.id AND r.version=h.current_published_version WHERE h.workspace_id=$1 AND h.id=$2 AND r.version=$3 AND r.status='PUBLISHED' FOR SHARE OF h,r`,
      [scope.workspaceId, target.id, target.version],
    )) as { content: Document; content_hash: string }[];
    const row = rows[0];
    if (
      !row ||
      (target.contentHash !== undefined && row.content_hash !== target.contentHash) ||
      configurationHash(table, row.content) !== row.content_hash
    )
      return reject("BINDING_CONFIGURATION_STALE", 409);
    if (
      row.content.revisionId &&
      (row.content.id !== target.id ||
        row.content.version !== target.version ||
        row.content.workspaceId !== scope.workspaceId)
    )
      return reject("BINDING_CONFIGURATION_STALE", 409);
    result.push(ref(target.id, target.version, row.content_hash as `sha256:${string}`));
    return row.content;
  };
  const entries = docs(binding.content.entries);
  if (
    !entries.length ||
    binding.content.workspaceId !== scope.workspaceId ||
    binding.content.projectId !== scope.projectId
  )
    return reject("BINDING_CONTENT_INVALID", 409);
  for (const entry of entries) {
    const profile = await load("connector_profile", versionReference(entry.profileRef));
    const connection = await load("connection", versionReference(profile.connectionRef));
    if (
      profile.connectorRef
        ? !same(profile.connectorRef, connection.connectorRef)
        : !profile.connectorKey || connection.connectorKey !== profile.connectorKey
    )
      return reject("BINDING_CONFIGURATION_STALE", 409);
    if (profile.mappingRef) await load("connector_mapping", versionReference(profile.mappingRef));
    const configurations = docs(profile.capabilityConfigurations).filter(
      (c) =>
        c.capabilityKey === entry.capabilityKey &&
        c.exactContractVersion === entry.exactContractVersion,
    );
    if (
      configurations.length !== 1 ||
      !Array.isArray(configurations[0]!.environmentScopes) ||
      !configurations[0]!.environmentScopes.includes(entry.environmentScope)
    )
      return reject("BINDING_CAPABILITY_UNSUPPORTED", 409);
  }
  return sortedRefs([...new Map(result.map((value) => [digest(value), value])).values()]);
}
export async function contextFact(
  manager: EntityManager,
  current: ProjectOnboardingRevision,
): Promise<ExactRevisionRef> {
  const target = current.qaProjectContextRef;
  if (!target) return reject("BINDING_CONTEXT_REQUIRED", 409);
  const rows = (await manager.query(
    "SELECT r.semantic_body,r.content_hash FROM qa_project_context_headers_v2 h JOIN qa_project_context_revisions_v2 r ON (r.workspace_id,r.project_id,r.context_id,r.version)=(h.workspace_id,h.project_id,h.context_id,h.current_published_version) WHERE h.workspace_id=$1 AND h.project_id=$2 AND h.context_id=$3 AND r.version=$4 AND r.state='PUBLISHED' FOR SHARE OF h,r",
    [...scopeArgs(current), target.id, target.version],
  )) as { semantic_body: Document; content_hash: string }[];
  const row = rows[0];
  if (!row || row.content_hash !== target.contentHash) return reject("BINDING_CONTEXT_STALE", 409);
  // Existing published contexts use either a detached hash or an embedded contentHash.
  const body = row.semantic_body.contentHash
    ? signedDocument(row.semantic_body, row.content_hash)
    : row.semantic_body;
  if (
    (!body.contentHash && digest(body) !== row.content_hash) ||
    body.workspaceId !== current.workspaceId ||
    body.projectId !== current.projectId
  )
    return reject("BINDING_CONTEXT_STALE", 409);
  return target;
}
export async function publicationFacts(
  manager: EntityManager,
  current: ProjectOnboardingRevision,
  target: ExactRevisionRef,
  binding: BindingRevision,
): Promise<ExactRevisionRef[]> {
  const context = await contextFact(manager, current),
    configuration = await configurationFacts(manager, current, binding);
  const rows = (await manager.query(
    "SELECT id,subject_version,outcome,content_hash,report,created_at FROM integration_validation_reports WHERE workspace_id=$1 AND project_id=$2 AND subject_kind='BINDING' AND subject_id=$3 ORDER BY created_at DESC,id DESC LIMIT 1",
    [...scopeArgs(current), target.id],
  )) as {
    id: string;
    subject_version: number;
    outcome: string;
    content_hash: string;
    report: Document;
    created_at: Date;
  }[];
  const row = rows[0];
  if (
    !row ||
    row.subject_version !== target.version ||
    row.content_hash !== target.contentHash ||
    row.outcome !== "VALID" ||
    !Number.isFinite(row.created_at.getTime()) ||
    row.created_at.getTime() > Date.now()
  )
    return reject("BINDING_VALIDATION_STALE", 409);
  const report = row.report;
  if (
    report.id !== row.id ||
    report.workspaceId !== current.workspaceId ||
    report.projectId !== current.projectId ||
    report.subjectKind !== "BINDING" ||
    !same(report.subjectRef, { id: target.id, version: target.version }) ||
    report.contentHash !== target.contentHash ||
    report.status !== "VALID" ||
    !Array.isArray(report.issues) ||
    report.issues.length ||
    report.createdAt !== row.created_at.toISOString()
  )
    return reject("BINDING_VALIDATION_STALE", 409);
  const validationRef = ref(row.id, 1, digest(row.report));
  const acceptances = (await manager.query(
    "SELECT semantic_body,content_hash FROM binding_functional_acceptances WHERE workspace_id=$1 AND project_id=$2 AND binding_ref->>'id'=$3 ORDER BY accepted_at DESC,acceptance_id DESC LIMIT 1",
    [...scopeArgs(current), target.id],
  )) as { semantic_body: BindingFunctionalAcceptance; content_hash: string }[];
  const acceptance = acceptances[0];
  if (!acceptance) return reject("BINDING_ACCEPTANCE_REQUIRED", 409);
  signedDocument(acceptance.semantic_body, acceptance.content_hash);
  const a = acceptance.semantic_body;
  if (
    a.workspaceId !== current.workspaceId ||
    a.projectId !== current.projectId ||
    a.outcome !== "ACCEPTED" ||
    a.safeIssueCodes.length ||
    a.acceptedBy.kind !== "HUMAN" ||
    a.acceptedBy.roleKey !== "qa-lead" ||
    !Number.isFinite(Date.parse(a.acceptedAt)) ||
    Date.parse(a.acceptedAt) > Date.now() ||
    !same(a.bindingRef, target) ||
    !same(a.validationReportRef, validationRef) ||
    !same(a.qaProjectContextRef, context)
  )
    return reject("BINDING_ACCEPTANCE_STALE", 409);
  await currentAuthority(
    manager,
    { kind: "PROJECT", workspaceId: current.workspaceId, projectId: current.projectId },
    a.acceptedBy.principalId,
    "integration.accept",
    "qa-lead",
  );
  return sortedRefs([
    context,
    validationRef,
    ref(a.acceptanceId, a.version, a.contentHash),
    ...configuration,
  ]);
}
export async function pilotFacts(
  manager: EntityManager,
  current: ProjectOnboardingRevision,
): Promise<ExactRevisionRef[]> {
  if (current.stage !== "SHADOW" || current.operationalState !== "ACTIVE" || !current.bindingRef)
    return reject("PILOT_STATE_INVALID", 409);
  const head = await bindingHead(manager, current, current.bindingRef.id);
  const binding = await bindingRevision(manager, current, current.bindingRef);
  if (
    head.current_published_version !== current.bindingRef.version ||
    binding.status !== "PUBLISHED"
  )
    return reject("PILOT_BINDING_STALE", 409);
  const prerequisites = await publicationFacts(manager, current, current.bindingRef, binding);
  const registries = (await manager.query(
    "SELECT r.semantic_body,r.content_hash FROM projects p JOIN project_registry_revisions r ON r.workspace_id=p.workspace_id AND r.project_id=p.id AND r.version=p.current_registry_version WHERE p.workspace_id=$1 AND p.id=$2 AND r.revision_id=$3 AND r.version=$4 AND p.registration_status='ACTIVE' FOR SHARE OF p,r",
    [...scopeArgs(current), current.projectRegistryRef.id, current.projectRegistryRef.version],
  )) as { semantic_body: Document; content_hash: string }[];
  const registry = registries[0];
  if (!registry || registry.content_hash !== current.projectRegistryRef.contentHash)
    return reject("PILOT_REGISTRY_STALE", 409);
  const registryBody = signedDocument(registry.semantic_body, registry.content_hash);
  if (
    registryBody.workspaceId !== current.workspaceId ||
    registryBody.projectId !== current.projectId ||
    registryBody.verificationStatus !== "CURRENT" ||
    !Array.isArray(registryBody.ownerIds) ||
    !registryBody.ownerIds.length ||
    digest(registryBody.ownerIds) !== current.ownerSetHash ||
    (registryBody.nextVerificationAt &&
      Date.parse(String(registryBody.nextVerificationAt)) <= Date.now())
  )
    return reject("PILOT_REGISTRY_STALE", 409);

  const gates = (await manager.query(
    "SELECT DISTINCT ON(gate_kind) gate_result_id,gate_kind,semantic_body,content_hash,outcome,subject_refs,evaluated_at,valid_until FROM project_onboarding_gate_results WHERE workspace_id=$1 AND project_id=$2 AND gate_kind IN('C1','N2','P3') ORDER BY gate_kind,evaluated_at DESC,gate_result_id DESC",
    scopeArgs(current),
  )) as {
    gate_result_id: string;
    gate_kind: string;
    semantic_body: Document;
    content_hash: `sha256:${string}`;
    outcome: string;
    subject_refs: ExactRevisionRef[];
    evaluated_at: Date;
    valid_until: Date | null;
  }[];
  const required = [
    ref(current.revisionId, current.version, current.contentHash),
    current.projectRegistryRef,
    current.bindingRef,
    current.qaProjectContextRef!,
  ];
  for (const kind of ["C1", "N2", "P3"]) {
    const row = gates.find((gate) => gate.gate_kind === kind);
    if (
      !row ||
      row.outcome !== "PASS" ||
      !row.valid_until ||
      row.valid_until.getTime() <= Date.now() ||
      row.evaluated_at.getTime() > Date.now()
    )
      return reject("PILOT_GATE_BLOCKED", 409);
    const body = signedDocument(row.semantic_body, row.content_hash);
    if (
      body.workspaceId !== current.workspaceId ||
      body.projectId !== current.projectId ||
      body.gateResultId !== row.gate_result_id ||
      body.gateKind !== kind ||
      body.outcome !== row.outcome ||
      body.evaluatedAt !== row.evaluated_at.toISOString() ||
      body.validUntil !== row.valid_until.toISOString() ||
      !same(body.subjectRefs, row.subject_refs) ||
      required.some((target) => !row.subject_refs.some((r) => same(r, target)))
    )
      return reject("PILOT_GATE_STALE", 409);
    prerequisites.push(ref(row.gate_result_id, 1, row.content_hash));
  }
  return sortedRefs([
    ...prerequisites,
    bindingHeadRef(current.bindingRef.id, head),
    current.projectRegistryRef,
  ]);
}
