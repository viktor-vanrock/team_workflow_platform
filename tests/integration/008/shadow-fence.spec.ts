import { describe, expect, it } from "vitest";

import { PilotShadowService } from "../../../packages/runtime-composition/src/pilot/shadow-service.ts";

const base = {
  observationId: "shadow-1",
  workspaceId: "workspace",
  projectId: "project",
  subjectRef: "request:1",
  proposedOutcome: "READY",
  actualOutcome: "NEEDS_INFO",
  observedAt: "2026-09-03T10:00:00.000Z",
  scopeKind: "SHADOW" as const,
};

describe("Feature 008 shadow effect fence", () => {
  it("stores differences while producing zero writes, accepted drafts or releasable notifications", () => {
    const service = new PilotShadowService();
    expect(
      service.record({
        ...base,
        requestedExternalWrites: 0,
        requestedAcceptance: "LOCAL_PROPOSAL",
      }),
    ).toMatchObject({ acceptanceState: "LOCAL_PROPOSAL", notificationState: "LOCAL_SUPPRESSED" });
    expect(service.differences()).toEqual([
      expect.objectContaining({ observationId: "shadow-1", differs: true }),
    ]);
    expect(service.externalWriteCount()).toBe(0);
    expect(service.releasableNotificationCount()).toBe(0);
    expect(() =>
      service.record({
        ...base,
        observationId: "write",
        requestedExternalWrites: 1,
        requestedAcceptance: "LOCAL_PROPOSAL",
      }),
    ).toThrow("PILOT_SHADOW_EXTERNAL_WRITE_FORBIDDEN");
    expect(() =>
      service.record({
        ...base,
        observationId: "accept",
        requestedExternalWrites: 0,
        requestedAcceptance: "ACCEPTED_WORK_ITEM",
      }),
    ).toThrow("PILOT_SHADOW_ACCEPTANCE_FORBIDDEN");
  });

  it("keeps sandbox conformance outside shadow authority", () => {
    expect(() =>
      new PilotShadowService().record({
        ...base,
        scopeKind: "SANDBOX_CONFORMANCE",
        requestedExternalWrites: 0,
        requestedAcceptance: "LOCAL_PROPOSAL",
      }),
    ).toThrow("PILOT_SHADOW_SCOPE_REQUIRED");
  });
});
