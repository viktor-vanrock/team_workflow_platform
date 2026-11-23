import { type JsonValue, sha256, type Sha256Digest } from "@awp/platform-contracts";

import type { QaAutomationTechnicalResult } from "../domain/automation-attempt.ts";
import type { QaFindingClassification } from "../domain/finding.ts";

const ref = (key: string) => Object.freeze({ key, version: "1.0.0", hash: sha256({ key }) });

export interface QaResultReviewPreparationInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly workItemId: string;
  readonly workItemVersion: number;
  readonly workItemContentHash: string;
  readonly sessionReviewRefs: readonly string[];
  readonly evidenceManifestRefs: readonly string[];
  readonly findingReviewRefs: readonly string[];
  readonly agentRunId: string;
  readonly now: Date;
  readonly expiresAt: Date;
}

export type QaAutomationReviewUnresolvedCheck =
  | "ATTEMPT_NONTERMINAL"
  | "RETRY_DECISION_OPEN"
  | "RECONCILIATION_INCOMPLETE"
  | "ATTEMPT_SET_STALE"
  | "FINDING_REVIEW_REQUIRED"
  | "FLAKY_DISPOSITION_REQUIRED"
  | "QUARANTINE_WARNING_UNDISPOSED"
  | "RISK_REVIEW_REQUIRED";

export interface QaAutomationReviewAttemptSummary {
  readonly automationAttemptId: string;
  readonly attemptNo: number;
  readonly outcome: QaAutomationTechnicalResult;
  readonly resultHash: Sha256Digest;
}

export interface QaAutomationReviewFindingDraft {
  readonly title: string;
  readonly suggestedClassification: QaFindingClassification;
  readonly evidenceRefs: readonly string[];
}

export type QaAutomationReviewQuarantineSubject =
  | Readonly<{
      kind: "SUITE_BINDING_VERSION";
      suiteBindingRef: Readonly<{ id: string; version: number; contentHash: Sha256Digest }>;
    }>
  | Readonly<{ kind: "INFRASTRUCTURE_CODE"; infrastructureCode: string }>;

export interface QaAutomationReviewQuarantineWarning {
  readonly quarantineId: string;
  readonly subject: QaAutomationReviewQuarantineSubject;
  readonly currentRevisionNo: number;
  readonly currentRevisionHash: Sha256Digest;
  readonly effectiveState: "ACTIVE" | "EXPIRED";
}

/**
 * Authorized, provider-neutral facts accepted by the optional Feature 005 Hermes path.
 * Artifact payloads and provider locators deliberately have no representation here.
 */
export interface QaAutomationResultReviewPacketInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly workItemId: string;
  readonly testSessionId: string;
  readonly attemptSetHash: Sha256Digest;
  readonly attempts: readonly QaAutomationReviewAttemptSummary[];
  readonly artifactReferences: readonly string[];
  readonly findingDrafts: readonly QaAutomationReviewFindingDraft[];
  readonly flakySuspected: boolean;
  readonly quarantineWarnings: readonly QaAutomationReviewQuarantineWarning[];
  readonly unresolvedChecks: readonly QaAutomationReviewUnresolvedCheck[];
  readonly generatedAt: Date;
}

export interface QaAutomationResultReviewPacket {
  readonly schemaVersion: "result-review-packet@1.0.0";
  readonly workspaceId: string;
  readonly projectId: string;
  readonly workItemId: string;
  readonly testSessionId: string;
  readonly attemptSetHash: Sha256Digest;
  readonly attempts: readonly QaAutomationReviewAttemptSummary[];
  readonly artifactReferences: readonly string[];
  readonly findingDrafts: readonly QaAutomationReviewFindingDraft[];
  readonly flakySuspected: boolean;
  readonly quarantineWarnings: readonly QaAutomationReviewQuarantineWarning[];
  readonly unresolvedChecks: readonly QaAutomationReviewUnresolvedCheck[];
  readonly proposalOnly: true;
  readonly generatedAt: string;
  readonly contentHash: Sha256Digest;
}

const unresolvedCheckOrder: readonly QaAutomationReviewUnresolvedCheck[] = Object.freeze([
  "ATTEMPT_NONTERMINAL",
  "RETRY_DECISION_OPEN",
  "RECONCILIATION_INCOMPLETE",
  "ATTEMPT_SET_STALE",
  "FINDING_REVIEW_REQUIRED",
  "FLAKY_DISPOSITION_REQUIRED",
  "QUARANTINE_WARNING_UNDISPOSED",
  "RISK_REVIEW_REQUIRED",
]);

const findingTaxonomy = new Set<QaFindingClassification>([
  "PRODUCT",
  "INFRA",
  "INCONCLUSIVE",
  "DUPLICATE",
  "ACCEPTED_RISK",
]);

function uniqueSorted(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort((left, right) => left.localeCompare(right)));
}

