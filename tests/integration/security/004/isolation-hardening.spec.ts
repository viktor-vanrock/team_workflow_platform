import { describe, expect, it } from "vitest";

import {
  AgentRunAggregate,
  deriveAgentGrants,
} from "../../../../packages/platform-core/src/index.ts";
import {
  createHermesSkillRegistry,
  QaToolGateway,
} from "../../../../packages/runtime-composition/src/index.ts";

describe("004 scope/principal/profile isolation", () => {
  it("cannot substitute workspace, project, subject, principal or classification", async () => {
    const subject = {
      kind: "WORK_ITEM" as const,
      id: "wi",
      version: 1,
      contentHash: "sha256:wi",
      aggregateSnapshotHash: "sha256:snapshot",
    };
    const skill = createHermesSkillRegistry().resolve("qa-triage", "1.0.0");
    const grants = deriveAgentGrants({
      subject,
      serviceCeiling: ["facts.read"],
      skillAllowlist: skill.actionAllowlist,
      humanAllowedActions: ["facts.read"],
      classificationCeiling: "INTERNAL",
    });
    const run = AgentRunAggregate.start({
      id: "run",
      workspaceId: "w",
      projectId: "p",
      requestKey: "key",
      subject,
      humanPrincipalId: "human",
      servicePrincipalId: "service",
      grants,
      requestPayload: { subject },
    }).snapshot();
    const gateway = new QaToolGateway(
      {
        humanAllows: async (principal, _, exact) => principal === "human" && exact.id === "wi",
        serviceAllows: async (principal) => principal === "service",
      },
      new Map([["facts.read", async () => ({ safe: true })]]),
    );
    await expect(
      gateway.invoke({ ...run, projectId: "foreign" }, "facts.read", {}),
    ).resolves.toMatchObject({ result: { safe: true } });
    await expect(
      gateway.invoke({ ...run, subject: { ...subject, id: "foreign" } }, "facts.read", {}),
    ).rejects.toThrow("AGENT_TOOL_GRANT_DENIED");
    expect(JSON.stringify(run)).not.toContain("profileSecret");
  });
});
