import {
  deterministicQaAutomationResultReviewPacket,
  type QaAutomationResultReviewPacketInput,
} from "@awp/competency-qa";
import { designContractRegistry } from "@awp/platform-contracts";
import type { AgentRunSubject } from "@awp/platform-core";

import type { AgentSkillExecutor } from "./agent-run-worker.ts";

export const qaAutomationReviewPacketSchemaId =
  "urn:awp:schemas:005:result-review-packet:v1" as const;
export const qaAutomationReviewPacketSkillKey = "qa-result-review-prep" as const;

export type QaAutomationReviewPacketFacts = Omit<
  QaAutomationResultReviewPacketInput,
  "workspaceId" | "projectId" | "workItemId" | "generatedAt"
>;

/**
 * The loader is the authorization boundary. Its output is provider-neutral and
 * intentionally cannot carry artifact bytes, provider locators, or credentials.
 */
export interface QaAutomationReviewPacketLoader {
  load(
    input: Readonly<{
      workspaceId: string;
      projectId: string;
      subject: AgentRunSubject;
    }>,
  ): Promise<QaAutomationReviewPacketFacts>;
}

export function createQaAutomationReviewPacketExecutor(
  loader: QaAutomationReviewPacketLoader,
  now: () => Date = () => new Date(),
): AgentSkillExecutor {
  return Object.freeze<AgentSkillExecutor>({
    execute: async ({ run, skill }) => {
      if (skill.key !== qaAutomationReviewPacketSkillKey || run.subject.kind !== "WORK_ITEM") {
        throw new Error("QA_AUTOMATION_REVIEW_PACKET_SUBJECT_DENIED");
      }
      const facts = await loader.load({
        workspaceId: run.workspaceId,
        projectId: run.projectId,
        subject: run.subject,
      });
      const packet = deterministicQaAutomationResultReviewPacket({
        workspaceId: run.workspaceId,
        projectId: run.projectId,
        workItemId: run.subject.id,
        testSessionId: facts.testSessionId,
        attemptSetHash: facts.attemptSetHash,
        attempts: facts.attempts,
        artifactReferences: facts.artifactReferences,
        findingDrafts: facts.findingDrafts,
        flakySuspected: facts.flakySuspected,
        quarantineWarnings: facts.quarantineWarnings,
        unresolvedChecks: facts.unresolvedChecks,
        generatedAt: now(),
      });
      designContractRegistry.validateById(qaAutomationReviewPacketSchemaId, packet as never);
      return Object.freeze({ result: packet, fallback: true });
    },
  });
}
