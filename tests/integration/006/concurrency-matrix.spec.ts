import { describe, expect, it } from "vitest";

import { runQueueScenario } from "../../../tools/local/queue-scenario.mts";

describe("Feature 006 aggregate concurrency matrix", () => {
  it("covers admission, reservation, override, EXPEDITE and order-move races under one closed outcome vocabulary", async () => {
    const ids = [
      "us4-concurrent-last-slot",
      "us4-concurrent-review-reservation",
      "us4-exact-wip-override",
      "us4-stale-or-self-approved-override-denied",
      "us4-concurrent-expedite-singleton",
      "us4-expedite-clear-and-expiry-lock",
      "us3-exact-lead-order-override",
      "us3-order-hidden-anchor-terminal-no-op",
    ] as const;
    const results = await Promise.all(
      ids.map(async (id) => await runQueueScenario(id, { mode: "TEST" })),
    );
    expect(results.map(({ id, status }) => [id, status])).toEqual(ids.map((id) => [id, "PASS"]));
    expect(results.find(({ id }) => id === "us4-concurrent-last-slot")?.evidence).toMatchObject({
      isolation: "SERIALIZABLE",
      contenders: 2,
      admitted: 1,
      denied: 1,
    });
    expect(
      results.find(({ id }) => id === "us4-concurrent-review-reservation")?.evidence,
    ).toMatchObject({ committedUnits: 1, deliveryAuthority: "POSTGRESQL" });
    expect(
      results.find(({ id }) => id === "us4-concurrent-expedite-singleton")?.evidence,
    ).toMatchObject({ expediteWinners: 1, capacityFirstLock: true });
    expect(
      results.find(({ id }) => id === "us3-order-hidden-anchor-terminal-no-op")?.evidence,
    ).toMatchObject({ applicationState: "ANCHOR_UNAVAILABLE_NO_OP", approvalCreated: false });
  });
});
