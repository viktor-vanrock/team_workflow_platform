import { buildDeterministicDefectDraft } from "../../packages/competency-qa/src/application/defect-draft-template.ts";
import {
  QaFindingAggregate,
  type QaFindingClassification,
  type QaFindingDispositionDecision,
} from "../../packages/competency-qa/src/domain/finding.ts";

const actor = Object.freeze({
  kind: "HUMAN" as const,
  principalId: "executor-1",
  issuer: "local",
  subject: "executor.alpha",
});

export function createFrozenFinding(
  input: Readonly<{
    classification: QaFindingClassification;
    disposition?: QaFindingDispositionDecision;
    freeze?: boolean;
  }>,
): QaFindingAggregate {
  const finding = QaFindingAggregate.create({
    findingId: "finding-1",
    workspaceId: "workspace-1",
    projectId: "project-1",
    workItemId: "work-item-1",
    sessionId: "session-1",
    membershipId: "membership-1",
    observation: {
      observationId: "observation-1",
      sessionId: "session-1",
      kind: "NEGATIVE",
      affectedTargetHash: `sha256:${"a".repeat(64)}`,
      evidenceRefs: [{ id: "artifact-1", version: "1", contentHash: `sha256:${"b".repeat(64)}` }],
    },
    actor,
    at: "2026-08-30T10:00:00.000Z",
  });
  finding.classify({
    classification: input.classification,
    severity: "HIGH",
    summary: "Observed failure",
    reason: "Human classification",
    policyRef: { key: "qa.finding-review", version: "1.0.0" },
    actor,
    at: "2026-08-30T10:01:00.000Z",
  });
  if (input.disposition) {
    const extra =
      input.disposition === "DUPLICATE"
        ? {
            duplicateDefectRef: {
              kind: "DEFECT",
              id: "BUG-1",
              version: "1",
              contentHash: `sha256:${"c".repeat(64)}`,
            },
          }
        : input.disposition === "ACCEPTED_RISK"
          ? {
              acceptedRiskActionRef: {
                id: "action-1",
                version: 1,
                contentHash: `sha256:${"d".repeat(64)}`,
              },
            }
          : input.disposition === "WAIVED"
            ? {
                waiverActionRef: {
                  id: "action-1",
                  version: 1,
                  contentHash: `sha256:${"d".repeat(64)}`,
                },
              }
            : {};
    finding.dispose({
      decision: input.disposition,
      reason: "Human disposition",
      ...extra,
      actor,
      at: "2026-08-30T10:02:00.000Z",
    });
    if (input.freeze !== false) finding.freeze("2026-08-30T10:03:00.000Z");
  }
  return finding;
}

export function buildReadyDefectDraft() {
  const draft = buildDeterministicDefectDraft({
    finding: createFrozenFinding({ classification: "PRODUCT", disposition: "CREATE_DEFECT" }),
    createdBy: actor,
    at: "2026-08-30T11:00:00.000Z",
  });
  draft.accept({ actor, at: "2026-08-30T11:01:00.000Z" });
  draft.awaitApproval({
    bindingRef: { id: "binding-1", version: 1 },
    profileRefs: [{ id: "profile-1", version: 3 }],
    approvalRef: { id: "approval-1", subjectHash: `sha256:${"e".repeat(64)}` },
    at: "2026-08-30T11:02:00.000Z",
  });
  draft.authorize("2026-08-30T11:03:00.000Z");
  return draft;
}

export function buildDispatchedDefectDraft() {
  const draft = buildReadyDefectDraft();
  draft.dispatch({
    commandId: "command-1",
    effectKeyHash: `sha256:${"f".repeat(64)}`,
    at: "2026-08-30T11:04:00.000Z",
  });
  return draft;
}
