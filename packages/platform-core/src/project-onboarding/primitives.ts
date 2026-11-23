import { canonicalize, type JsonValue, sha256, type Sha256Digest } from "@awp/platform-contracts";

export interface ProjectScope {
  readonly workspaceId: string;
  readonly projectId: string;
}

export interface ExactRevisionRef {
  readonly id: string;
  readonly version: number;
  readonly contentHash: Sha256Digest;
}

export interface HumanActorSnapshot {
  readonly kind: "HUMAN";
  readonly principalId: string;
  readonly roleKey: string;
  readonly authorizationBasisRef: ExactRevisionRef;
  readonly authenticationContextRef: ExactRevisionRef;
  readonly stepUpAt?: string;
}

export interface ClassificationSnapshot {
  readonly key: string;
  readonly rank: number;
  readonly catalogVersion: number;
}

export class ProjectOnboardingError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ProjectOnboardingError";
  }
}

export function assertProjectScope(scope: ProjectScope): void {
  if (!scope.workspaceId || !scope.projectId)
    throw new ProjectOnboardingError("PROJECT_SCOPE_REQUIRED");
}

export function assertExactRevisionRef(ref: ExactRevisionRef): void {
  if (
    !ref.id ||
    !Number.isSafeInteger(ref.version) ||
    ref.version < 1 ||
    !/^sha256:[a-f0-9]{64}$/u.test(ref.contentHash)
  ) {
    throw new ProjectOnboardingError("EXACT_REVISION_REF_INVALID");
  }
}

export function canonicalSet(values: readonly string[]): readonly string[] {
  const ordered = [...values].sort((left, right) => left.localeCompare(right));
  if (
    ordered.some((value) => value.trim().length === 0) ||
    new Set(ordered).size !== ordered.length
  ) {
    throw new ProjectOnboardingError("CANONICAL_SET_INVALID");
  }
  return Object.freeze(ordered);
}

export function onboardingContentHash(value: JsonValue): Sha256Digest {
  return sha256(value);
}

export function canonicalOnboardingBytes(value: JsonValue): string {
  return canonicalize(value);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export type ProjectEventType =
  | "PROJECT_REGISTERED"
  | "PROJECT_ONBOARDING_CHANGED"
  | "PROJECT_ENTITLEMENTS_CHANGED"
  | "PROJECT_BINDING_CHANGED"
  | "PROJECT_OPERATIONAL_STATE_CHANGED"
  | "QA_EVIDENCE_CHANGED"
  | "ARTIFACT_AVAILABILITY_CHANGED";

export interface ProjectEventInput {
  readonly eventId: string;
  readonly eventType: ProjectEventType;
  readonly scope: ProjectScope;
  readonly subjectRef: ExactRevisionRef & Readonly<{ workspaceId?: string; projectId?: string }>;
  readonly reasonCode: string;
  readonly relatedRefs: readonly ExactRevisionRef[];
  readonly actor:
    HumanActorSnapshot | Readonly<{ kind: "SERVICE"; principalId: string; serviceKey: string }>;
  readonly occurredAt: string;
  readonly correlationId: string;
  readonly causationId: string;
}

export interface ProjectEventEnvelope {
  readonly schemaVersion: 1;
  readonly partitionKey: string;
  readonly payload: ProjectEventInput & Readonly<{ contentHash: Sha256Digest }>;
}

export function createProjectEventEnvelope(input: ProjectEventInput): ProjectEventEnvelope {
  assertProjectScope(input.scope);
  assertExactRevisionRef(input.subjectRef);
  input.relatedRefs.forEach(assertExactRevisionRef);
  if (
    input.subjectRef.workspaceId !== undefined &&
    input.subjectRef.workspaceId !== input.scope.workspaceId
  ) {
    throw new ProjectOnboardingError("EVENT_SCOPE_MISMATCH");
  }
  if (
    input.subjectRef.projectId !== undefined &&
    input.subjectRef.projectId !== input.scope.projectId
  ) {
    throw new ProjectOnboardingError("EVENT_SCOPE_MISMATCH");
  }
  if (
    !input.eventId ||
    !input.reasonCode ||
    !input.correlationId ||
    !input.causationId ||
    Number.isNaN(Date.parse(input.occurredAt))
  ) {
    throw new ProjectOnboardingError("EVENT_ENVELOPE_INVALID");
  }
  const semantic = structuredClone(input) as unknown as JsonValue;
  return deepFreeze({
    schemaVersion: 1 as const,
    partitionKey: `${input.scope.workspaceId}:${input.scope.projectId}`,
    payload: { ...structuredClone(input), contentHash: onboardingContentHash(semantic) },
  });
}

export class ProjectEventInbox {
  readonly #digests = new Map<string, Sha256Digest>();

  accept(event: ProjectEventEnvelope): "ACCEPTED" | "DUPLICATE" | "QUARANTINED_MISMATCH" {
    const current = this.#digests.get(event.payload.eventId);
    if (current === undefined) {
      this.#digests.set(event.payload.eventId, event.payload.contentHash);
      return "ACCEPTED";
    }
    return current === event.payload.contentHash ? "DUPLICATE" : "QUARANTINED_MISMATCH";
  }
}
