import { type JsonValue, sha256 } from "@awp/platform-contracts";

import type { Sha256Digest } from "../shared/primitives.ts";

export type QueueSubjectKind = "CANDIDATE" | "DRAFT" | "WORK_ITEM";
export type QueueSourceVersion = number | string;

export type QueueSubjectRef =
  | Readonly<{
      kind: "CANDIDATE";
      id: string;
      version: QueueSourceVersion;
      semanticHash: Sha256Digest;
    }>
  | Readonly<{ kind: "DRAFT"; id: string; version: QueueSourceVersion; semanticHash: Sha256Digest }>
  | Readonly<{
      kind: "WORK_ITEM";
      id: string;
      version: QueueSourceVersion;
      semanticHash: Sha256Digest;
    }>;

export type PublicQueueSourceType =
  | "INTAKE_CANDIDATE_REVISION"
  | "INTAKE_DRAFT_REVISION"
  | "WORK_ITEM_REVISION"
  | "JIRA_OPERATIONAL_PROJECTION_REVISION"
  | "JIRA_STATUS_MAPPING_REVISION"
  | "QA_QUEUE_FACT_REVISION"
  | "QA_READINESS_FACT_SET"
  | "QA_TEST_SESSION_REVISION"
  | "QA_AUTOMATED_ACTIVITY_FACT_SET"
  | "QA_TRIAGE_ASSESSMENT_REVISION"
  | "QA_VERDICT_REVISION"
  | "WORK_ITEM_QUEUE_CONTROL_REVISION"
  | "REVIEW_CAPACITY_RESERVATION_REVISION"
  | "HUMAN_WIP_CLAIM_REVISION"
  | "SLA_CLOCK_REVISION";

export interface ExactQueueSourceRef {
  readonly sourceType: PublicQueueSourceType;
  readonly sourceId: string;
  readonly sourceVersion: QueueSourceVersion;
  readonly semanticHash: Sha256Digest;
  readonly observedAt?: string;
  readonly confirmedAt?: string;
}

export interface QueueVersionedContentRef {
  readonly id: string;
  readonly version: number;
  readonly semanticHash: Sha256Digest;
}

export interface QueueAlgorithmRef {
  readonly key: string;
  readonly version: string;
  readonly semanticHash: Sha256Digest;
}

const hashPattern = /^sha256:[a-f0-9]{64}$/u;
const publicQueueSourceTypes = new Set<PublicQueueSourceType>([
  "INTAKE_CANDIDATE_REVISION",
  "INTAKE_DRAFT_REVISION",
  "WORK_ITEM_REVISION",
  "JIRA_OPERATIONAL_PROJECTION_REVISION",
  "JIRA_STATUS_MAPPING_REVISION",
  "QA_QUEUE_FACT_REVISION",
  "QA_READINESS_FACT_SET",
  "QA_TEST_SESSION_REVISION",
  "QA_AUTOMATED_ACTIVITY_FACT_SET",
  "QA_TRIAGE_ASSESSMENT_REVISION",
  "QA_VERDICT_REVISION",
  "WORK_ITEM_QUEUE_CONTROL_REVISION",
  "REVIEW_CAPACITY_RESERVATION_REVISION",
  "HUMAN_WIP_CLAIM_REVISION",
  "SLA_CLOCK_REVISION",
]);

export function assertExactQueueSourceRef(value: ExactQueueSourceRef): void {
  if (!publicQueueSourceTypes.has(value.sourceType))
    throw new Error("QUEUE_SOURCE_FAMILY_FORBIDDEN");
  if (!value.sourceId.trim()) throw new Error("QUEUE_SOURCE_ID_REQUIRED");
  if (
    typeof value.sourceVersion === "number" &&
    (!Number.isSafeInteger(value.sourceVersion) || value.sourceVersion < 1)
  ) {
    throw new Error("QUEUE_SOURCE_VERSION_INVALID");
  }
  if (typeof value.sourceVersion === "string" && !value.sourceVersion.trim())
    throw new Error("QUEUE_SOURCE_VERSION_INVALID");
  if (!hashPattern.test(value.semanticHash)) throw new Error("QUEUE_SOURCE_HASH_INVALID");
}

export function compareExactQueueSourceRefs(
  left: ExactQueueSourceRef,
  right: ExactQueueSourceRef,
): number {
  return (
    left.sourceType.localeCompare(right.sourceType) ||
    left.sourceId.localeCompare(right.sourceId) ||
    String(left.sourceVersion).localeCompare(String(right.sourceVersion)) ||
    left.semanticHash.localeCompare(right.semanticHash)
  );
}

export function queueSourceSetHash(refs: readonly ExactQueueSourceRef[]): Sha256Digest {
  const sorted = [...refs].sort(compareExactQueueSourceRefs);
  for (const ref of sorted) assertExactQueueSourceRef(ref);
  return sha256(sorted as unknown as JsonValue);
}

export interface AuthorizedQueueScope {
  readonly principalId: string;
  readonly workspaceId: string;
  readonly authorizedProjectIds: readonly string[];
  readonly authorizedProjectSetHash: Sha256Digest;
}

export function authorizedProjectSetHash(projectIds: readonly string[]): Sha256Digest {
  const normalized = [...new Set(projectIds)].sort();
  if (normalized.some((projectId) => !projectId.trim()))
    throw new Error("AUTHORIZED_PROJECT_ID_INVALID");
  return sha256(normalized);
}

