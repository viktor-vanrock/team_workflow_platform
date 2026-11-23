import { type JsonValue, sha256 } from "@awp/platform-contracts";

export interface CapacityOverLimitNotificationIntent extends Readonly<Record<string, JsonValue>> {
  readonly schemaVersion: "capacity-over-limit-notification-intent@1.0.0";
  readonly intentId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly workItemId: string;
  readonly audience: "PROJECT_LEADS";
  readonly reasonCode: "CAPACITY_OVER_LIMIT_DETECTED";
  readonly admissionDecisionRef: Readonly<{
    sourceType: "CAPACITY_ADMISSION_DECISION";
    sourceId: string;
    sourceVersion: 1;
    semanticHash: `sha256:${string}`;
  }>;
  readonly correlationId: string;
  readonly createdAt: string;
  readonly creationHash: `sha256:${string}`;
}

export function createCapacityOverLimitNotificationIntent(
  input: Readonly<{
    intentId: string;
    workspaceId: string;
    projectId: string;
    workItemId: string;
    admissionDecisionRef: CapacityOverLimitNotificationIntent["admissionDecisionRef"];
    correlationId: string;
    createdAt: string;
  }>,
): CapacityOverLimitNotificationIntent {
  if (
    !input.intentId ||
    !input.workspaceId ||
    !input.projectId ||
    !input.workItemId ||
    !Number.isFinite(Date.parse(input.createdAt))
  )
    throw new Error("CAPACITY_NOTIFICATION_INPUT_INVALID");
  const body = Object.freeze({
    schemaVersion: "capacity-over-limit-notification-intent@1.0.0" as const,
    ...input,
    audience: "PROJECT_LEADS" as const,
    reasonCode: "CAPACITY_OVER_LIMIT_DETECTED" as const,
  });
  return Object.freeze({ ...body, creationHash: sha256(body as unknown as JsonValue) });
}
