import {
  assessQaIntakeCompleteness,
  type QaIntakeRevisionSubject,
  selectQaIntakeQuestions,
} from "@awp/competency-qa";
import { sha256 } from "@awp/platform-contracts";
import type { AgentRunSubject } from "@awp/platform-core";

import type { AgentSkillExecutor } from "./agent-run-worker.ts";

export interface QaIntakeSubjectLoader {
  load(subject: AgentRunSubject): Promise<QaIntakeRevisionSubject>;
}

function common(subject: QaIntakeRevisionSubject, createdAt: Date) {
  const completeness = assessQaIntakeCompleteness(subject, createdAt);
  return {
    subject,
    completeness,
    createdAt,
    inputFingerprint: String(completeness.inputFingerprint),
    missingFields: completeness.missingFields as readonly string[],
    invalidFields: completeness.invalidFields as readonly string[],
  };
}

export function createQaIntakeSkillExecutors(
  loader: QaIntakeSubjectLoader,
  now: () => Date = () => new Date(),
): ReadonlyMap<string, AgentSkillExecutor> {
  return new Map<string, AgentSkillExecutor>([
    [
      "qa-intake-readiness",
      {
        execute: async ({ run }) => ({
          result: assessQaIntakeCompleteness(await loader.load(run.subject), now()),
          fallback: true,
        }),
      },
    ],
    [
      "qa-intake-assist",
      {
        execute: async ({ run }) => {
          const value = common(await loader.load(run.subject), now());
          const questions = selectQaIntakeQuestions(value, 6);
          return {
            result: Object.freeze({
              schemaVersion: "intake-draft-assistance@1.0.0",
              workspaceId: value.subject.workspaceId,
              projectId: value.subject.projectId,
              draftId: value.subject.draftId,
              revision: value.subject.revision,
              contentHash: value.subject.contentHash,
              state: questions.length === 0 ? "READY" : "QUESTIONS_REQUIRED",
              missingFields: value.missingFields,
              invalidFields: value.invalidFields,
              questions,
              proposedPatch: Object.freeze([]),
              inputFingerprint: value.inputFingerprint,
              rulesRef: Object.freeze({
                key: "qa.intake-assistance",
                version: "1.0.0",
                hash: sha256({ questionOrder: questions.map(({ fieldKey }) => fieldKey) }),
              }),
              skillRef: Object.freeze({
                key: "qa-intake-assist",
                version: "1.0.0",
                hash: sha256({ key: "qa-intake-assist", version: "1.0.0" }),
              }),
              actionProvenanceRef: `agent-run:${run.id}:intake-assist`,
              createdAt: value.createdAt.toISOString(),
            }),
            fallback: true,
          };
        },
      },
    ],
  ]);
}
