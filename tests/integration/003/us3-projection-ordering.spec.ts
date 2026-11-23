import { describe, expect, it } from "vitest";

import {
  type CompleteOperationalObservation,
  reduceOperationalProjection,
} from "../../../packages/platform-core/src/work-management/operational-projection.ts";

const base = {
  observationId: "o1",
  source: "RECONCILIATION_READ",
  externalEntityId: "1",
  externalDisplayKey: "Q-1",
  externalRevisionToken: "r1",
  authorityFieldsHash: "h1",
  providerUpdatedAt: "2026-08-31T00:00:00Z",
  observedAt: "2026-08-31T00:00:01Z",
  rawStatus: { id: "1", name: "Open" },
  normalizedStatus: "NEW",
  requester: { externalPrincipalId: "a" },
  profileRef: { id: "p", version: 1 },
  mappingRef: { id: "m", version: 1 },
  connectionRef: { id: "c", version: 1 },
  adapterFamily: "cloud",
  adapterContractVersion: "1",
} as CompleteOperationalObservation;
describe("US3 projection ordering", () => {
  it("dedupes, rejects stale and detects same-token/different-hash gaps", () => {
    const current = reduceOperationalProjection(undefined, base).projection!;
    expect(reduceOperationalProjection(current, base).disposition).toBe("DUPLICATE");
    expect(
      reduceOperationalProjection(current, {
        ...base,
        observationId: "o2",
        authorityFieldsHash: "h2",
      }).disposition,
    ).toBe("GAP_REQUIRES_RECONCILIATION");
    expect(
      reduceOperationalProjection(current, {
        ...base,
        observationId: "o3",
        externalRevisionToken: "r0",
        providerUpdatedAt: "2026-08-30T00:00:00Z",
      }).disposition,
    ).toBe("STALE_IGNORED");
  });
});
