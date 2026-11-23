import { describe, expect, it } from "vitest";

import {
  deriveProjectionFreshness,
  reduceOperationalProjection,
} from "../../../packages/platform-core/src/index.ts";

const observation = (token: string, hash: string, updatedAt: string) => ({
  observationId: `${token}:${hash}`,
  source: "RECONCILIATION_READ" as const,
  externalEntityId: "10001",
  externalDisplayKey: "QAC-1",
  externalRevisionToken: token,
  authorityFieldsHash: hash,
  providerUpdatedAt: updatedAt,
  observedAt: updatedAt,
  rawStatus: { id: "1", name: "Open" },
  normalizedStatus: "NEW" as const,
  requester: { externalPrincipalId: "u1" },
  profileRef: { id: "p", version: 1 },
  mappingRef: { id: "m", version: 1 },
  connectionRef: { id: "c", version: 1 },
  adapterFamily: "jira-cloud-v3",
  adapterContractVersion: "1.0.0",
});

describe("monotonic projection and conflict lifecycle", () => {
  it("applies newer, ignores older and rejects same token with another hash", () => {
    const first = reduceOperationalProjection(
      undefined,
      observation("t1", "sha256:a", "2026-01-01T00:00:00Z"),
    );
    expect(first.disposition).toBe("APPLIED");
    expect(
      reduceOperationalProjection(
        first.projection,
        observation("t0", "sha256:z", "2025-12-31T00:00:00Z"),
      ).disposition,
    ).toBe("STALE_IGNORED");
    expect(
      reduceOperationalProjection(
        first.projection,
        observation("t1", "sha256:b", "2026-01-01T00:00:00Z"),
      ).disposition,
    ).toBe("GAP_REQUIRES_RECONCILIATION");
  });

  it("derives freshness without a projection revision", () => {
    expect(
      deriveProjectionFreshness(
        new Date("2026-01-01T00:00:00Z"),
        120,
        new Date("2026-01-01T00:01:00Z"),
      ),
    ).toBe("CURRENT");
    expect(
      deriveProjectionFreshness(
        new Date("2026-01-01T00:00:00Z"),
        120,
        new Date("2026-01-01T00:03:00Z"),
      ),
    ).toBe("STALE");
  });
});
