import { describe, expect, it } from "vitest";

import { AgentRunAggregate } from "../../../packages/platform-core/src/index.ts";

describe("Agent runtime", () =>
  it("pins exact subject/grants and detects request-key conflicts", () => {
    const subject = {
      kind: "CANDIDATE" as const,
      id: "c",
      version: 1,
      contentHash: "h",
      aggregateSnapshotHash: "a",
    };
    const run = AgentRunAggregate.start({
      id: "r",
      workspaceId: "w",
      projectId: "p",
      requestKey: "k",
      requestPayload: { x: 1 },
      subject,
      humanPrincipalId: "u",
      servicePrincipalId: "s",
      grants: [],
    });
    expect(() => run.assertReplay("k", { x: 2 })).toThrow(/CONFLICT/u);
    expect(run.snapshot().grantSetHash).toMatch(/^sha256:/u);
  }));
