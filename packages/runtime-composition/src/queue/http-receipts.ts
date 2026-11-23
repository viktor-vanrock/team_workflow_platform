type JsonValue =
  null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export type PublicQueueActionKind =
  "QUEUE_CONTROL_ACCEPT" | "QUEUE_ORDER_OVERRIDE" | "SERVICE_CLASS_EXPEDITE";
export type PublicQueueActionState = "PENDING_APPROVAL" | "CONSUMED";
export type PublicQueueActionRef = Readonly<{
  sourceType: string;
  sourceId: string;
  sourceVersion: number;
  semanticHash: string;
}>;

export interface QueueActionReceiptSource {
  readonly actionId: string;
  readonly actionKind: PublicQueueActionKind;
  readonly state: PublicQueueActionState;
  readonly resourceVersion: number;
  readonly publicIntentHash: string;
  readonly approvalRequired: boolean;
  readonly approvalRef?: PublicQueueActionRef;
  readonly resultRef?: PublicQueueActionRef;
  readonly requestedAt: string;
  readonly expiresAt?: string;
}

const digestPattern = /^sha256:[a-f0-9]{64}$/u;

/** Closed HTTP receipt: internal replay/candidate/witness fields never cross the API boundary. */
export function exactQueueActionHttpReceipt(
  source: QueueActionReceiptSource,
): Readonly<Record<string, JsonValue>> {
  const expectedResultFamily =
    source.actionKind === "QUEUE_CONTROL_ACCEPT"
      ? new Set(["WORK_ITEM_QUEUE_CONTROL_REVISION"])
      : source.actionKind === "QUEUE_ORDER_OVERRIDE"
        ? new Set(["QUEUE_ACTION_CANDIDATE", "QUEUE_ORDER_OVERRIDE_REVISION"])
        : new Set(["CAPACITY_ADMISSION_DECISION"]);
  if (
    !source.actionId ||
    !Number.isSafeInteger(source.resourceVersion) ||
    source.resourceVersion < 1 ||
    !digestPattern.test(source.publicIntentHash) ||
    !Number.isFinite(Date.parse(source.requestedAt)) ||
    (source.expiresAt !== undefined && !Number.isFinite(Date.parse(source.expiresAt))) ||
    (source.state === "PENDING_APPROVAL" &&
      (!source.approvalRequired || !source.approvalRef || source.resultRef !== undefined)) ||
    (source.state === "CONSUMED" && !source.resultRef) ||
    (!source.approvalRequired && source.approvalRef !== undefined) ||
    (source.resultRef !== undefined && !expectedResultFamily.has(source.resultRef.sourceType))
  ) {
    throw new Error("QUEUE_ACTION_HTTP_RECEIPT_INVALID");
  }
  return Object.freeze({
    schemaVersion: "queue-action-receipt@1.0.0",
    actionId: source.actionId,
    actionKind: source.actionKind,
    state: source.state,
    resourceVersion: source.resourceVersion,
    publicIntentHash: source.publicIntentHash,
    approvalRequired: source.approvalRequired,
    ...(source.approvalRef ? { approvalRef: source.approvalRef } : {}),
    ...(source.resultRef ? { resultRef: source.resultRef } : {}),
    requestedAt: source.requestedAt,
    ...(source.expiresAt ? { expiresAt: source.expiresAt } : {}),
  } as unknown as Record<string, JsonValue>);
}
