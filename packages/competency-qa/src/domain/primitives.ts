import { type JsonValue, sha256, type Sha256Digest } from "@awp/platform-contracts";

export type QaId = string;
export type QaContentHash = Sha256Digest;

export interface QaScope {
  readonly workspaceId: QaId;
  readonly projectId: QaId;
}

export interface QaHumanActor {
  readonly kind: "HUMAN";
  readonly principalId: QaId;
  readonly issuer: string;
  readonly subject: string;
}

export interface QaServiceActor {
  readonly kind: "SERVICE";
  readonly principalId: QaId;
  readonly serviceKey: string;
}

export type QaActor =
  | QaHumanActor
  | QaServiceActor
  | Readonly<{
      readonly kind: string;
      readonly principalId: QaId;
      readonly [key: string]: unknown;
    }>;

export interface QaWorkspaceContext {
  readonly actor: QaActor;
  readonly scope:
    | Readonly<{ kind: "WORKSPACE"; workspaceId: QaId }>
    | Readonly<{ kind: "PROJECT"; workspaceId: QaId; projectId: QaId }>;
  readonly correlationId: QaId;
  readonly causationId: QaId;
  readonly authorizationBasis?: QaAuthorizationBasis;
}

export interface QaVersionedReference {
  readonly id: QaId;
  readonly version: number;
}

export interface QaAuthorizationBasis {
  readonly kind: "PROJECT" | "WORKSPACE";
  readonly policyVersion: string;
  readonly membershipRef: QaVersionedReference;
  readonly roleAssignmentRefs: readonly QaVersionedReference[];
  readonly entitlementRefs: readonly QaVersionedReference[];
  readonly skillContext:
    | "NOT_APPLICABLE"
    | Readonly<{
        key: string;
        version: string;
        digest: QaContentHash;
      }>;
}

export interface QaExactReference extends QaVersionedReference {
  readonly contentHash: QaContentHash;
}

export interface QaImmutableRevision extends QaExactReference {
  readonly previous?: QaExactReference;
}

export class QaDomainError extends Error {
  constructor(
    readonly code: string,
    message = code,
  ) {
    super(message);
    this.name = "QaDomainError";
  }
}

export function assertQaScope(expected: QaScope, actual: QaScope): void {
  if (
    expected.workspaceId.length === 0 ||
    expected.projectId.length === 0 ||
    expected.workspaceId !== actual.workspaceId ||
    expected.projectId !== actual.projectId
  ) {
    throw new QaDomainError("QA_SCOPE_MISMATCH");
  }
}

export function qaScopeFromContext(context: QaWorkspaceContext): QaScope {
  if (context.scope.kind !== "PROJECT") throw new QaDomainError("QA_PROJECT_SCOPE_REQUIRED");
  return Object.freeze({
    workspaceId: context.scope.workspaceId,
    projectId: context.scope.projectId,
  });
}

export function assertQaVerifiedHuman(context: QaWorkspaceContext): QaHumanActor {
  if (context.actor.kind !== "HUMAN") throw new QaDomainError("QA_VERIFIED_HUMAN_REQUIRED");
  const actor = context.actor as Partial<QaHumanActor>;
  if (
    typeof actor.principalId !== "string" ||
    actor.principalId.length === 0 ||
    typeof actor.issuer !== "string" ||
    actor.issuer.length === 0 ||
    typeof actor.subject !== "string" ||
    actor.subject.length === 0
  ) {
    throw new QaDomainError("QA_VERIFIED_HUMAN_REQUIRED");
  }
  return context.actor as QaHumanActor;
}

export function qaAggregateSnapshotHash(value: JsonValue): QaContentHash {
  return sha256(value);
}
