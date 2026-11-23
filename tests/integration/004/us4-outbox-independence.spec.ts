import { describe, expect, it } from "vitest";

import { NotificationProjection } from "../../../packages/runtime-composition/src/index.ts";

describe("US4 source/outbox independence", () => {
  it("deduplicates by committed source fingerprint without rewriting source state", () => {
    let sourceVersion = 7;
    const projection = new NotificationProjection();
    const request = {
      id: "n",
      workspaceId: "w",
      projectId: "p",
      sourceEventRef: "event:7",
      sourceEventFingerprint: "sha256:event-7",
      target: { kind: "PRINCIPAL_DM" as const, principalId: "person" },
      payload: { status: "READY" },
      render: "qa.ready@1",
      commandId: "command",
      actionIntentIds: [] as string[],
      expiresAt: new Date("2026-09-03"),
      allowed: true,
    };
    const first = projection.project(request);
    sourceVersion += 1;
    const replay = projection.project({ ...request, id: "other" });
    expect(replay).toEqual(first);
    expect(sourceVersion).toBe(8);
    expect(first).toMatchObject({
      denied: false,
      sourceFingerprintHash: expect.stringMatching(/^sha256:/u),
      deliveryHealthEventRef: "notification-health:n:queued",
    });
  });
  it("commits an audited zero-effect denial", () =>
    expect(
      new NotificationProjection().project({
        id: "denied",
        workspaceId: "w",
        projectId: "p",
        sourceEventRef: "event",
        sourceEventFingerprint: "fingerprint",
        target: { kind: "PRINCIPAL_DM", principalId: "person" },
        payload: {},
        render: "template",
        commandId: "command",
        actionIntentIds: [],
        expiresAt: new Date("2026-09-03"),
        allowed: false,
      }),
    ).toMatchObject({
      denied: true,
      actionIntentIds: [],
      reasonCode: "NOTIFICATION_POLICY_DENIED",
    }));
});
