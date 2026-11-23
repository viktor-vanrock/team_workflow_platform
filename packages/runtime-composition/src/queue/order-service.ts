import { type JsonValue, sha256 } from "@awp/platform-contracts";
import {
  createQueueActionPair,
  type QueueActionCandidateForApproval,
  type QueueActionPair,
} from "@awp/platform-core";

export interface QueueOrderKey {
  readonly projectId: string;
  readonly workItemId: string;
}

export interface QueueOrderMove {
  readonly subject: QueueOrderKey;
  readonly placement: "FIRST" | "LAST" | "BEFORE" | "AFTER";
  readonly anchor?: QueueOrderKey;
}

export type QueueOrderMoveResult<T extends QueueOrderKey> = Readonly<
  | { applicationState: "APPLIED"; entries: readonly T[] }
  | { applicationState: "ANCHOR_UNAVAILABLE_NO_OP"; entries: readonly T[] }
>;

const sameKey = (left: QueueOrderKey, right: QueueOrderKey): boolean =>
  left.projectId === right.projectId && left.workItemId === right.workItemId;

export function applyQueueOrderMove<T extends QueueOrderKey>(
  entries: readonly T[],
  move: QueueOrderMove,
): QueueOrderMoveResult<T> {
  const subjectIndex = entries.findIndex((entry) => sameKey(entry, move.subject));
  if (subjectIndex < 0) throw new Error("QUEUE_ORDER_SUBJECT_NOT_FOUND");
  if ((move.placement === "BEFORE" || move.placement === "AFTER") && !move.anchor)
    throw new Error("QUEUE_ORDER_ANCHOR_REQUIRED");
  if ((move.placement === "FIRST" || move.placement === "LAST") && move.anchor)
    throw new Error("QUEUE_ORDER_ANCHOR_FORBIDDEN");
  if (move.anchor && sameKey(move.subject, move.anchor))
    return Object.freeze({
      applicationState: "ANCHOR_UNAVAILABLE_NO_OP",
      entries: Object.freeze([...entries]),
    });
  const subject = entries[subjectIndex]!;
  const remaining = entries.filter((_entry, index) => index !== subjectIndex);
  let insertionIndex: number;
  if (move.placement === "FIRST") insertionIndex = 0;
  else if (move.placement === "LAST") insertionIndex = remaining.length;
  else {
    const anchorIndex = remaining.findIndex((entry) => sameKey(entry, move.anchor!));
    if (anchorIndex < 0)
      return Object.freeze({
        applicationState: "ANCHOR_UNAVAILABLE_NO_OP",
        entries: Object.freeze([...entries]),
      });
    insertionIndex = move.placement === "BEFORE" ? anchorIndex : anchorIndex + 1;
  }
  const reordered = [...remaining];
  reordered.splice(insertionIndex, 0, subject);
  return Object.freeze({ applicationState: "APPLIED", entries: Object.freeze(reordered) });
}

export interface QueueOrderRequest {
  readonly requestKey: string;
  readonly workspaceId: string;
  readonly principalId: string;
  readonly scopeKind: "PROJECT" | "AUTHORIZED_PORTFOLIO";
  readonly subject: QueueOrderKey &
    Readonly<{
      expectedQueueEntry: Readonly<{
        queueEntryId: string;
        revision: number;
        semanticHash: string;
        inputFingerprint: string;
      }>;
    }>;
  readonly placement: QueueOrderMove["placement"];
  readonly anchor?: QueueOrderKey;
  readonly expectedOrderResourceVersion: number;
  readonly expectedQueueEpoch: number;
  readonly expectedBaseVisibleSetHash: string;
  readonly expectedAuthorizedProjectSetHash: string;
  readonly expectedProjectionGeneration: string;
  readonly expectedComparatorRef: "queue-order@1.0.0";
  readonly reason: string;
  readonly expiresAt: string;
}

export interface AuthorizedOrderEntry extends QueueOrderKey {
  readonly expectedQueueEntry: Readonly<{
    queueEntryId: string;
    revision: number;
    semanticHash: string;
    inputFingerprint: string;
  }>;
  readonly workItemRef: Readonly<{
    sourceType: "WORK_ITEM_REVISION";
    sourceId: string;
    sourceVersion: number;
    semanticHash: string;
  }>;
}

