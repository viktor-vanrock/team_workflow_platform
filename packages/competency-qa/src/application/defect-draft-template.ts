import { randomUUID } from "node:crypto";

import { QaDefectDraftAggregate, type QaDefectDraftPayload } from "../domain/defect-publication.ts";
import type { QaFindingAggregate } from "../domain/finding.ts";
import { QaDomainError, type QaHumanActor } from "../domain/primitives.ts";

export const qaDefectDraftTemplateVersion = "1.0.0" as const;

export function buildDeterministicDefectDraft(
  input: Readonly<{
    finding: QaFindingAggregate;
    createdBy: QaHumanActor;
    at: string;
    draftId?: string;
    wording?: Partial<
      Pick<
        QaDefectDraftPayload,
        "title" | "description" | "stepsToReproduce" | "expectedOutcome" | "actualOutcome"
      >
    >;
    provenance?:
      "DETERMINISTIC_TEMPLATE" | "MODEL_PROPOSAL_ACCEPTED" | "DETERMINISTIC_FALLBACK_ACCEPTED";
  }>,
): QaDefectDraftAggregate {
  const review = input.finding.currentReview;
  if (!input.finding.canCreateDefectDraft() || !review || review.stage !== "FROZEN")
    throw new QaDomainError("QA_DEFECT_DRAFT_PRODUCT_CREATE_DEFECT_REQUIRED");
  const evidenceRefs = input.finding.evidenceRefs;
  if (!evidenceRefs.length) throw new QaDomainError("QA_DEFECT_DRAFT_EVIDENCE_REQUIRED");
  const payload: QaDefectDraftPayload = Object.freeze({
    title: input.wording?.title ?? `[QA] ${review.summary}`,
    description:
      input.wording?.description ??
      `${review.classificationReason}\n\nDisposition: ${review.dispositionReason}`,
    stepsToReproduce: Object.freeze(
      input.wording?.stepsToReproduce ??
        review.observationMembershipIds.map(
          (id, index) => `${index + 1}. Reproduce observation membership ${id}`,
        ),
    ),
    expectedOutcome:
      input.wording?.expectedOutcome ?? "The validated acceptance outcome is satisfied.",
    actualOutcome: input.wording?.actualOutcome ?? review.summary,
    severity: review.severity,
    target: Object.freeze({ contentHash: review.affectedTargetHash }),
    evidenceRefs: Object.freeze([...evidenceRefs]),
  });
  for (const value of [
    payload.title,
    payload.description,
    payload.expectedOutcome,
    payload.actualOutcome,
  ])
    if (!value.trim()) throw new QaDomainError("QA_DEFECT_DRAFT_WORDING_INVALID");
  if (!payload.stepsToReproduce.length || payload.stepsToReproduce.some((step) => !step.trim()))
    throw new QaDomainError("QA_DEFECT_DRAFT_WORDING_INVALID");
  return new QaDefectDraftAggregate({
    defectDraftId: input.draftId ?? randomUUID(),
    version: 1,
    finding: input.finding,
    frozenReview: review,
    payload,
    provenance: {
      source: input.provenance ?? "DETERMINISTIC_TEMPLATE",
      templateVersion: qaDefectDraftTemplateVersion,
    },
    createdBy: input.createdBy,
    at: input.at,
  });
}
