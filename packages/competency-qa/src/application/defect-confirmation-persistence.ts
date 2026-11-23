import { randomUUID } from "node:crypto";

import type { EntityManager } from "typeorm";

import type {
  ConfirmedOperationalEffect,
  CoreMutationRefs,
  OperationalConfirmationHook,
  PackConfirmationDelta,
  PackOwnedTransaction,
} from "@awp/competency-sdk";

import { qaAggregateSnapshotHash, QaDomainError } from "../domain/primitives.ts";

export function createQaTypeOrmDefectConfirmationHook(): OperationalConfirmationHook {
  return Object.freeze({
    key: "qa.defect-create-confirmation",
    order: 2400,
    matches: (input: ConfirmedOperationalEffect) =>
      input.capabilityKey === "operational-work-item" &&
      input.capabilityVersion === "1.0.0" &&
      input.operation === "defect.create",
    apply: async (
      input: ConfirmedOperationalEffect & CoreMutationRefs,
      transaction: PackOwnedTransaction,
    ): Promise<PackConfirmationDelta> => {
      const manager = transaction.native as EntityManager;
      const result = input.result as Readonly<Record<string, unknown>>;
      const existingRaw = (await manager.query(
        "SELECT defect_link_id FROM qa_defect_links WHERE workspace_id=$1 AND project_id=$2 AND command_ref->>'id'=$3",
        [input.workspaceId, input.projectId, input.commandId],
      )) as readonly unknown[];
      const existing = (Array.isArray(existingRaw[0]) ? existingRaw[0][0] : existingRaw[0]) as
        Record<string, unknown> | undefined;
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
      const draftRaw = (await manager.query(
        "SELECT * FROM qa_defect_drafts WHERE workspace_id=$1 AND project_id=$2 AND command_ref->>'id'=$3 FOR UPDATE",
        [input.workspaceId, input.projectId, input.commandId],
      )) as readonly unknown[];
      const draft = (Array.isArray(draftRaw[0]) ? draftRaw[0][0] : draftRaw[0]) as
        Record<string, unknown> | undefined;
      if (
        !draft ||
        draft.state !== "DISPATCHED" ||
        result.operation !== "defect.create" ||
        result.entityKind !== "DEFECT" ||
        result.normalizedStatus !== "NEW" ||
        result.effectId !== input.effectIdempotencyKey
      )
        throw new QaDomainError("QA_DEFECT_CONFIRMATION_INVALID");
      const linkId = randomUUID();
      const body = {
        defectLinkId: linkId,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        workItemId: draft.work_item_id,
        sessionId: draft.session_id,
        findingId: draft.finding_id,
        frozenFindingReviewRef: { id: draft.frozen_finding_review_id },
        defectDraftRef: {
          id: draft.defect_draft_id,
          version: Number(draft.version),
          contentHash: draft.content_hash,
        },
        commandRef: { id: input.commandId },
        approvalRef: draft.approval_ref,
        confirmationReceiptRef: {
          id:
            (input.resultRefs as Record<string, string> | undefined)?.confirmationReceiptId ??
            input.commandId,
        },
        operationalResultRef: {
          id:
            (input.resultRefs as Record<string, string> | undefined)?.operationalResultId ??
            input.commandId,
        },
        effectKeyHash: draft.effect_key_hash,
        externalEntityId: result.externalEntityId,
        externalDisplayKey: result.externalDisplayKey,
        externalVersion: result.externalVersion,
        rawExternalState: result.rawExternalState,
        normalizedStatus: "NEW",
        bindingRef: input.bindingRef,
        profileRefs: input.profileRefs,
        confirmedBy: draft.accepted_by,
        authorizationBasisHash: qaAggregateSnapshotHash(draft.approval_ref as never),
        linkedAt: result.observedAt,
        correlationId: input.correlationId,
        causationId: input.causationId,
      };
      const contentHash = qaAggregateSnapshotHash(body as never);
      await manager.query(
        "INSERT INTO qa_defect_links(defect_link_id,workspace_id,project_id,work_item_id,session_id,finding_id,frozen_finding_review_id,defect_draft_id,command_ref,approval_ref,confirmation_receipt_ref,operational_result_ref,effect_key_hash,external_entity_id,external_display_key,external_version,raw_external_state,normalized_status,binding_ref,profile_refs,confirmed_by,authorization_basis_hash,linked_at,correlation_id,causation_id,content_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'NEW',$18,$19,$20,$21,$22,$23,$24,$25)",
        [
          linkId,
          input.workspaceId,
          input.projectId,
          draft.work_item_id,
          draft.session_id,
          draft.finding_id,
          draft.frozen_finding_review_id,
          draft.defect_draft_id,
          JSON.stringify({ id: input.commandId }),
          JSON.stringify(draft.approval_ref),
          JSON.stringify(body.confirmationReceiptRef),
          JSON.stringify(body.operationalResultRef),
          draft.effect_key_hash,
          result.externalEntityId,
          result.externalDisplayKey,
          result.externalVersion,
          result.rawExternalState,
          JSON.stringify(input.bindingRef),
          JSON.stringify(input.profileRefs),
          JSON.stringify(draft.accepted_by),
          body.authorizationBasisHash,
          result.observedAt,
          input.correlationId,
          input.causationId,
          contentHash,
        ],
      );
      await manager.query(
        "UPDATE qa_defect_drafts SET state='LINKED',defect_link_id=$1,resource_version=resource_version+1,updated_at=$2 WHERE defect_draft_id=$3 AND state='DISPATCHED'",
        [linkId, result.observedAt, draft.defect_draft_id],
      );
      return Object.freeze({
        idempotencyKey: transaction.idempotencyKey,
        replayed: false,
        events: Object.freeze([
          { eventType: "qa.defect.linked", entityId: linkId, payload: { ...body, contentHash } },
        ]),
        audit: Object.freeze([
          {
            action: "qa.defect.link",
            outcome: "SUCCEEDED" as const,
            reasonCode: "EXTERNAL_DEFECT_CONFIRMED",
          },
        ]),
      });
    },
  });
}