export function assertAuthorizedQueueScope(scope: AuthorizedQueueScope): void {
  if (!scope.principalId.trim() || !scope.workspaceId.trim())
    throw new Error("AUTHORIZED_QUEUE_SCOPE_INVALID");
  if (scope.authorizedProjectSetHash !== authorizedProjectSetHash(scope.authorizedProjectIds)) {
    throw new Error("AUTHORIZED_PROJECT_SET_HASH_MISMATCH");
  }
}

export interface QueueEntryReadToken {
  readonly queueEntryId: string;
  readonly revision: number;
  readonly semanticHash: Sha256Digest;
  readonly inputFingerprint: Sha256Digest;
  readonly controlResourceVersion: number;
}

export interface QueueOrderReadToken {
  readonly scopeHeadResourceVersion: number;
  readonly queueEpoch: number;
  readonly authorizedBaseVisibleSetHash: Sha256Digest;
}

export interface QueuePageReadToken {
  readonly authorizedProjectSetHash: Sha256Digest;
  readonly normalizedQueryHash: Sha256Digest;
  readonly comparatorRef: QueueAlgorithmRef;
  readonly authorizedProjectionGeneration: Sha256Digest;
  readonly asOf: string;
  readonly orderState: QueueOrderReadToken;
}

export interface QueuePolicyReadToken {
  readonly policyViewRef: QueueVersionedContentRef;
  readonly etag: `"sha256:${string}"`;
}

export interface QueueProjectLaneQuery {
  readonly scope: AuthorizedQueueScope;
  readonly projectId: string;
  readonly normalizedQueryHash: Sha256Digest;
  readonly cursor?: string;
  readonly pageSize: number;
  readonly asOf?: string;
}

export interface QueuePortfolioQuery {
  readonly scope: AuthorizedQueueScope;
  readonly normalizedQueryHash: Sha256Digest;
  readonly cursor?: string;
  readonly pageSize: number;
  readonly asOf?: string;
}

export interface QueueEntryQuery {
  readonly scope: AuthorizedQueueScope;
  readonly projectId: string;
  readonly queueEntryId: string;
  readonly asOf?: string;
}

export interface QueuePageProjection<TEntry = Readonly<Record<string, unknown>>> {
  readonly entries: readonly TEntry[];
  readonly visibleCounts: Readonly<Record<string, number>>;
  readonly readToken: QueuePageReadToken;
  readonly nextCursor?: string;
  readonly etag: `"sha256:${string}"`;
}

export interface QueueProjectLaneQueryPort<TEntry = Readonly<Record<string, unknown>>> {
  projectLane(query: QueueProjectLaneQuery): Promise<QueuePageProjection<TEntry>>;
}

export interface QueuePortfolioQueryPort<TEntry = Readonly<Record<string, unknown>>> {
  portfolio(query: QueuePortfolioQuery): Promise<QueuePageProjection<TEntry>>;
}

export interface QueueEntryQueryPort<TEntry = Readonly<Record<string, unknown>>> {
  queueEntry(
    query: QueueEntryQuery,
  ): Promise<
    | Readonly<{ entry: TEntry; readToken: QueueEntryReadToken; etag: `"sha256:${string}"` }>
    | undefined
  >;
}

export interface QueuePolicyQueryPort<TPolicy = Readonly<Record<string, unknown>>> {
  policy(
    workspaceId: string,
    principalId: string,
  ): Promise<Readonly<{ policy: TPolicy; readToken: QueuePolicyReadToken }>>;
}

export interface QueueCapacityQueryPort<TCapacity = Readonly<Record<string, unknown>>> {
  capacity(
    scope: AuthorizedQueueScope,
    asOf?: string,
  ): Promise<Readonly<{ capacity: TCapacity; etag: `"sha256:${string}"` }>>;
}

export interface QueueSlaQueryPort<TSla = Readonly<Record<string, unknown>>> {
  sla(
    query: QueueEntryQuery,
    serverAsOf: string,
  ): Promise<Readonly<{ sla: TSla; etag: `"sha256:${string}"` }> | undefined>;
}

export interface HumanCapabilityClaim {
  readonly key: string;
  readonly version: string;
  readonly semanticHash: Sha256Digest;
}

export interface HumanCapabilitySnapshot {
  readonly principalId: string;
  readonly workspaceId: string;
  readonly ref: QueueVersionedContentRef;
  readonly claims: readonly HumanCapabilityClaim[];
  readonly capturedAt: string;
  readonly planningOnly: true;
}

export interface HumanAvailabilitySnapshot {
  readonly principalId: string;
  readonly workspaceId: string;
  readonly ref: QueueVersionedContentRef;
  readonly state: "AVAILABLE" | "LIMITED" | "UNAVAILABLE" | "UNKNOWN";
  readonly availableUntil?: string;
  readonly capturedAt: string;
  readonly planningOnly: true;
}

export interface QueueCapabilityQueryPort {
  capabilitySnapshot(
    workspaceId: string,
    principalId: string,
    asOf: string,
  ): Promise<HumanCapabilitySnapshot | undefined>;
}

export interface QueueAvailabilityQueryPort {
  availabilitySnapshot(
    workspaceId: string,
    principalId: string,
    asOf: string,
  ): Promise<HumanAvailabilitySnapshot | undefined>;
}
