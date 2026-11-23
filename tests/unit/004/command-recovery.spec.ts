import { describe, expect, it } from "vitest";

import { InMemoryDurableCommandStore } from "../../../packages/platform-core/src/index.ts";

describe("marked command recovery", () =>
  it("does not blind-requeue lookup-only effects", () => {
    const store = InMemoryDurableCommandStore.readyFixture();
    store.markDispatched(new Date("2026-09-01"), 1);
    const marked = store.command();
    const lookup = new InMemoryDurableCommandStore({
      ...marked,
      recoveryPolicy: "LOOKUP_REQUIRED",
    });
    lookup.recover(new Date("2026-09-02"));
    expect(lookup.command().status).toBe("DISPATCHED");
  }));
