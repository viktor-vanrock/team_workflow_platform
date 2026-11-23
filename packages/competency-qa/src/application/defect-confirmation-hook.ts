import { randomUUID } from "node:crypto";

import type {
  ConfirmedOperationalEffect,
  OperationalConfirmationHook,
  PackConfirmationDelta,
  PackOwnedTransaction,
} from "@awp/competency-sdk";

import type { QaDefectDraftAggregate, QaDefectLink } from "../domain/defect-publication.ts";
import {
  qaAggregateSnapshotHash,
  type QaContentHash,
  QaDomainError,
} from "../domain/primitives.ts";

interface DefectCreateResult {
  readonly operation: "defect.create";
  readonly entityKind: "DEFECT";
  readonly externalEntityId: string;
  readonly externalDisplayKey: string;
  readonly externalVersion: string;
  readonly rawExternalState: string;
  readonly normalizedStatus: "NEW";
  readonly effectId: string;
  readonly observedAt: string;
}

export class DefectLinkConfirmationStore {
  readonly #draftByCommand = new Map<string, QaDefectDraftAggregate>();
  readonly #linkByCommand = new Map<string, QaDefectLink>();

  register(draft: QaDefectDraftAggregate): void {
    if (draft.state !== "DISPATCHED" || !draft.commandRef)
      throw new QaDomainError("QA_DEFECT_DRAFT_NOT_DISPATCHED");
    this.#draftByCommand.set(draft.commandRef.id, draft);
  }

  draft(commandId: string): QaDefectDraftAggregate | undefined {
    return this.#draftByCommand.get(commandId);
  }
  link(commandId: string): QaDefectLink | undefined {
    return this.#linkByCommand.get(commandId);
  }
  save(commandId: string, link: QaDefectLink): void {
    if (this.#linkByCommand.has(commandId))
      throw new QaDomainError("QA_DEFECT_LINK_ALREADY_EXISTS");
    if ([...this.#linkByCommand.values()].some(({ findingId }) => findingId === link.findingId))
      throw new QaDomainError("QA_DEFECT_LINK_FINDING_ALREADY_LINKED");
    this.#linkByCommand.set(commandId, Object.freeze(link));
  }
  links(): readonly QaDefectLink[] {
    return Object.freeze([...this.#linkByCommand.values()]);
  }
}

export function createQaDefectConfirmationHook(
  store: DefectLinkConfirmationStore,
): OperationalConfirmationHook<DefectCreateResult> {
  return Object.freeze({
    key: "qa.defect-create-confirmation",
    order: 2400,
    matches: (input: ConfirmedOperationalEffect<DefectCreateResult>) =>
      input.capabilityKey === "operational-work-item" &&
      input.capabilityVersion === "1.0.0" &&
      input.operation === "defect.create",
    apply: async (
      input: ConfirmedOperationalEffect<DefectCreateResult>,
      transaction: PackOwnedTransaction,
    ): Promise<PackConfirmationDelta> => {
      const existing = store.link(input.commandId);
      if (existing)
        return Object.freeze({
          idempotencyKey: transaction.idempotencyKey,
          replayed: true,
          events: Object.freeze([]),
          audit: Object.freeze([
            {
              action: "qa.defect.link",
              outcome: "REPLAYED" as const,
              reasonCode: "DEFECT_LINK_ALREADY_CONFIRMED",
            },
          ]),
        });
      const draft = store.draft(input.commandId);
      if (!draft || draft.workspaceId !== input.workspaceId || draft.projectId !== input.projectId)
        throw new QaDomainError("QA_DEFECT_CONFIRMATION_SCOPE_MISMATCH");
      if (
        !draft.bindingRef ||
        draft.bindingRef.id !== input.bindingRef.id ||
        draft.bindingRef.version !== input.bindingRef.version
      )
        throw new QaDomainError("QA_DEFECT_CONFIRMATION_BINDING_MISMATCH");
      if (
        input.result.operation !== "defect.create" ||
        input.result.entityKind !== "DEFECT" ||
        input.result.normalizedStatus !== "NEW" ||
        input.result.effectId !== input.effectIdempotencyKey
      )
        throw new QaDomainError("QA_DEFECT_CONFIRMATION_RESULT_INVALID");
      const linkId = randomUUID();
      const body = {
        defectLinkId: linkId,
        workspaceId: draft.workspaceId,
        projectId: draft.projectId,
        workItemId: draft.workItemId,
        sessionId: draft.sessionId,
        findingId: draft.findingId,
        frozenFindingReviewRef: draft.frozenFindingReviewRef,
        defectDraftRef: {
          id: draft.defectDraftId,
          version: draft.version,
          contentHash: draft.contentHash,
        },
        externalEntityId: input.result.externalEntityId,
        externalDisplayKey: input.result.externalDisplayKey,
        externalVersion: input.result.externalVersion,
        rawExternalState: input.result.rawExternalState,
        normalizedStatus: "NEW" as const,
        effectKeyHash: (draft.effectKeyHash ??
          qaAggregateSnapshotHash(input.effectIdempotencyKey as never)) as QaContentHash,
        linkedAt: input.result.observedAt,
      };
      const link = Object.freeze({ ...body, contentHash: qaAggregateSnapshotHash(body as never) });
      store.save(input.commandId, link);
      draft.link(linkId);
      return Object.freeze({
        idempotencyKey: transaction.idempotencyKey,
        replayed: false,
        events: Object.freeze([{ eventType: "qa.defect.linked", entityId: linkId, payload: link }]),
        audit: Object.freeze([
          {
            action: "qa.defect.link",
            outcome: "SUCCEEDED" as const,
            reasonCode: "EXTERNAL_DEFECT_CONFIRMED",
            attributes: { findingId: draft.findingId, defectDraftId: draft.defectDraftId },
          },
        ]),
      });
    },
  });
}
