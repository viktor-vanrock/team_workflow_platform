import { randomUUID } from "node:crypto";

import { HttpException } from "@nestjs/common";
import type { DataSource, EntityManager } from "typeorm";

import { evidenceContentHash } from "@awp/competency-qa";
import {
  type ActorReference,
  type AuthorizationBasisRef,
  canonicalRoleKey,
  createProjectEventEnvelope,
  defaultClassificationCatalog,
  DenyByDefaultAuthorizationPolicy,
  type ExactRevisionRef,
  type HumanActorSnapshot,
  type ProjectOnboardingRevision,
  type ProjectScope,
  type ResourceScope,
} from "@awp/platform-core";
import { TypeOrmScopedAccessRepository } from "@awp/platform-persistence-typeorm";

import {
  authorizeQaApi,
  type QaApiAuthorization,
  qaInteractionSession,
  type QaSessionRequest,
} from "../qa-api-authorization.ts";

export const digest = evidenceContentHash;
export const ref = (
  id: string,
  version: number,
  contentHash: `sha256:${string}`,
): ExactRevisionRef => ({ id, version, contentHash });
export const same = (a: unknown, b: unknown) => digest(a) === digest(b);
export const reject = (code: string, status = 422): never => {
  throw new HttpException({ status: status === 409 ? "CONFLICT" : "REJECTED", code }, status);
};
export const uuid = (v: unknown): string =>
  typeof v === "string" && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/iu.test(v)
    ? v
    : reject("IDENTIFIER_INVALID", 400);
export const integer = (v: unknown): number =>
  Number.isSafeInteger(Number(v)) && /^[1-9][0-9]*$/u.test(String(v))
    ? Number(v)
    : reject("VERSION_INVALID", 400);
export const etag = (v: string | undefined): number => {
  const match = /^"([1-9][0-9]*)"$/u.exec(v ?? "");
  return match ? integer(match[1]) : reject("STRONG_IF_MATCH_REQUIRED", 400);
};
export const text = (v: unknown, max = 2000): string =>
  typeof v === "string" && v.trim() && v.length <= max
    ? v.trim()
    : reject("COMMAND_TEXT_INVALID", 400);
export const idempotencyKey = (v: unknown) => {
  const key = text(v, 256);
  if (key.length < 8 || /[\r\n]/u.test(key)) reject("IDEMPOTENCY_KEY_INVALID", 400);
  return key;
};
export const object = (v: unknown, keys: readonly string[]): Record<string, unknown> => {
  if (
    !v ||
    typeof v !== "object" ||
    Array.isArray(v) ||
    Object.keys(v).some((k) => !keys.includes(k))
  )
    return reject("COMMAND_INVALID", 400);
  return v as Record<string, unknown>;
};
export const exact = (v: unknown): ExactRevisionRef => {
  const r = object(v, ["id", "version", "contentHash"]);
  const hash = text(r.contentHash, 71);
  if (!/^sha256:[a-f0-9]{64}$/u.test(hash)) return reject("EXACT_REF_INVALID", 400);
  return ref(text(r.id, 256), integer(r.version), hash as `sha256:${string}`);
};
export const exacts = (v: unknown): ExactRevisionRef[] => {
  if (!Array.isArray(v) || v.length > 100) return reject("REF_SET_INVALID", 400);
  const refs = v.map(exact);
  if (new Set(refs.map(digest)).size !== refs.length) reject("REF_SET_INVALID", 400);
  return refs;
};
export const validHash = (v: { contentHash: string; [key: string]: unknown }): boolean => {
  const { contentHash, ...body } = v;
  return digest(body) === contentHash;
};

export interface OnboardingRequest extends ProjectScope {
  readonly authorize: (permission: string) => Promise<QaApiAuthorization>;
  readonly session: () => Promise<Readonly<{ principalId: string; binding: string }>>;
}
export function onboardingRequest(
  source: DataSource,
  request: QaSessionRequest,
  workspaceId: string,
  projectId: string,
): OnboardingRequest {
  uuid(workspaceId);
  uuid(projectId);
  return {
    workspaceId,
    projectId,
    authorize: (permission) => authorizeQaApi(source, request, workspaceId, projectId, permission),
    session: () => qaInteractionSession(request),
  };
}
export async function safeResult<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof HttpException) throw error;
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code === "23505" || code === "40001" || code === "40P01")
      return reject("ONBOARDING_VERSION_CONFLICT", 409);
    return reject("ONBOARDING_OPERATION_UNAVAILABLE", 503);
  }
}
export interface AdministrativeAuthority {
  readonly actor: Extract<ActorReference, { kind: "HUMAN" }>;
  readonly basis: AuthorizationBasisRef;
  readonly human: HumanActorSnapshot;
  readonly classification: string;
  readonly classificationCeiling: QaApiAuthorization["classificationCeiling"];
}
const canonicalRole = canonicalRoleKey;

