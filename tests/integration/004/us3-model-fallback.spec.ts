import { describe, expect, it } from "vitest";

import { AgentRunAggregate } from "../../../packages/platform-core/src/index.ts";
import {
  createHermesSkillRegistry,
  DeterministicFakeProposalModel,
  ProposalAgentRunExecutor,
} from "../../../packages/runtime-composition/src/index.ts";

describe("US3 proposal fallback completion", () => {
  it("persists typed fallback output and records FALLBACK_COMPLETED", async () => {
    const skill = createHermesSkillRegistry().resolve("qa-triage", "1.0.0");
    const subject = {
      kind: "WORK_ITEM" as const,
      id: "wi",
      version: 1,
      contentHash: "sha256:wi",
      aggregateSnapshotHash: "sha256:snapshot",
    };
    const run = AgentRunAggregate.start({
      id: "run",
      workspaceId: "w",
      projectId: "p",
      requestKey: "key",
      subject,
      humanPrincipalId: "human",
      servicePrincipalId: "service",
      grants: [],
      requestPayload: { skill: "qa-triage" },
    });
    run.begin();
    const model = new DeterministicFakeProposalModel("TIMEOUT");
    const executor = new ProposalAgentRunExecutor({
      build: async () => ({ manifest: {}, fallback: { schemaVersion: "triage-assessment@1.0.0" } }),
      model: async (manifest) => await model.propose(manifest),
      validate: (value) => Boolean(value && typeof value === "object" && "schemaVersion" in value),
      persist: async (value) => value,
      fallbackAllowed: true,
    });
    const result = await executor.execute({ run: run.snapshot(), skill });
    run.complete(result.result, result.fallback);
    expect(run.snapshot()).toMatchObject({
      status: "FALLBACK_COMPLETED",
      result: { schemaVersion: "triage-assessment@1.0.0" },
    });
  });
});
