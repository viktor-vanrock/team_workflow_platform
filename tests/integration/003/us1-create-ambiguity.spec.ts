import { describe, expect, it } from "vitest";

import { JiraRequestCreateService } from "../../../packages/connector-jira/src/operational/request-create.ts";

describe("US1 ambiguous lost response", () => {
  it("does not recreate while marker visibility is unknown or multiple", async () => {
    let creates = 0;
    const service = new JiraRequestCreateService({
      lookup: async () => ({ state: "UNKNOWN" }),
      create: async () => {
        creates++;
        return { externalEntityId: "forbidden" };
      },
      observe: async () => {
        throw new Error("forbidden");
      },
    });
    expect(await service.execute({ effectMarker: "lost-201", fields: {}, subEffects: [] })).toEqual(
      { status: "AMBIGUOUS", reasonCode: "MARKER_VISIBILITY_UNKNOWN" },
    );
    expect(creates).toBe(0);
  });
});