/** Row locks keep authorization and the mutation in one database decision. */
export async function currentAuthority(
  manager: EntityManager,
  scope: ResourceScope,
  principalId: string,
  permission: string,
  role?: string,
  authentication?: QaApiAuthorization["authentication"],
  verifiedBasis?: AuthorizationBasisRef,
): Promise<AdministrativeAuthority> {
  const values = [scope.workspaceId, principalId];
  const workspaces = (await manager.query(
    "SELECT id FROM workspaces WHERE id=$1 AND state='ACTIVE' FOR SHARE",
    [scope.workspaceId],
  )) as unknown[];
  if (workspaces.length !== 1) return reject("PROJECT_RESOURCE_NOT_AVAILABLE", 403);
  const identities = (await manager.query(
    "SELECT id,issuer,subject FROM identities WHERE id=$1 AND kind='HUMAN' FOR SHARE",
    [principalId],
  )) as { id: string; issuer: string; subject: string }[];
  if (!identities[0]) return reject("HUMAN_AUTHORITY_REQUIRED", 403);
  await manager.query(
    "SELECT id FROM workspace_memberships WHERE workspace_id=$1 AND principal_id=$2 ORDER BY id FOR SHARE",
    values,
  );
  await manager.query(
    "SELECT id FROM role_assignments WHERE workspace_id=$1 AND principal_id=$2 AND (project_id IS NULL OR project_id=$3) ORDER BY id FOR SHARE",
    [...values, scope.kind === "PROJECT" ? scope.projectId : null],
  );
  if (scope.kind === "PROJECT")
    await manager.query(
      "SELECT id FROM project_entitlements WHERE workspace_id=$1 AND principal_id=$2 AND project_id=$3 ORDER BY id FOR SHARE",
      [...values, scope.projectId],
    );
  if (scope.kind === "PROJECT")
    await manager.query("SELECT id FROM projects WHERE workspace_id=$1 AND id=$2 FOR SHARE", [
      scope.workspaceId,
      scope.projectId,
    ]);
  const repository = new TypeOrmScopedAccessRepository(manager),
    now = new Date();
  const project = scope.kind === "PROJECT" ? await repository.getProject(scope) : undefined;
  if (scope.kind === "PROJECT" && (!project || project.state === "ARCHIVED"))
    return reject("PROJECT_RESOURCE_NOT_AVAILABLE", 403);
  const classification =
    project?.classification ?? defaultClassificationCatalog.reference("INTERNAL");
  const currentFacts = await repository.authorizationFacts(scope, principalId, now),
    identity = identities[0];
  const includes = (
    refs: readonly { id: string; version: number }[],
    target: { id: string; version: number },
  ) => refs.some((r) => r.id === target.id && r.version === target.version);
  if (
    verifiedBasis &&
    (verifiedBasis.kind !== scope.kind ||
      !currentFacts.membership ||
      !includes([verifiedBasis.membershipRef], currentFacts.membership.ref))
  )
    return reject("CURRENT_AUTHORIZATION_REQUIRED", 403);
  // A verified IdP policy may narrow Core roles. Never regain excluded ALLOW rows
  // when the transaction rechecks current authority; current DENY rows still win.
  const facts = verifiedBasis
    ? {
        ...currentFacts,
        roleAssignments: currentFacts.roleAssignments.filter(
          (r) => r.effect === "DENY" || includes(verifiedBasis.roleAssignmentRefs, r.ref),
        ),
        entitlements: currentFacts.entitlements.filter(
          (e) => e.effect === "DENY" || includes(verifiedBasis.entitlementRefs, e.ref),
        ),
      }
    : currentFacts;
  const actor = {
    kind: "HUMAN" as const,
    principalId,
    issuer: identity.issuer,
    subject: identity.subject,
  };
  const decision = new DenyByDefaultAuthorizationPolicy().decide({
    context: { actor, scope, correlationId: randomUUID(), causationId: randomUUID() },
    permission,
    resourceClassification: classification,
    facts,
    at: now,
    operationClass: "READ",
    ...(verifiedBasis ? { policyVersion: verifiedBasis.policyVersion } : {}),
  });
  if (!decision.allowed || !decision.basis) return reject("CURRENT_AUTHORIZATION_REQUIRED", 403);
  const roles = facts.roleAssignments.filter((r) =>
    decision.basis!.roleAssignmentRefs.some(
      (v) => v.id === r.ref.id && v.version === r.ref.version,
    ),
  );
  const chosen = roles.find((r) => !role || canonicalRole(r.roleKey) === canonicalRole(role));
  if (!chosen) return reject("ADMINISTRATIVE_ROLE_REQUIRED", 403);
  const basis = decision.basis;
  const human: HumanActorSnapshot = {
    kind: "HUMAN",
    principalId,
    roleKey: canonicalRole(chosen.roleKey),
    authorizationBasisRef: ref(principalId, 1, digest(basis)),
    authenticationContextRef: ref(
      "verified-http-session",
      1,
      digest(authentication?.contextRef ?? principalId),
    ),
    ...(authentication?.stepUpAt ? { stepUpAt: authentication.stepUpAt } : {}),
  };
  const ceilings = facts.entitlements
    .filter((e) =>
      basis.entitlementRefs.some((r) => r.id === e.ref.id && r.version === e.ref.version),
    )
    .map((e) => e.classificationCeiling)
    .sort((a, b) => b.rank - a.rank);
  const classificationCeiling = (ceilings[0]?.key ??
    classification.key) as QaApiAuthorization["classificationCeiling"];
  return { actor, basis, human, classification: classification.key, classificationCeiling };
}
export async function authorizeAdministrative(
  manager: EntityManager,
  request: OnboardingRequest,
  permission: string,
  role?: string,
  stepUp = false,
): Promise<AdministrativeAuthority> {
  const auth = await request.authorize(permission);
  if (!auth.authentication?.contextRef) return reject("VERIFIED_AUTHENTICATION_REQUIRED", 403);
  const at = Date.parse(auth.authentication.stepUpAt ?? ""),
    now = Date.now();
  if (stepUp && (!Number.isFinite(at) || at > now || now - at > 300_000))
    return reject("STEP_UP_REQUIRED", 403);
  return currentAuthority(
    manager,
    { kind: "PROJECT", workspaceId: request.workspaceId, projectId: request.projectId },
    auth.actor.principalId,
    permission,
    role,
    auth.authentication,
    auth.basis,
  );
}
const auditBaselines = new WeakMap<EntityManager, Map<string, ExactRevisionRef>>();
const auditScopeKey = (scope: ProjectScope) => `${scope.workspaceId}:${scope.projectId}`;
export async function lockOnboarding(
  manager: EntityManager,
  scope: ProjectScope,
): Promise<ProjectOnboardingRevision> {
  await manager.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    `project-onboarding:${scope.workspaceId}`,
  ]);
  const heads = (await manager.query(
    "SELECT current_version FROM project_onboarding_headers WHERE workspace_id=$1 AND project_id=$2 FOR UPDATE",
    [scope.workspaceId, scope.projectId],
  )) as { current_version: number }[];
  if (!heads[0]) return reject("PROJECT_RESOURCE_NOT_AVAILABLE", 404);
  const rows = (await manager.query(
    "SELECT semantic_body,content_hash FROM project_onboarding_revisions WHERE workspace_id=$1 AND project_id=$2 AND version=$3",
    [scope.workspaceId, scope.projectId, heads[0].current_version],
  )) as { semantic_body: ProjectOnboardingRevision; content_hash: string }[];
  const row = rows[0];
  if (
    !row ||
    row.semantic_body.contentHash !== row.content_hash ||
    !validHash(row.semantic_body as unknown as { contentHash: string })
  )
    return reject("ONBOARDING_REVISION_UNVERIFIED");
  const baselines = auditBaselines.get(manager) ?? new Map<string, ExactRevisionRef>();
  if (!baselines.has(auditScopeKey(scope)))
    baselines.set(
      auditScopeKey(scope),
      ref(row.semantic_body.revisionId, row.semantic_body.version, row.semantic_body.contentHash),
    );
  auditBaselines.set(manager, baselines);
  return row.semantic_body;
}
export async function appendOnboarding(
  manager: EntityManager,
  value: ProjectOnboardingRevision,
): Promise<void> {
  await manager.query(
    `INSERT INTO project_onboarding_revisions(revision_id,onboarding_id,workspace_id,project_id,version,onboarding_stage,qa_capability_mode,project_operational_state,intended_capability_mode,project_registry_ref,binding_ref,qa_project_context_ref,starter_entitlement_set_hash,gate_result_refs,owner_set_hash,reason_code,reason,incident_ref,actor,correlation_id,causation_id,created_at,semantic_body,content_hash)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)`,
    [
      value.revisionId,
      value.onboardingId,
      value.workspaceId,
      value.projectId,
      value.version,
      value.stage,
      value.qaCapabilityMode,
      value.operationalState,
      value.intendedCapabilityMode,
      value.projectRegistryRef,
      value.bindingRef ?? null,
      value.qaProjectContextRef ?? null,
      value.starterEntitlementSetHash,
      JSON.stringify(value.gateResultRefs),
      value.ownerSetHash,
      value.reasonCode,
      value.reason,
      value.incidentRef ?? null,
      value.actor,
      value.correlationId,
      value.causationId ?? null,
      value.createdAt,
      value,
      value.contentHash,
    ],
  );
  await manager.query(
    "UPDATE project_onboarding_headers SET current_version=$3,current_stage=$4,current_capability_mode=$5,current_operational_state=$6,intended_capability_mode=$7,row_version=row_version+1,updated_at=$8 WHERE workspace_id=$1 AND project_id=$2",
    [
      value.workspaceId,
      value.projectId,
      value.version,
      value.stage,
      value.qaCapabilityMode,
      value.operationalState,
      value.intendedCapabilityMode,
      value.createdAt,
    ],
  );
}
export async function command<T>(
  manager: EntityManager,
  scope: ProjectScope,
  actorId: string,
  operation: string,
  key: string,
  body: unknown,
  work: () => Promise<T>,
): Promise<T> {
  const values = [scope.workspaceId, scope.projectId, actorId, operation, idempotencyKey(key)],
    hash = digest(body);
  await manager.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    JSON.stringify(values),
  ]);
  const rows = (await manager.query(
    "SELECT request_hash,result_ref FROM client_request_idempotency WHERE workspace_id=$1 AND project_id=$2 AND actor_id=$3 AND operation=$4 AND client_key=$5",
    values,
  )) as { request_hash: string; result_ref: T }[];
  if (rows[0]) {
    if (rows[0].request_hash !== hash) return reject("IDEMPOTENCY_CONFLICT", 409);
    return rows[0].result_ref;
  }
  const result = await work();
  await manager.query(
    "INSERT INTO client_request_idempotency(workspace_id,project_id,actor_id,operation,client_key,request_hash,result_ref,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,clock_timestamp())",
    [...values, hash, JSON.stringify(result)],
  );
  return result;
}
export async function auditAndEvent(
  manager: EntityManager,
  scope: ProjectScope,
  authority: AdministrativeAuthority,
  action: string,
  result: ExactRevisionRef,
  reason: string,
  eventType:
    | "PROJECT_REGISTERED"
    | "PROJECT_ONBOARDING_CHANGED"
    | "PROJECT_ENTITLEMENTS_CHANGED"
    | "PROJECT_BINDING_CHANGED"
    | "PROJECT_OPERATIONAL_STATE_CHANGED" = "PROJECT_ONBOARDING_CHANGED",
) {
  const correlationId = randomUUID(),
    at = new Date().toISOString();
  const before = auditBaselines.get(manager)?.get(auditScopeKey(scope));
  if (!before) return reject("ONBOARDING_AUDIT_BASELINE_REQUIRED", 503);
  const current = await lockOnboarding(manager, scope),
    after = ref(current.revisionId, current.version, current.contentHash);
  await manager.query(
    "INSERT INTO audit_events(id,workspace_id,project_id,occurred_at,actor,action,outcome,reason_code,correlation_id,causation_id,authorization_basis,classification_key,attributes) VALUES($1,$2,$3,$4,$5,$6,'SUCCEEDED',$6,$7,$7,$8,$9,$10)",
    [
      randomUUID(),
      scope.workspaceId,
      scope.projectId,
      at,
      authority.actor,
      action,
      correlationId,
      authority.basis,
      authority.classification,
      { before, after, resultRef: result, reason },
    ],
  );
  const eventScope = { workspaceId: scope.workspaceId, projectId: scope.projectId };
  const event = createProjectEventEnvelope({
    eventId: randomUUID(),
    eventType,
    scope: eventScope,
    subjectRef: { ...eventScope, ...result },
    relatedRefs: [],
    actor: authority.human,
    reasonCode: action,
    occurredAt: at,
    correlationId,
    causationId: correlationId,
  });
  await manager.query(
    "INSERT INTO event_outbox(id,workspace_id,project_id,event_type,envelope,envelope_hash,state,created_at) VALUES($1,$2,$3,$4,$5,$6,'READY',$7)",
    [
      event.payload.eventId,
      scope.workspaceId,
      scope.projectId,
      eventType,
      event,
      digest(event),
      at,
    ],
  );
}