interface AuthorizedOrderView {
  readonly entries: readonly AuthorizedOrderEntry[];
  readonly orderState: Readonly<{
    resourceVersion: number;
    queueEpoch: number;
    baseVisibleSetHash: string;
  }>;
  readonly authorizedProjectSetHash: string;
  readonly projectionGeneration: string;
}

export interface QueueOrderServiceDependencies {
  readonly authorizeTarget: (request: QueueOrderRequest) => Promise<boolean>;
  readonly readAuthorizedView: (request: QueueOrderRequest) => Promise<AuthorizedOrderView>;
  readonly commit: (pair: QueueActionPair) => Promise<unknown>;
  readonly now?: () => string;
}

const deterministicUuid = (namespace: string): string => {
  const hex = sha256(namespace).slice(7).split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 3) | 8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20, 32).join("")}`;
};

export class QueueOrderService {
  constructor(private readonly dependencies: QueueOrderServiceDependencies) {}

  async request(input: QueueOrderRequest): Promise<Readonly<Record<string, unknown>>> {
    if (!(await this.dependencies.authorizeTarget(input)))
      throw new Error("QUEUE_ORDER_TARGET_NOT_FOUND");
    const view = await this.dependencies.readAuthorizedView(input);
    const now = this.dependencies.now?.() ?? new Date().toISOString();
    if (
      !input.reason.trim() ||
      !Number.isFinite(Date.parse(input.expiresAt)) ||
      Date.parse(input.expiresAt) <= Date.parse(now)
    )
      throw new Error("QUEUE_ORDER_EXPIRY_INVALID");
    if (
      input.expectedOrderResourceVersion !== view.orderState.resourceVersion ||
      input.expectedQueueEpoch !== view.orderState.queueEpoch ||
      input.expectedBaseVisibleSetHash !== view.orderState.baseVisibleSetHash ||
      input.expectedAuthorizedProjectSetHash !== view.authorizedProjectSetHash
    )
      throw new Error("QUEUE_ORDER_CAS_CONFLICT");
    if (
      input.expectedProjectionGeneration !== view.projectionGeneration ||
      input.expectedComparatorRef !== "queue-order@1.0.0"
    )
      throw new Error("QUEUE_ORDER_PROJECTION_CONFLICT");
    if (input.reason.trim().length > 2_000) throw new Error("QUEUE_ORDER_REASON_INVALID");
    const target = view.entries.find((entry) => sameKey(entry, input.subject));
    if (
      !target ||
      sha256(target.expectedQueueEntry as unknown as JsonValue) !==
        sha256(input.subject.expectedQueueEntry as unknown as JsonValue)
    ) {
      throw new Error("QUEUE_ORDER_ENTRY_TUPLE_CONFLICT");
    }
    if (
      input.scopeKind === "PROJECT" &&
      view.entries.some(({ projectId }) => projectId !== input.subject.projectId)
    )
      throw new Error("QUEUE_ORDER_PROJECT_SCOPE_VIOLATION");
    const move = applyQueueOrderMove(view.entries, {
      subject: input.subject,
      placement: input.placement,
      ...(input.anchor ? { anchor: input.anchor } : {}),
    });
    const actionId = deterministicUuid(
      `queue-order:${input.workspaceId}:${input.principalId}:${input.requestKey}`,
    );
    const scope =
      input.scopeKind === "PROJECT"
        ? Object.freeze({
            kind: "PROJECT" as const,
            workspaceId: input.workspaceId,
            projectId: input.subject.projectId,
          })
        : Object.freeze({
            kind: "AUTHORIZED_PORTFOLIO" as const,
            workspaceId: input.workspaceId,
            authorizedProjectSetHash: view.authorizedProjectSetHash as `sha256:${string}`,
          });
    const actionTarget = Object.freeze({
      kind: "WORK_ITEM" as const,
      workspaceId: input.workspaceId,
      projectId: target.projectId,
      workItemRef: target.workItemRef,
    });
    const expectedVisibleState = Object.freeze({
      kind: "ORDER",
      expectedQueueEntry: target.expectedQueueEntry,
      expectedOrderResourceVersion: input.expectedOrderResourceVersion,
      expectedQueueEpoch: input.expectedQueueEpoch,
      expectedBaseVisibleSetHash: input.expectedBaseVisibleSetHash,
      expectedAuthorizedProjectSetHash: input.expectedAuthorizedProjectSetHash,
      expectedProjectionGeneration: input.expectedProjectionGeneration,
      expectedComparatorRef: input.expectedComparatorRef,
    });
    const requestHash = sha256(input as unknown as JsonValue);
    const common = {
      schemaVersion: "queue-action-candidate@1.0.0" as const,
      actionId,
      actionKind: "QUEUE_ORDER_OVERRIDE" as const,
      scope,
      target: actionTarget,
      requestHash,
      expectedVisibleState,
      reason: input.reason,
    };
    if (move.applicationState === "ANCHOR_UNAVAILABLE_NO_OP") {
      const candidate = Object.freeze({
        ...common,
        requestedEffect: Object.freeze({ kind: "ANCHOR_UNAVAILABLE_NO_OP" }),
        approvalPolicy: "NO_SECOND_APPROVAL" as const,
      }) as QueueActionCandidateForApproval;
      const pair = createQueueActionPair({
        candidate,
        witness: {
          schemaVersion: "queue-control-action@1.0.0",
          actionId,
          actionKind: "QUEUE_ORDER_OVERRIDE",
          scope,
          target: actionTarget,
          expectedState: expectedVisibleState,
          requestedEffect: Object.freeze({
            kind: "ANCHOR_UNAVAILABLE_NO_OP",
            ...(input.anchor
              ? {
                  requestedAnchor: Object.freeze({
                    projectId: input.anchor.projectId,
                    workItemId: input.anchor.workItemId,
                  }),
                }
              : {}),
          }),
          reason: input.reason,
          approvalPolicy: "NO_SECOND_APPROVAL",
          idempotencyKeyHash: sha256(input.requestKey),
        },
      });
      const resultRef = Object.freeze({
        sourceType: "QUEUE_ACTION_CANDIDATE",
        sourceId: actionId,
        sourceVersion: 1,
        semanticHash: pair.publicIntentHash,
      });
      await this.dependencies.commit(pair);
      return Object.freeze({
        candidate: pair.candidate,
        publicIntentHash: pair.publicIntentHash,
        state: "CONSUMED",
        approvalRequired: false,
        effect: pair.candidate.requestedEffect,
        resultRef,
      });
    }
    const requestedEffect = Object.freeze({
      kind: "MOVE",
      placement: input.placement,
      ...(input.anchor
        ? {
            anchor: Object.freeze({
              projectId: input.anchor.projectId,
              workItemId: input.anchor.workItemId,
            }),
          }
        : {}),
    });
    const candidate = Object.freeze({
      ...common,
      requestedEffect,
      expiresAt: input.expiresAt,
      approvalPolicy: "SELF_APPROVAL_FORBIDDEN" as const,
    }) as unknown as QueueActionCandidateForApproval;
    const pair = createQueueActionPair({
      candidate,
      witness: {
        schemaVersion: "queue-control-action@1.0.0",
        actionId,
        actionKind: "QUEUE_ORDER_OVERRIDE",
        scope,
        target: actionTarget,
        expectedState: expectedVisibleState,
        requestedEffect,
        reason: input.reason,
        expiresAt: input.expiresAt,
        approvalPolicy: "SELF_APPROVAL_FORBIDDEN",
        idempotencyKeyHash: sha256(input.requestKey),
      },
    });
    await this.dependencies.commit(pair);
    return Object.freeze({
      candidate: pair.candidate,
      publicIntentHash: pair.publicIntentHash,
      state: "PENDING_APPROVAL",
      approvalRequired: true,
      effect: pair.candidate.requestedEffect,
    });
  }
}
