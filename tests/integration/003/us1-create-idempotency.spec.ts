import assert from "node:assert/strict";

import { describe, expect, it } from "vitest";

import { JiraRequestCreateService } from "../../../packages/connector-jira/src/operational/request-create.ts";

describe("US1 create idempotency", () => {
  it("serializes concurrent workers and adopts one exact marker effect", async () => {
    let issue: string | undefined;
    let creates = 0;
    const port = {
      lookup: async () =>
        issue
          ? ({ state: "FOUND", externalEntityId: issue } as const)
          : ({ state: "PROVEN_ABSENT" } as const),
      create: async () => {
        creates++;
        issue = "10001";
        return { externalEntityId: issue };
      },
      observe: async (id: string) => ({
        externalEntityId: id,
        externalDisplayKey: "QAC-1",
        externalRevisionToken: "r1",
        authorityFieldsHash: "sha256:a",
      }),
    };
    const service = new JiraRequestCreateService(port);
    const [left, right] = await Promise.all([
      service.execute({ effectMarker: "same", fields: {}, subEffects: [] }),
      service.execute({ effectMarker: "same", fields: {}, subEffects: [] }),
    ]);
    assert(left.status === "CONFIRMED" && right.status === "CONFIRMED");
    expect(creates).toBe(1);
    expect(left.externalEntityId).toBe(right.externalEntityId);
  });
});
