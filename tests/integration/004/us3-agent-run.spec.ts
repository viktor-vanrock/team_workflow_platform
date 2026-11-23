import { describe, expect, it } from "vitest";

import { AgentRunAggregate, deriveAgentGrants } from "../../../packages/platform-core/src/index.ts";
import { InMemoryAgentRuntimeRepository } from "../../../packages/platform-persistence-typeorm/src/index.ts";
import {
  createHermesSkillRegistry,
  DurableAgentRunExecutor,
  InMemoryDurableAgentRunPort,
} from "../../../packages/runtime-composition/src/index.ts";

const subject = Object.freeze({
  kind: "WORK_ITEM" as const,
  id: "wi-1",
  version: 3,
  contentHash: "sha256:content",
  aggregateSnapshotHash: "sha256:snapshot",
});
const skill = createHermesSkillRegistry().resolve("qa-triage", "1.0.0");
const start = (
  requestKey = "request-1",
  humanAllowedActions: readonly string[] = ["facts.read"],
) => {
  const grants = deriveAgentGrants({
    subject,
    serviceCeiling: ["facts.read"],
    skillAllowlist: skill.actionAllowlist,
    humanAllowedActions,
    classificationCeiling: "INTERNAL",
  });
  return AgentRunAggregate.start({
    id: `run-${requestKey}`,
    workspaceId: "w",
    projectId: "p",
    requestKey,
    subject,
    humanPrincipalId: "human",
    servicePrincipalId: "service",
    grants,
    requestPayload: { skillRef: "qa-triage@1.0.0", subject, requestKey },
  });
};

describe("US3 durable Agent Run", () => {
  it("intersects HUMAN and SERVICE authorization into immutable exact-subject grants", () => {
    expect(start().snapshot().grants).toEqual([
      {
        action: "facts.read",
        effectClass: "READ_ONLY",
        subject,
        classificationCeiling: "INTERNAL",
      },
    ]);
    expect(start("none", []).snapshot().grants).toEqual([]);
  });

  it("replays equal request keys, rejects conflicts, and completes through the worker lifecycle", async () => {
    const repository = new InMemoryAgentRuntimeRepository();
    const aggregate = start();
    expect(repository.create(aggregate.snapshot()).replayed).toBe(false);
    expect(repository.create(aggregate.snapshot()).replayed).toBe(true);
    const conflicting = AgentRunAggregate.start({
      ...aggregate.snapshot(),
      id: "run-conflict",
      requestPayload: { changed: true },
    });
    expect(() => repository.create(conflicting.snapshot())).toThrow(
      "AGENT_RUN_IDEMPOTENCY_CONFLICT",
    );
    const runs = new InMemoryDurableAgentRunPort();
    runs.enqueue(start("worker").snapshot(), skill);
    const worker = new DurableAgentRunExecutor(
      runs,
      new Map([
        [
          "qa-triage",
          { execute: async () => ({ result: { schemaVersion: "triage-assessment@1.0.0" } }) },
        ],
      ]),
    );
    expect(await worker.runOne()).toBe(1);
    expect(runs.get("run-worker")?.status).toBe("COMPLETED");
  });
});
