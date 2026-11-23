import { randomUUID } from "node:crypto";

import type { EntityManager } from "typeorm";

import type {
  ConfirmedOperationalEffect,
  CoreMutationRefs,
  OperationalConfirmationHook,
  PackConfirmationDelta,
  PackOwnedTransaction,
} from "@awp/competency-sdk";

import type { QaCompletionSummary } from "../domain/completion.ts";
import { buildQaDodAssessment, type QaDodAssessment } from "../domain/dod.ts";
import {
  qaAggregateSnapshotHash,
  type QaContentHash,
  QaDomainError,
  type QaExactReference,
  type QaHumanActor,
} from "../domain/primitives.ts";
import { TypeOrmQaVerdictDodRepository } from "../persistence/verdict-dod.repository.ts";
import { createCompletionCandidate } from "./create-completion-candidate.ts";

type Row = Record<string, unknown>;
const first = (value: unknown): Row | undefined => {
  const rows = Array.isArray(value) && Array.isArray(value[0]) ? value[0] : value;
  return Array.isArray(rows) ? (rows[0] as Row | undefined) : undefined;
};
const same = (left: unknown, right: unknown) =>
  left !== undefined &&
  right !== undefined &&
  qaAggregateSnapshotHash(left as never) === qaAggregateSnapshotHash(right as never);
const invalid = () => new QaDomainError("QA_COMPLETION_CONFIRMATION_INVALID");
const instant = (value: unknown) =>
  (value instanceof Date ? value : new Date(String(value))).toISOString();

