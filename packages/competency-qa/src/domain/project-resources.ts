import {
  qaAggregateSnapshotHash,
  type QaContentHash,
  QaDomainError,
  type QaHumanActor,
  type QaScope,
} from "./primitives.ts";

export type QaProjectEnvironmentScope = "LOCAL" | "NON_PROD" | "PREPROD";
export type QaProjectResourceState = "DRAFT" | "PUBLISHED" | "RETIRED";

export interface QaProjectExactRef {
  readonly id: string;
  readonly version: number;
  readonly contentHash: QaContentHash;
}

/** Published resource actor DTO; runtime supplies verified Core authority at the boundary. */
export interface QaPublishedHumanActor {
  readonly kind: "HUMAN";
  readonly principalId: string;
  readonly roleKey: string;
  readonly authorizationBasisHash: QaContentHash;
  readonly authenticationContextRef: string;
  readonly stepUpAt?: string;
}

export interface QaSchemaBoundResourceRef {
  readonly key: string;
  readonly schemaRef: Readonly<{ id: string; version: number; digest: QaContentHash }>;
  readonly resourceRef: QaProjectExactRef;
}

export interface QaProjectEnvironmentRevision extends QaScope {
  readonly schemaVersion?: 1;
  readonly revisionId: string;
  readonly environmentId: string;
  readonly version: number;
  readonly key: string;
  readonly name: string;
  readonly scope: QaProjectEnvironmentScope;
  readonly ownerPrincipalId: string;
  readonly dataClassificationKey: string;
  readonly status: QaProjectResourceState;
  readonly configurationRef: QaSchemaBoundResourceRef;
  readonly allowedTestDataPolicyRefs: readonly QaProjectExactRef[];
  readonly createdBy: QaHumanActor | QaPublishedHumanActor;
  readonly createdAt: string;
  readonly publishedAt?: string;
  readonly retiredAt?: string;
  readonly contentHash: QaContentHash;
}

export interface QaTestDataCatalogEntry extends QaScope {
  readonly entryId: string;
  readonly version: number;
  readonly kind: "DATASET" | "PREPARATION_PROCEDURE";
  readonly externalRef: QaProjectExactRef;
  readonly ownerPrincipalId: string;
  readonly allowedEnvironmentRefs: readonly QaProjectExactRef[];
  readonly dataClassificationKey: string;
  readonly retentionPolicyRef: QaProjectExactRef;
  readonly state: "PUBLISHED" | "RETIRED";
  readonly contentHash: QaContentHash;
}

export interface QaAccountPoolReference extends QaScope {
  readonly poolId: string;
  readonly version: number;
  readonly environmentRef: QaProjectExactRef;
  readonly resolverRef: QaSchemaBoundResourceRef;
  readonly ownerPrincipalId: string;
  readonly maximumConcurrentLeases: number;
  readonly maximumLeaseDurationSeconds: number;
  readonly dataClassificationKey: string;
  readonly state: "PUBLISHED" | "RETIRED";
  readonly contentHash: QaContentHash;
}

export interface QaTestAccountLease extends QaScope {
  readonly schemaVersion?: 1;
  readonly leaseId: string;
  readonly version: number;
  readonly poolRef: QaProjectExactRef;
  readonly environmentRef: QaProjectExactRef;
  readonly subject: Readonly<{
    kind: "WORK_ITEM" | "SESSION";
    id: string;
    version?: number;
    contentHash?: QaContentHash;
  }>;
  readonly leasedToPrincipalId: string;
  readonly opaqueAccountRef: string;
  readonly state: "ACTIVE" | "RELEASED" | "EXPIRED" | "REVOKED";
  readonly acquiredAt: string;
  readonly expiresAt: string;
  readonly releasedAt?: string;
  readonly revokedAt?: string;
  readonly reasonCode?: string;
  readonly createdBy:
    | QaHumanActor
    | QaPublishedHumanActor
    | Readonly<{ kind: "SERVICE"; principalId: string; serviceKey: string }>;
  readonly contentHash: QaContentHash;
  readonly resourceVersion: number;
}

function assertNoSecrets(value: unknown): void {
  const forbidden = /password|token|cookie|secretValue|signedUrl|authorizationHeader/iu;
  const visit = (child: unknown): void => {
    if (Array.isArray(child)) {
      child.forEach(visit);
      return;
    }
    if (child === null || typeof child !== "object") return;
    for (const [key, nested] of Object.entries(child as Record<string, unknown>)) {
      if (forbidden.test(key)) throw new QaDomainError("QA_PROJECT_RESOURCE_SECRET_FORBIDDEN");
      visit(nested);
    }
  };
  visit(value);
}

function assertRef(ref: QaProjectExactRef): void {
  if (!ref.id || ref.version < 1 || !/^sha256:[a-f0-9]{64}$/u.test(ref.contentHash))
    throw new QaDomainError("QA_PROJECT_RESOURCE_REF_INVALID");
}

export function createQaProjectEnvironmentRevision(
  input: Omit<QaProjectEnvironmentRevision, "contentHash">,
): QaProjectEnvironmentRevision {
  assertNoSecrets(input);
  if (
    !input.workspaceId ||
    !input.projectId ||
    !input.revisionId ||
    !input.environmentId ||
    input.version < 1 ||
    !input.key ||
    !input.name ||
    (input.scope as string) === "PLATFORM_PROD" ||
    !["LOCAL", "NON_PROD", "PREPROD"].includes(input.scope) ||
    !input.ownerPrincipalId ||
    !input.dataClassificationKey ||
    Number.isNaN(Date.parse(input.createdAt))
  ) {
    throw new QaDomainError("QA_PROJECT_ENVIRONMENT_INVALID");
  }
  input.allowedTestDataPolicyRefs.forEach(assertRef);
  assertRef(input.configurationRef.resourceRef);
  if (!/^sha256:[a-f0-9]{64}$/u.test(input.configurationRef.schemaRef.digest))
    throw new QaDomainError("QA_PROJECT_RESOURCE_SCHEMA_REF_INVALID");
  if (input.status === "PUBLISHED" && !input.publishedAt)
    throw new QaDomainError("QA_PROJECT_ENVIRONMENT_PUBLISHED_AT_REQUIRED");
  const body = structuredClone(input);
  return Object.freeze({ ...body, contentHash: qaAggregateSnapshotHash(body as never) });
}

export function assertQaResourceScope(resource: QaScope, scope: QaScope): void {
  if (resource.workspaceId !== scope.workspaceId || resource.projectId !== scope.projectId)
    throw new QaDomainError("QA_PROJECT_RESOURCE_SCOPE_MISMATCH");
}

export function assertOpaqueAccountPool(pool: Omit<QaAccountPoolReference, "contentHash">): void {
  assertNoSecrets(pool);
  if (
    pool.maximumConcurrentLeases < 1 ||
    pool.maximumLeaseDurationSeconds < 1 ||
    pool.state !== "PUBLISHED"
  ) {
    throw new QaDomainError("QA_ACCOUNT_POOL_INVALID");
  }
}
