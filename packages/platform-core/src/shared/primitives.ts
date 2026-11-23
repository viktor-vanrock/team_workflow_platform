export type Uuid = string;
export type StableKey = string;
export type SemVer = string;
export type Sha256Digest = `sha256:${string}`;

export interface VersionedReference {
  readonly id: Uuid;
  readonly version: number;
}

export interface SemanticVersionReference {
  readonly key: StableKey;
  readonly version: SemVer;
}

export interface SchemaReference {
  readonly id: string;
  readonly version: number;
  readonly digest: Sha256Digest;
}

export interface SchemaBoundValue<T = unknown> {
  readonly schemaRef: SchemaReference;
  readonly value: T;
}

export interface ClassificationReference {
  readonly key: StableKey;
  readonly rank: number;
}

export type ActorReference =
  | Readonly<{ kind: "HUMAN"; principalId: Uuid; issuer: string; subject: string }>
  | Readonly<{ kind: "SERVICE"; principalId: Uuid; serviceKey: StableKey }>;

export type ResourceScope =
  | Readonly<{ kind: "WORKSPACE"; workspaceId: Uuid }>
  | Readonly<{ kind: "PROJECT"; workspaceId: Uuid; projectId: Uuid }>;

export interface AuthorizationBasisRef {
  readonly kind: "PROJECT" | "WORKSPACE";
  readonly policyVersion: string;
  readonly membershipRef: VersionedReference;
  readonly roleAssignmentRefs: readonly VersionedReference[];
  readonly entitlementRefs: readonly VersionedReference[];
  readonly skillContext:
    "NOT_APPLICABLE" | Readonly<{ key: string; version: string; digest: Sha256Digest }>;
}

export interface WorkspaceContext {
  readonly actor: ActorReference;
  readonly scope: ResourceScope;
  readonly correlationId: Uuid;
  readonly causationId: Uuid;
  readonly authorizationBasis?: AuthorizationBasisRef;
}

export interface Clock {
  now(): Date;
}
export interface IdGenerator {
  next(): Uuid;
}

export interface TransactionContext {
  readonly transactionId: string;
}

export interface TransactionPort {
  inTransaction<T>(work: (context: TransactionContext) => Promise<T>): Promise<T>;
}

export const systemClock: Clock = Object.freeze({ now: () => new Date() });
export const scopeEquals = (left: ResourceScope, right: ResourceScope): boolean =>
  left.kind === right.kind &&
  left.workspaceId === right.workspaceId &&
  (left.kind === "WORKSPACE" || (right.kind === "PROJECT" && left.projectId === right.projectId));

export function requireProjectScope(
  scope: ResourceScope,
): Extract<ResourceScope, { kind: "PROJECT" }> {
  if (scope.kind !== "PROJECT")
    throw new Error("A project-scoped operation requires workspaceId and projectId");
  return scope;
}
