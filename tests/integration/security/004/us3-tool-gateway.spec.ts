import { describe, expect, it } from "vitest";

import { AgentRunAggregate } from "../../../../packages/platform-core/src/index.ts";
import { QaToolGateway } from "../../../../packages/runtime-composition/src/index.ts";

const run = (action: string, effectClass: "READ_ONLY" | "APPROVAL_REQUIRED" = "READ_ONLY") => {
  const subject = {
    kind: "WORK_ITEM" as const,
    id: "wi",
    version: 1,
    contentHash: "sha256:wi",
    aggregateSnapshotHash: "sha256:snapshot",
  };
  return AgentRunAggregate.start({
    id: "run",
    workspaceId: "w",
    projectId: "p",
    requestKey: "key",
    subject,
    humanPrincipalId: "human",
    servicePrincipalId: "service",
    grants: [{ action, effectClass, subject, classificationCeiling: "INTERNAL" }],
    requestPayload: { action },
  }).snapshot();
};

describe("US3 typed Tool Gateway", () => {
  it("requires an exact grant and reauthorizes both principals", async () => {
    const gateway = new QaToolGateway(
      { humanAllows: async () => true, serviceAllows: async () => true },
      new Map([["facts.read", async (_subject, input) => input]]),
    );
    await expect(
      gateway.invoke(run("facts.read"), "facts.read", { key: "value" }),
    ).resolves.toMatchObject({ result: { key: "value" } });
    await expect(gateway.invoke(run("facts.read"), "evidence.read", {})).rejects.toThrow(
      "AGENT_TOOL_GRANT_DENIED",
    );
    const revoked = new QaToolGateway(
      { humanAllows: async () => true, serviceAllows: async () => false },
      new Map([["facts.read", async () => ({})]]),
    );
    await expect(revoked.invoke(run("facts.read"), "facts.read", {})).rejects.toThrow(
      "AGENT_TOOL_DUAL_AUTHORIZATION_DENIED",
    );
  });

  it.each(["approval.accept", "entitlement.write", "verdict.create", "jira.create"])(
    "denies forbidden effect %s",
    async (action) => {
      const gateway = new QaToolGateway(
        { humanAllows: async () => true, serviceAllows: async () => true },
        new Map([[action, async () => ({})]]),
      );
      await expect(gateway.invoke(run(action, "APPROVAL_REQUIRED"), action, {})).rejects.toThrow(
        "AGENT_TOOL_EFFECT_DENIED",
      );
    },
  );
});
