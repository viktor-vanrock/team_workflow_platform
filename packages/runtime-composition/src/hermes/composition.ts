import {
  type AgentSkillExecutor,
  DurableAgentRunExecutor,
  InMemoryDurableAgentRunPort,
} from "./agent-run-worker.ts";
import { createQaIntakeSkillExecutors, type QaIntakeSubjectLoader } from "./intake-assistance.ts";
import {
  createQaAutomationReviewPacketExecutor,
  type QaAutomationReviewPacketLoader,
  qaAutomationReviewPacketSkillKey,
} from "./qa-automation-review-packet.ts";
import {
  qaSkillDefinitionsWithAutomationReviewPacket,
  qaSkillDefinitionsWithQueueTriage,
} from "./qa-proposal-skill-contribution.ts";
import { createHermesSkillRegistry } from "./skill-registry.ts";
import { createHermesWorkerContribution, createHermesWorkerStep } from "./worker-steps.ts";

export function createHermesComposition(
  executors: ReadonlyMap<string, AgentSkillExecutor> = new Map(),
  intakeLoader?: QaIntakeSubjectLoader,
  automationReviewLoader?: QaAutomationReviewPacketLoader,
) {
  const registry = createHermesSkillRegistry(
    automationReviewLoader
      ? qaSkillDefinitionsWithAutomationReviewPacket()
      : qaSkillDefinitionsWithQueueTriage(),
  );
  const runs = new InMemoryDurableAgentRunPort();
  const selected = new Map(executors);
  if (intakeLoader)
    for (const [key, value] of createQaIntakeSkillExecutors(intakeLoader)) selected.set(key, value);
  if (automationReviewLoader)
    selected.set(
      qaAutomationReviewPacketSkillKey,
      createQaAutomationReviewPacketExecutor(automationReviewLoader),
    );
  const executor = new DurableAgentRunExecutor(runs, selected);
  return Object.freeze({
    registry,
    runs,
    executor,
    workerContribution: createHermesWorkerContribution(executor),
    workerStep: createHermesWorkerStep(executor),
  });
}

export const qaProposalSkillKeys = Object.freeze([
  "qa-work-item-readiness@1.0.0",
  "qa-triage@1.0.0",
  "qa-triage@1.1.0",
  "qa-session-plan@1.0.0",
  "qa-result-review-prep@1.0.0",
  "qa-defect-draft@1.0.0",
  "qa-dod-check@1.0.0",
] as const);

export const qaNotifySkillKey = "qa-notify@1.0.0" as const;
