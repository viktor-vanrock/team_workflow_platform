import { describe, expect, it } from "vitest";

import {
  editPlannedSessionStructure,
  prepareTestSession,
  startPreparedTestSession,
} from "../../packages/competency-qa/src/domain/test-session.ts";
import { createSessionFixture } from "../support/002-session-fixture.ts";

const actor = {
  kind: "HUMAN" as const,
  principalId: "executor",
  issuer: "fake-idp",
  subject: "executor",
};
describe("atomic structural edit versus start", () => {
  it("edit-first resets READY and start-first locks structure", () => {
    const ready = prepareTestSession(createSessionFixture({ id: "s1", ordinal: 1 }), {
      actor,
      at: "2026-08-30T10:01:00.000Z",
      expectedResourceVersion: 1,
    });
    const edited = editPlannedSessionStructure(ready, {
      actor,
      at: "2026-08-30T10:02:00.000Z",
      reason: "Change owner",
      expectedResourceVersion: 2,
      ownerId: "other",
    });
    expect(() =>
      startPreparedTestSession(edited, {
        actor,
        at: "2026-08-30T10:03:00.000Z",
        expectedResourceVersion: 3,
        confirmedOperationalReady: true,
      }),
    ).toThrow("QA_SESSION_NOT_READY");
    const running = startPreparedTestSession(ready, {
      actor,
      at: "2026-08-30T10:02:00.000Z",
      expectedResourceVersion: 2,
      confirmedOperationalReady: true,
    });
    expect(() =>
      editPlannedSessionStructure(running, {
        actor,
        at: "2026-08-30T10:03:00.000Z",
        reason: "Change owner",
        expectedResourceVersion: 3,
        ownerId: "other",
      }),
    ).toThrow("SESSION_SNAPSHOT_LOCKED");
  });
});
