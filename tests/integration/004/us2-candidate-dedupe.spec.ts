import { describe, expect, it } from "vitest";

import { IntakeCandidateAggregate } from "../../../packages/platform-core/src/index.ts";

describe("US2 candidate dedupe", () =>
  it("makes identical fingerprints a no-op and appends changed versions", () => {
    const value = IntakeCandidateAggregate.discover({
      id: "c",
      workspaceId: "w",
      projectId: "p",
      deduplicationKey: "key",
      currentSourceFingerprint: "v1",
      expiresAt: new Date("2026-09-03"),
    });
    expect(value.observe("v1", 1)).toEqual({ appended: false, version: 1 });
    expect(value.observe("v2", 1)).toEqual({ appended: true, version: 2 });
    expect(value.snapshot()).toMatchObject({
      currentSourceObservationVersion: 2,
      currentSourceFingerprint: "v2",
      rowVersion: 2,
    });
  }));