function assertPacketInput(input: QaAutomationResultReviewPacketInput): void {
  if (input.attempts.length < 1 || input.attempts.length > 32)
    throw new Error("QA_REVIEW_PACKET_ATTEMPTS_INVALID");
  if (input.artifactReferences.length > 128)
    throw new Error("QA_REVIEW_PACKET_ARTIFACT_REFS_INVALID");
  if (input.findingDrafts.length > 64) throw new Error("QA_REVIEW_PACKET_FINDING_DRAFTS_INVALID");
  if (input.quarantineWarnings.length > 32) throw new Error("QA_REVIEW_PACKET_QUARANTINES_INVALID");
  if (input.unresolvedChecks.length > 32) throw new Error("QA_REVIEW_PACKET_CHECKS_INVALID");
  if (input.attempts.some(({ attemptNo }) => !Number.isInteger(attemptNo) || attemptNo < 1))
    throw new Error("QA_REVIEW_PACKET_ATTEMPT_NO_INVALID");
  if (
    input.findingDrafts.some(
      ({ suggestedClassification }) => !findingTaxonomy.has(suggestedClassification),
    )
  )
    throw new Error("QA_REVIEW_PACKET_FINDING_TAXONOMY_INVALID");
}

export function deterministicQaAutomationResultReviewPacket(
  input: QaAutomationResultReviewPacketInput,
): QaAutomationResultReviewPacket {
  assertPacketInput(input);
  const attempts = Object.freeze(
    [...input.attempts]
      .sort(
        (left, right) =>
          left.attemptNo - right.attemptNo ||
          left.automationAttemptId.localeCompare(right.automationAttemptId),
      )
      .map((attempt) =>
        Object.freeze({
          automationAttemptId: attempt.automationAttemptId,
          attemptNo: attempt.attemptNo,
          outcome: attempt.outcome,
          resultHash: attempt.resultHash,
        }),
      ),
  );
  const artifactReferences = uniqueSorted(input.artifactReferences);
  const findingDrafts = Object.freeze(
    [...input.findingDrafts]
      .map((draft) =>
        Object.freeze({
          title: draft.title,
          suggestedClassification: draft.suggestedClassification,
          evidenceRefs: uniqueSorted(draft.evidenceRefs),
        }),
      )
      .sort(
        (left, right) =>
          left.title.localeCompare(right.title) ||
          left.suggestedClassification.localeCompare(right.suggestedClassification) ||
          left.evidenceRefs.join("\u0000").localeCompare(right.evidenceRefs.join("\u0000")),
      ),
  );
  const quarantineWarnings = Object.freeze(
    [...input.quarantineWarnings]
      .map((warning) =>
        Object.freeze({
          quarantineId: warning.quarantineId,
          subject:
            warning.subject.kind === "SUITE_BINDING_VERSION"
              ? Object.freeze({
                  kind: "SUITE_BINDING_VERSION" as const,
                  suiteBindingRef: Object.freeze({ ...warning.subject.suiteBindingRef }),
                })
              : Object.freeze({
                  kind: "INFRASTRUCTURE_CODE" as const,
                  infrastructureCode: warning.subject.infrastructureCode,
                }),
          currentRevisionNo: warning.currentRevisionNo,
          currentRevisionHash: warning.currentRevisionHash,
          effectiveState: warning.effectiveState,
        }),
      )
      .sort(
        (left, right) =>
          left.quarantineId.localeCompare(right.quarantineId) ||
          left.currentRevisionNo - right.currentRevisionNo,
      ),
  );
  const requestedChecks = new Set(input.unresolvedChecks);
  if (quarantineWarnings.length > 0) requestedChecks.add("QUARANTINE_WARNING_UNDISPOSED");
  else requestedChecks.delete("QUARANTINE_WARNING_UNDISPOSED");
  const unresolvedChecks = Object.freeze(
    unresolvedCheckOrder.filter((check) => requestedChecks.has(check)),
  );
  const unsigned = Object.freeze({
    schemaVersion: "result-review-packet@1.0.0" as const,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    workItemId: input.workItemId,
    testSessionId: input.testSessionId,
    attemptSetHash: input.attemptSetHash,
    attempts,
    artifactReferences,
    findingDrafts,
    flakySuspected: input.flakySuspected,
    quarantineWarnings,
    unresolvedChecks,
    proposalOnly: true as const,
    generatedAt: input.generatedAt.toISOString(),
  });
  return Object.freeze({ ...unsigned, contentHash: sha256(unsigned as unknown as JsonValue) });
}

export function deterministicQaResultReviewPreparation(input: QaResultReviewPreparationInput) {
  const facts = {
    sessionReviewRefs: input.sessionReviewRefs,
    evidenceManifestRefs: input.evidenceManifestRefs,
    findingReviewRefs: input.findingReviewRefs,
  };
  return Object.freeze({
    schemaVersion: "result-review-preparation@1.0.0",
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    workItemId: input.workItemId,
    workItemVersion: input.workItemVersion,
    workItemContentHash: input.workItemContentHash,
    sessionReviewRefs: input.sessionReviewRefs,
    evidenceManifestRefs: input.evidenceManifestRefs,
    findingReviewRefs: input.findingReviewRefs,
    summary: "Материалы собраны для HUMAN review; вердикт не сформирован.",
    openQuestions: [],
    riskFlags: [],
    inputFingerprint: sha256(facts as JsonValue),
    rulesRef: ref("qa.result-review"),
    skillRef: ref("qa-result-review-prep"),
    policyRef: ref("qa.agent-policy"),
    agentRunRef: input.agentRunId,
    actionProvenanceRef: `agent-run:${input.agentRunId}:review-prep`,
    state: "CURRENT",
    expiresAt: input.expiresAt.toISOString(),
    createdAt: input.now.toISOString(),
  });
}
