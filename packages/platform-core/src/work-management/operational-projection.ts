import type { VersionedReference } from "../shared/primitives.ts";

export type OperationalNormalizedAuthorityStatus =
  | "NEW"
  | "NEEDS_INFO"
  | "READY"
  | "PLANNED"
  | "IN_PROGRESS"
  | "REVIEW"
  | "BLOCKED"
  | "DONE"
  | "CANCELLED";
export type OperationalObservationSource =
  | "CREATE_READ_BACK"
  | "IMPORT_READ"
  | "COMMAND_CONFIRMATION"
  | "WEBHOOK_READ"
  | "RECONCILIATION_READ"
  | "CONFLICT_READ";

export interface CompleteOperationalObservation {
  readonly observationId: string;
  readonly source: OperationalObservationSource;
  readonly externalEntityId: string;
  readonly externalDisplayKey: string;
  readonly externalWebUrl?: string;
  readonly externalRevisionToken: string;
  readonly authorityFieldsHash: string;
  readonly providerUpdatedAt: string;
  readonly providerChangelogId?: string;
  readonly observedAt: string;
  readonly rawStatus: Readonly<{ id: string; name: string }>;
  readonly normalizedStatus: OperationalNormalizedAuthorityStatus;
  /** Optional Jira-owned block classification. Free-text Session reasons never populate this field. */
  readonly blockReason?: Readonly<{
    rawId: string;
    rawName: string;
    normalizedReasonCode: string;
  }> | null;
  readonly requester: Readonly<{ externalPrincipalId: string; canonicalPrincipalId?: string }>;
  readonly assignee?: Readonly<{
    externalPrincipalId: string;
    canonicalPrincipalId?: string;
  }> | null;
  readonly priority?: Readonly<{ rawId: string; rawName: string; normalizedKey: string }> | null;
  readonly dueDate?: string | null;
  readonly profileRef: VersionedReference;
  readonly mappingRef: VersionedReference;
  readonly connectionRef: VersionedReference;
  readonly adapterFamily: string;
  readonly adapterContractVersion: string;
}

export interface OperationalProjectionRevision extends CompleteOperationalObservation {
  readonly revision: number;
  readonly appliedAt: string;
}

export type ProjectionDisposition =
  "DUPLICATE" | "STALE_IGNORED" | "APPLIED" | "GAP_REQUIRES_RECONCILIATION";
export interface ProjectionReduction {
  readonly disposition: ProjectionDisposition;
  readonly projection?: OperationalProjectionRevision;
  readonly reasonCode?: string;
}

function semanticEqual(
  left: CompleteOperationalObservation,
  right: CompleteOperationalObservation,
): boolean {
  return (
    left.externalRevisionToken === right.externalRevisionToken &&
    left.authorityFieldsHash === right.authorityFieldsHash
  );
}

export function reduceOperationalProjection(
  current: OperationalProjectionRevision | undefined,
  next: CompleteOperationalObservation,
): ProjectionReduction {
  if (
    !next.externalEntityId ||
    !next.externalRevisionToken ||
    !next.authorityFieldsHash ||
    !Number.isFinite(Date.parse(next.providerUpdatedAt))
  )
    throw new Error("OPERATIONAL_OBSERVATION_INCOMPLETE");
  if (!current)
    return Object.freeze({
      disposition: "APPLIED",
      projection: Object.freeze({ ...next, revision: 1, appliedAt: next.observedAt }),
    });
  if (semanticEqual(current, next))
    return Object.freeze({ disposition: "DUPLICATE", projection: current });
  if (current.externalRevisionToken === next.externalRevisionToken)
    return Object.freeze({
      disposition: "GAP_REQUIRES_RECONCILIATION",
      projection: current,
      reasonCode: "SAME_TOKEN_DIFFERENT_HASH",
    });
  const currentTime = Date.parse(current.providerUpdatedAt);
  const nextTime = Date.parse(next.providerUpdatedAt);
  if (nextTime < currentTime)
    return Object.freeze({
      disposition: "STALE_IGNORED",
      projection: current,
      reasonCode: "OLDER_PROVIDER_TIME",
    });
  if (
    nextTime === currentTime &&
    /^\d+$/u.test(current.providerChangelogId ?? "") &&
    /^\d+$/u.test(next.providerChangelogId ?? "") &&
    BigInt(next.providerChangelogId!) < BigInt(current.providerChangelogId!)
  )
    return Object.freeze({
      disposition: "STALE_IGNORED",
      projection: current,
      reasonCode: "OLDER_PROVIDER_CHANGELOG",
    });
  if (nextTime === currentTime && current.providerChangelogId === next.providerChangelogId)
    return Object.freeze({
      disposition: "GAP_REQUIRES_RECONCILIATION",
      projection: current,
      reasonCode: "INCOMPARABLE_PROVIDER_REVISION",
    });
  return Object.freeze({
    disposition: "APPLIED",
    projection: Object.freeze({
      ...next,
      revision: current.revision + 1,
      appliedAt: next.observedAt,
    }),
  });
}

export function deriveProjectionFreshness(
  lastObservedAt: Date | undefined,
  targetSeconds: number | undefined,
  now: Date,
): "CURRENT" | "STALE" | "UNKNOWN" {
  if (!lastObservedAt || targetSeconds === undefined || targetSeconds <= 0) return "UNKNOWN";
  return lastObservedAt.getTime() + targetSeconds * 1_000 > now.getTime() ? "CURRENT" : "STALE";
}
