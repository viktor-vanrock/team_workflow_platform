import { describe, expect, it } from "vitest";

import { InMemoryMockOperationalRepository } from "../../../apps/mock-hub/src/operational/operational.repository.ts";

describe("request.transition(READY) conformance", () => {
  it("is exactly-once by effect key and rejects expected-version drift", async () => {
    const repository = new InMemoryMockOperationalRepository();
    await repository.createRequest({
      effectIdempotencyKey: "create-a",
      requestHash: "sha256:create",
      observedAt: "2026-08-30T10:00:00.000Z",
      request: {
        workspaceId: "w",
        projectId: "p",
        authorityScopeKey: "qa",
        naturalKey: "request-a",
        sourceDraftId: "draft-a",
        requestKind: "smoke",
        summary: "Smoke",
        dataClassificationKey: "INTERNAL",
        profileRef: { id: "profile", version: 2 },
      },
    });
    const first = await repository.transitionRequest({
      effectIdempotencyKey: "ready-a",
      requestHash: "sha256:ready",
      workspaceId: "w",
      projectId: "p",
      externalEntityId: "REQ-request-a",
      expectedExternalVersion: "1",
      requestedNormalizedStatus: "READY",
      profileRef: { id: "profile", version: 2 },
      observedAt: "2026-08-30T10:01:00.000Z",
    });
    const replay = await repository.transitionRequest({
      effectIdempotencyKey: "ready-a",
      requestHash: "sha256:ready",
      workspaceId: "w",
      projectId: "p",
      externalEntityId: "REQ-request-a",
      expectedExternalVersion: "1",
      requestedNormalizedStatus: "READY",
      profileRef: { id: "profile", version: 2 },
      observedAt: "2026-08-30T10:02:00.000Z",
    });
    expect(first.effect.result).toEqual(replay.effect.result);
    expect(first.request).toMatchObject({ externalVersion: "2", normalizedStatus: "READY" });
    expect(await repository.effectCount()).toBe(2);
    await expect(
      repository.transitionRequest({
        effectIdempotencyKey: "ready-b",
        requestHash: "sha256:ready-b",
        workspaceId: "w",
        projectId: "p",
        externalEntityId: "REQ-request-a",
        expectedExternalVersion: "1",
        requestedNormalizedStatus: "READY",
        profileRef: { id: "profile", version: 2 },
        observedAt: "2026-08-30T10:03:00.000Z",
      }),
    ).rejects.toThrow("EXPECTED_STATE_CONFLICT");
  });
});
