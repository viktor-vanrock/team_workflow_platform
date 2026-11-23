export type ReconciliationLane = "IMPORT_DISCOVERY" | "BOUND_REFRESH" | "FULL_DRIFT_SWEEP";
export interface ReconciliationWatermark {
  readonly updatedAt: string;
  readonly externalKey: string;
  readonly overlapSeconds: number;
}
export interface OperationalReconciliationPlan {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly lane: ReconciliationLane;
  readonly profileRef: Readonly<{ id: string; version: number }>;
  readonly connectionRef: Readonly<{ id: string; version: number }>;
  readonly startWatermark: ReconciliationWatermark;
  readonly pageSize: number;
  readonly maxConcurrency: number;
}
export interface OperationalReconciliationRun {
  readonly id: string;
  readonly plan: OperationalReconciliationPlan;
  readonly state: "PENDING" | "RUNNING" | "SUCCEEDED" | "PARTIAL" | "FAILED" | "CANCELLED";
  readonly completedWatermark?: ReconciliationWatermark;
}

export function completeReconciliationRun(
  run: OperationalReconciliationRun,
  complete: boolean,
  watermark?: ReconciliationWatermark,
): OperationalReconciliationRun {
  if (complete && !watermark) throw new Error("COMPLETE_RECONCILIATION_REQUIRES_WATERMARK");
  return Object.freeze({
    ...run,
    state: complete ? "SUCCEEDED" : "PARTIAL",
    ...(complete && watermark ? { completedWatermark: watermark } : {}),
  });
}
