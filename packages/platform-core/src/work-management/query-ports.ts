export type NormalizedStatus =
  | "NEW"
  | "NEEDS_INFO"
  | "READY"
  | "PLANNED"
  | "IN_PROGRESS"
  | "REVIEW"
  | "BLOCKED"
  | "DONE"
  | "CANCELLED";

export interface ProjectRegistryStatus {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly lifecycleState: "ACTIVE" | "INACTIVE";
  readonly verificationState: "CURRENT" | "NEEDS_REVIEW";
  readonly verificationRef: Readonly<{ id: string; version: number }>;
}

export interface ProjectRegistryQueryPort {
  projectRegistryStatus(
    workspaceId: string,
    projectId: string,
  ): Promise<ProjectRegistryStatus | undefined>;
}

export interface OperationalProjection {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly workItemId: string;
  readonly workTypeKey: string;
  readonly workTypeVersion: string;
  readonly normalizedStatus: NormalizedStatus;
  readonly rawExternalState: string;
  readonly externalVersion?: string;
  readonly resourceVersion: number;
  /** Exact immutable authority revision used for every derived queue/SLA fact. */
  readonly projectionRef?: Readonly<{
    sourceType: "JIRA_OPERATIONAL_PROJECTION_REVISION";
    sourceId: string;
    sourceVersion: number;
    semanticHash: `sha256:${string}`;
    observedAt: string;
    confirmedAt: string;
  }>;
  readonly mappingRef?: Readonly<{ id: string; version: number }>;
  readonly freshness?: "CURRENT" | "STALE" | "UNKNOWN";
}

export interface OperationalProjectionQueryPort {
  operationalProjection(
    workspaceId: string,
    projectId: string,
    workItemId: string,
  ): Promise<OperationalProjection | undefined>;
}