export function createQaTypeOrmCompletionConfirmationHook(): OperationalConfirmationHook {
  return Object.freeze({
    key: "qa.completion-confirmation",
    order: 2500,
    matches: (input: ConfirmedOperationalEffect) =>
      input.capabilityKey === "operational-work-item" &&
      input.capabilityVersion === "1.0.0" &&
      input.operation === "request.transition" &&
      (input.result as Row).normalizedStatus === "DONE",
    apply: async (
      input: ConfirmedOperationalEffect & CoreMutationRefs,
      transaction: PackOwnedTransaction,
    ): Promise<PackConfirmationDelta> => {
      const manager = transaction.native as EntityManager;
      if (
        !manager.queryRunner?.isTransactionActive ||
        !input.source.sourceWorkItemId ||
        (input.workItemId && input.workItemId !== input.source.sourceWorkItemId)
      )
        throw invalid();
      const scope = [input.workspaceId, input.projectId, input.source.sourceWorkItemId];
      await manager.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `qa-request:${scope.join(":")}`,
      ]);
      const extension = first(
        await manager.query(
          "SELECT * FROM qa_request_extensions WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3 FOR UPDATE",
          scope,
        ),
      );
      const candidate = first(
        await manager.query(
          "SELECT * FROM qa_completion_candidates WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3 AND command_ref->>'id'=$4 FOR UPDATE",
          [...scope, input.commandId],
        ),
      );
      const result = input.result as Row;
      const receipt = result.completionSummaryReceipt as Row | undefined;
      const expectedEffectHash = qaAggregateSnapshotHash(input.effectIdempotencyKey as never);
      const candidateBinding =
        typeof candidate?.binding_ref === "string"
          ? (JSON.parse(candidate.binding_ref) as Row)
          : (candidate?.binding_ref as Row | undefined);
      const candidateProfiles =
        typeof candidate?.profile_refs === "string"
          ? (JSON.parse(candidate.profile_refs) as Row[])
          : (candidate?.profile_refs as Row[] | undefined);
      if (
        !extension ||
        !candidate ||
        !["DISPATCHED", "CONFIRMED"].includes(String(candidate.state)) ||
        candidate.effect_key_hash !== expectedEffectHash ||
        String(candidateBinding?.id) !== input.bindingRef.id ||
        Number(candidateBinding?.version) !== input.bindingRef.version ||
        candidateProfiles?.length !== 1 ||
        input.profileRefs.length !== 1 ||
        String(candidateProfiles[0]?.id) !== input.profileRefs[0]?.id ||
        Number(candidateProfiles[0]?.version) !== input.profileRefs[0]?.version ||
        result.operation !== "request.transition" ||
        result.normalizedStatus !== "DONE" ||
        result.effectId !== input.effectIdempotencyKey ||
        receipt?.contentHash !== candidate.summary_content_hash ||
        typeof receipt?.id !== "string" ||
        !receipt.id.trim() ||
        typeof result.rawExternalState !== "string" ||
        !result.rawExternalState.trim() ||
        typeof result.externalVersion !== "string" ||
        !result.externalVersion.trim() ||
        typeof result.observedAt !== "string" ||
        !Number.isFinite(Date.parse(result.observedAt)) ||
        Date.parse(result.observedAt) < Date.parse(instant(candidate.dispatched_at))
      ) {
        throw new QaDomainError("QA_COMPLETION_CONFIRMATION_INVALID");
      }
      const currentInput = first(
        await manager.query(
          "SELECT external_request_id FROM qa_request_input_revisions WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3 AND input_revision_id=$4",
          [...scope, extension.current_input_revision_id],
        ),
      );
      if (!currentInput || currentInput.external_request_id !== result.externalEntityId)
        throw invalid();
      const summary = candidate.summary as QaCompletionSummary;
      const rebuilt = createCompletionCandidate({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        workItemId: input.source.sourceWorkItemId,
        candidateId: String(candidate.candidate_id),
        candidateNumber: Number(candidate.candidate_number),
        readyToCloseDodRef: candidate.ready_to_close_dod_ref as QaExactReference,
        verdictRef: candidate.verdict_ref as QaExactReference,
        requiredSessionPlanRef: candidate.required_session_plan_ref as QaExactReference,
        aggregateSnapshotHash: candidate.aggregate_snapshot_hash as QaContentHash,
        expectedExternalState: String(candidate.expected_external_state),
        expectedExternalVersion: String(candidate.expected_external_version),
        bindingRef: candidate.binding_ref as { id: string; version: number },
        profileRefs: candidate.profile_refs as { id: string; version: number }[],
        initiatedBy: candidate.initiated_by as QaHumanActor,
        createdAt: instant(candidate.created_at),
        verdict: summary.verdict,
        residualRisk: summary.residualRisk,
        evidenceManifestRefs: summary.evidenceManifestRefs,
        defectLinkOrDispositionRefs: summary.defectLinkOrDispositionRefs,
      });
      if (rebuilt.contentHash !== candidate.content_hash || !same(rebuilt.summary, summary))
        throw invalid();
      const existing = first(
        await manager.query(
          "SELECT * FROM qa_final_close_confirmations WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3 AND command_ref->>'id'=$4",
          [...scope, input.commandId],
        ),
      );
      if (existing) {
        if (
          candidate.state !== "CONFIRMED" ||
          existing.candidate_id !== candidate.candidate_id ||
          existing.candidate_content_hash !== candidate.content_hash ||
          existing.summary_digest !== candidate.summary_content_hash ||
          !same(existing.summary_receipt, receipt) ||
          existing.raw_external_state !== result.rawExternalState ||
          existing.external_version !== result.externalVersion ||
          instant(existing.confirmed_at) !== result.observedAt
        )
          throw invalid();
        return Object.freeze({
          idempotencyKey: transaction.idempotencyKey,
          replayed: true,
          events: [],
          audit: [
            {
              action: "qa.completion.confirm",
              outcome: "REPLAYED" as const,
              reasonCode: "FINAL_CLOSE_ALREADY_CONFIRMED",
            },
          ],
        });
      }
      if (
        candidate.state !== "DISPATCHED" ||
        extension.completion_in_flight_candidate_id !== candidate.candidate_id ||
        extension.adjudicative_aggregate_hash !== candidate.aggregate_snapshot_hash ||
        !same(extension.completion_dispatch_guard, {
          state: "DISPATCHED",
          candidateId: candidate.candidate_id,
          commandId: input.commandId,
        })
      )
        throw invalid();
      const readyRef = candidate.ready_to_close_dod_ref as QaExactReference;
      const ready = first(
        await manager.query(
          "SELECT * FROM qa_dod_assessments WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3 AND assessment_id=$4 AND version=$5 AND content_hash=$6 AND state='READY_TO_CLOSE'",
          [...scope, readyRef.id, readyRef.version, readyRef.contentHash],
        ),
      );
      if (!ready || extension.latest_dod_assessment_id !== ready.assessment_id) throw invalid();
      const readyAssessment = buildQaDodAssessment({
        assessmentId: String(ready.assessment_id),
        version: Number(ready.version),
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        workItemId: input.source.sourceWorkItemId,
        state: "READY_TO_CLOSE",
        blockerCodes: ready.blocker_codes,
        warningCodes: ready.warning_codes,
        inventory: ready.inventory,
        aggregateInputHash: ready.aggregate_input_hash,
        ruleSetRef: ready.rule_set_ref,
        riskPolicyRef: ready.risk_policy_ref,
        evaluatedBy: ready.evaluated_by,
        evaluatedAt: instant(ready.evaluated_at),
      } as Omit<QaDodAssessment, "contentHash">);
      if (
        readyAssessment.contentHash !== ready.content_hash ||
        readyAssessment.blockerCodes.length ||
        !same(readyAssessment.inventory.verdictRef, candidate.verdict_ref) ||
        !same(
          readyAssessment.inventory.requiredSessionPlanRef,
          candidate.required_session_plan_ref,
        ) ||
        !same(
          [...readyAssessment.inventory.evidenceManifestRefs].sort(
            (a, b) => a.id.localeCompare(b.id) || a.version - b.version,
          ),
          summary.evidenceManifestRefs,
        )
      )
        throw invalid();
      const confirmationId = randomUUID();
      const confirmationBody = Object.freeze({
        confirmationId,
        candidateRef: {
          id: candidate.candidate_id,
          version: Number(candidate.version),
          contentHash: candidate.content_hash,
        },
        requiredSessionPlanRef: candidate.required_session_plan_ref,
        verdictRef: candidate.verdict_ref,
        readyToCloseDodRef: candidate.ready_to_close_dod_ref,
        approvalRef: candidate.approval_ref,
        commandRef: { id: input.commandId },
        summaryDigest: candidate.summary_content_hash,
        summaryReceipt: receipt,
        rawExternalState: result.rawExternalState,
        externalVersion: result.externalVersion,
        normalizedStatus: "DONE",
        confirmedAt: result.observedAt,
      });
      const confirmationHash = qaAggregateSnapshotHash(confirmationBody as never);
      await manager.query(
        "INSERT INTO qa_final_close_confirmations(confirmation_id,workspace_id,project_id,work_item_id,candidate_id,candidate_version,candidate_content_hash,required_session_plan_ref,verdict_ref,ready_to_close_dod_ref,approval_ref,command_ref,summary_digest,summary_receipt,raw_external_state,external_version,normalized_status,confirmed_at,content_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'DONE',$17,$18)",
        [
          confirmationId,
          input.workspaceId,
          input.projectId,
          candidate.work_item_id,
          candidate.candidate_id,
          candidate.version,
          candidate.content_hash,
          JSON.stringify(candidate.required_session_plan_ref),
          JSON.stringify(candidate.verdict_ref),
          JSON.stringify(candidate.ready_to_close_dod_ref),
          JSON.stringify(candidate.approval_ref),
          JSON.stringify({ id: input.commandId }),
          candidate.summary_content_hash,
          JSON.stringify(receipt),
          result.rawExternalState,
          result.externalVersion,
          result.observedAt,
          confirmationHash,
        ],
      );
      await manager.query(
        "UPDATE qa_completion_candidates SET state='CONFIRMED',terminal_from_state='DISPATCHED',confirmation_ref=$1,summary_receipt=$2,confirmed_at=$3,terminal_reason=NULL,failure_code=NULL,resource_version=resource_version+1 WHERE candidate_id=$4 AND state='DISPATCHED'",
        [
          JSON.stringify({ id: confirmationId, version: 1, contentHash: confirmationHash }),
          JSON.stringify(receipt),
          result.observedAt,
          candidate.candidate_id,
        ],
      );
      const latest = first(
        await manager.query(
          "SELECT COALESCE(max(version),0) AS version FROM qa_dod_assessments WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3",
          [input.workspaceId, input.projectId, candidate.work_item_id],
        ),
      );
      const dodVersion = Number(latest?.version ?? 0) + 1;
      const dodId = randomUUID();
      const completionRef = Object.freeze({
        id: confirmationId,
        version: 1,
        contentHash: confirmationHash,
      });
      const { contentHash: readyHash, ...readyBody } = readyAssessment;
      if (readyHash !== readyRef.contentHash) throw invalid();
      const satisfied = buildQaDodAssessment({
        ...readyBody,
        assessmentId: dodId,
        version: dodVersion,
        state: "SATISFIED",
        evaluatedBy: "confirmation-hook",
        evaluatedAt: result.observedAt,
        completionConfirmationRef: completionRef,
      });
      await new TypeOrmQaVerdictDodRepository(manager).appendDod(satisfied);
      await manager.query(
        "UPDATE qa_request_extensions SET latest_dod_assessment_id=$1,completion_in_flight_candidate_id=NULL,completion_dispatch_guard=jsonb_build_object('state','DONE_FROZEN','candidateId',$2),resource_version=resource_version+1,updated_at=$3 WHERE workspace_id=$4 AND project_id=$5 AND work_item_id=$6 AND completion_in_flight_candidate_id=$2",
        [
          dodId,
          candidate.candidate_id,
          result.observedAt,
          input.workspaceId,
          input.projectId,
          candidate.work_item_id,
        ],
      );
      const frozen = first(
        await manager.query(
          "UPDATE qa_required_session_plans SET frozen_at=$1,resource_version=resource_version+1,updated_at=$1 WHERE workspace_id=$2 AND project_id=$3 AND work_item_id=$4 AND current_version_id=$5 AND frozen_at IS NULL RETURNING plan_id",
          [
            result.observedAt,
            input.workspaceId,
            input.projectId,
            candidate.work_item_id,
            (candidate.required_session_plan_ref as Row).id,
          ],
        ),
      );
      if (!frozen) throw invalid();
      return Object.freeze({
        idempotencyKey: transaction.idempotencyKey,
        replayed: false,
        events: Object.freeze([
          { eventType: "qa.dod.satisfied", entityId: dodId, payload: satisfied },
        ]),
        audit: Object.freeze([
          {
            action: "qa.completion.confirm",
            outcome: "SUCCEEDED" as const,
            reasonCode: "EXTERNAL_DONE_CONFIRMED",
            attributes: { candidateId: candidate.candidate_id, confirmationId },
          },
        ]),
      });
    },
  });
}
