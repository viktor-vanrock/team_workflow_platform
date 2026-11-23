import { describe, expect, it } from "vitest";

import { MattermostPresentationLease } from "../../../../packages/connector-mattermost/src/index.ts";
import { MattermostPresentationExpirySweeper } from "../../../../packages/runtime-composition/src/index.ts";

describe("US4 capsule purge", () => {
  it("leases exact bytes once and destroys the recoverable buffer", () => {
    const lease = new MattermostPresentationLease(new Uint8Array([1, 2, 3]));
    const bytes = lease.acquire();
    expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(() => lease.acquire()).toThrow("MATTERMOST_PRESENTATION_LEASE_CONSUMED");
    lease.purge();
    expect(bytes).toEqual(new Uint8Array([0, 0, 0]));
  });
  it("sweeps bounded expired material fail-closed across restart", async () => {
    const purged: string[] = [];
    const items = [
      { intentId: "a", retainUntil: new Date("2026-09-01"), state: "EXPIRED" },
      { intentId: "b", retainUntil: new Date("2026-09-01"), state: "INVALIDATED" },
    ];
    const port = {
      listExpired: async () => items,
      purge: async (id: string) => {
        purged.push(id);
      },
    };
    expect(await new MattermostPresentationExpirySweeper(port).run(new Date("2026-09-02"), 2)).toBe(
      2,
    );
    expect(purged).toEqual(["a", "b"]);
  });
});
