import { describe, expect, it } from "vitest";

import {
  InMemoryStageAudit,
  WriteStageAuditor,
} from "../../../../packages/platform-core/src/audit/write-stage-auditor.ts";

describe("AT-011 stage-complete audit", () => {
  it("round-trips exact bases/refs/results while redacting raw payload", async () => {
    const port = new InMemoryStageAudit();
    const audit = new WriteStageAuditor(port);
    for (const stage of [
      "GATEWAY",
      "DISPATCHER",
      "WORKER",
      "BROKER",
      "CONFIRMATION",
      "WEBHOOK",
    ] as const)
      await audit.record({
        stage,
        workspaceId: "w",
        projectId: "p",
        action: "record.publish",
        initialAuthorizationBasis: { skillContext: "NOT_APPLICABLE", version: 1 },
        effectAuthorizationBasis: { skillContext: "NOT_APPLICABLE", version: 2 },
        bindingRef: { id: "b", version: 1 },
        profileRef: { id: "p", version: 1 },
        resultCode: "OK",
        reasonCode: "NONE",
        attributes: { payload: "secret", commandId: "c" },
      });
    expect(port.events()).toHaveLength(6);
    expect(port.events()[0]).toMatchObject({
      initialAuthorizationBasis: { skillContext: "NOT_APPLICABLE" },
      bindingRef: { version: 1 },
      resultCode: "OK",
    });
    expect(JSON.stringify(port.events())).not.toContain("secret");
    await expect(port.update("missing", {})).rejects.toThrow("AUDIT_APPEND_ONLY");
  });
});
