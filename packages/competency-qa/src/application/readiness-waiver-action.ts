import { type QaContentHash, QaDomainError, type QaScope } from "../domain/primitives.ts";
import type { QaReadinessAssessment } from "../domain/readiness.ts";
import { approveDorWaiver, createDorWaiver, type QaDorWaiver } from "../domain/waiver.ts";

export const QA_DOR_WAIVER_ACTION_KIND = "qa.readiness.dor-waiver@1" as const;

export interface QaDorWaiverActionSubject {
  readonly waiver: QaDorWaiver;
  readonly assessmentRef: Readonly<{ id: string; version: number; contentHash: QaContentHash }>;
  readonly inputFingerprint: QaContentHash;
}

export function prepareReadinessWaiverAction(
  input: Readonly<{
    id: string;
    assessment: QaReadinessAssessment;
    initiatedBy: string;
    reason: string;
    expiresAt: string;
    createdAt: string;
  }>,
): QaDorWaiverActionSubject {
  const blocker = input.assessment.blockers.find(
    ({ code }) => code === "PROJECT_REGISTRY_NEEDS_REVIEW",
  );
  if (
    !blocker ||
    input.assessment.blockers.some(({ code }) => code !== "PROJECT_REGISTRY_NEEDS_REVIEW")
  )
    throw new QaDomainError("QA_DOR_WAIVER_HARD_BLOCKER_PRESENT");
  const waiver = createDorWaiver({
    id: input.id,
    scope: input.assessment.scope,
    workItemId: input.assessment.workItemId,
    ruleCode: "PROJECT_REGISTRY_NEEDS_REVIEW",
    assessmentRef: {
      id: input.assessment.assessmentId,
      version: input.assessment.version,
      contentHash: input.assessment.contentHash,
    },
    inputFingerprint: input.assessment.inputFingerprint,
    initiatedBy: input.initiatedBy,
    reason: input.reason,
    expiresAt: input.expiresAt,
    createdAt: input.createdAt,
  });
  return Object.freeze({
    waiver,
    assessmentRef: waiver.assessmentRef,
    inputFingerprint: waiver.inputFingerprint,
  });
}

export function executeReadinessWaiverAction(
  subject: QaDorWaiverActionSubject,
  context: Readonly<{
    scope: QaScope;
    approverId: string;
    role: string;
    authorizationBasisHash: QaContentHash;
    decidedAt: string;
  }>,
): QaDorWaiver {
  if (
    subject.waiver.scope.workspaceId !== context.scope.workspaceId ||
    subject.waiver.scope.projectId !== context.scope.projectId
  )
    throw new QaDomainError("QA_SCOPE_MISMATCH");
  return approveDorWaiver(subject.waiver, {
    actorId: context.approverId,
    role: context.role,
    authorizationBasisHash: context.authorizationBasisHash,
    decidedAt: context.decidedAt,
  });
}
