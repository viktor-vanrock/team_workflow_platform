import assert from "node:assert/strict";

import { describe, expect, it } from "vitest";

import { JiraDefectCreateService } from "../../../packages/connector-jira/src/operational/defect-create.ts";

describe("US4 defect recovery", () => {
  it("does not recreate after a lost response and recovers partial links", async () => {
    let creates = 0;
    const service = new JiraDefectCreateService({
      lookup: async () => ({ state: "FOUND", externalEntityId: "20001" }),
      create: async () => {
        creates++;
        return { externalEntityId: "20001" };
      },
      observe: async (id) => ({
        externalEntityId: id,
        externalDisplayKey: "APP-1",
        externalRevisionToken: "r1",
        authorityFieldsHash: "h",
      }),
      applySubEffect: async (_id, effect) => `receipt:${effect.semanticIdentity}`,
    });
    const result = await service.execute({
      effectMarker: "awp:e",
      fields: { summary: "Bug" },
      subEffects: [
        { kind: "LINK", semanticIdentity: "request:1", payload: {} },
        { kind: "COMMENT", semanticIdentity: "evidence:1", payload: {} },
      ],
    });
    expect(result.status).toBe("CONFIRMED");
    assert(result.status === "CONFIRMED");
    expect(result.subEffectReceipts).toHaveLength(2);
    expect(creates).toBe(0);
  });
});
