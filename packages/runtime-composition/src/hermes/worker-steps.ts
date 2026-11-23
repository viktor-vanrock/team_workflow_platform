import { defineWorkerContribution, type NamedWorkerContribution } from "../worker/contributions.ts";
import type { DurableAgentRunExecutor } from "./agent-run-worker.ts";

export function createHermesWorkerContribution(
  executor: DurableAgentRunExecutor,
): NamedWorkerContribution {
  return defineWorkerContribution({
    key: "hermes-agent-runs",
    capabilityKeys: Object.freeze(["agent.run"]),
    recovery: Object.freeze({ markedEffectPolicy: "SAFE_RETRY" }),
    handle: async () => await executor.runOne(),
  });
}

export function createHermesWorkerStep(executor: DurableAgentRunExecutor) {
  return Object.freeze({ run: async () => await executor.runOne() });
}
