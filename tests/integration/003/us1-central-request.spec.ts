import assert from "node:assert/strict";

import { describe, expect, it } from "vitest";

import { JiraRequestCreateService } from "../../../packages/connector-jira/src/operational/request-create.ts";

describe("US1 confirmed central request", () => {
  it("creates only after proven absence and confirms from authoritative read-back", async () => {
    let creates = 0;
    const service = new JiraRequestCreateService({
      lookup: async () => ({ state: "PROVEN_ABSENT" }),
      create: async () => {
        creates++;
        return { externalEntityId: "10001" };
      },
      observe: async (id) => ({
        externalEntityId: id,
        externalDisplayKey: "QAC-1",
        externalRevisionToken: "r1",
        authorityFieldsHash: "sha256:observed",
      }),
    });
    const result = await service.execute({
      effectMarker: "effect-1",
      fields: { summary: "Request" },
      subEffects: [],
    });
    expect(result).toMatchObject({ status: "CONFIRMED", externalEntityId: "10001", created: true });
    assert(result.status === "CONFIRMED");
    expect(result.observation.authorityFieldsHash).toBe("sha256:observed");
    expect(creates).toBe(1);
  });
});
