import { describe, expect, it, vi } from "vitest";

import {
  exactQueueEntryReadToken,
  ProjectQueueQueryService,
} from "../../../../packages/runtime-composition/src/queue/portfolio-query.ts";

describe("US1 Project queue read isolation", () => {
  it("returns identical inaccessible/not-found results before any projection or provider read", async () => {
    const projection = { read: vi.fn() };
    const provider = { read: vi.fn() };
    const service = new ProjectQueueQueryService({
      authorize: vi.fn().mockResolvedValue(false),
      projection,
      provider,
    });
    await expect(
      service.item({
        workspaceId: "w1",
        projectId: "hidden",
        workItemId: "missing",
        principalId: "u1",
      }),
    ).rejects.toThrow("QUEUE_ITEM_NOT_FOUND");
    expect(projection.read).not.toHaveBeenCalled();
    expect(provider.read).not.toHaveBeenCalled();
  });

  it("serves authorized GETs only from local projections", async () => {
    const projection = {
      read: vi.fn().mockResolvedValue({ projectId: "p1", workItemId: "w1", stage: "BACKLOG" }),
    };
    const provider = { read: vi.fn() };
    const service = new ProjectQueueQueryService({
      authorize: vi.fn().mockResolvedValue(true),
      projection,
      provider,
    });
    await expect(
      service.item({ workspaceId: "w1", projectId: "p1", workItemId: "w1", principalId: "u1" }),
    ).resolves.toMatchObject({ stage: "BACKLOG" });
    expect(provider.read).not.toHaveBeenCalled();
  });

  it("exposes projection and control CAS versions as separate exact tokens", () => {
    const hash = (digit: string) => `sha256:${digit.repeat(64)}`;
    expect(
      exactQueueEntryReadToken({
        queueEntryId: "qe1",
        revision: 7,
        semanticHash: hash("a"),
        inputFingerprint: hash("b"),
        control: { state: "ACCEPTED", resourceVersion: 3 },
      }),
    ).toEqual({
      queueEntryId: "qe1",
      revision: 7,
      semanticHash: hash("a"),
      inputFingerprint: hash("b"),
      controlResourceVersion: 3,
    });
  });
});
