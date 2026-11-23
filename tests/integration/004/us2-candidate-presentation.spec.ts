import { describe, expect, it, vi } from "vitest";

import { createCandidateActionSet } from "../../../packages/runtime-composition/src/index.ts";

describe("US2 candidate presentation", () =>
  it("creates one ordered post with three separately identified intents", async () => {
    const issue = vi.fn(async () => {});
    const result = await createCandidateActionSet({
      workspaceId: "w",
      projectId: "p",
      candidateId: "c",
      candidateVersion: 2,
      sourceObservationVersion: 3,
      principalId: "u",
      target: { kind: "PRINCIPAL_DM", principalId: "u" },
      expiresAt: new Date("2026-09-02"),
      issuer: { issue },
    });
    expect(result.actions.map(({ actionKind }) => actionKind)).toEqual([
      "CANDIDATE_CREATE",
      "CANDIDATE_SNOOZE",
      "CANDIDATE_IGNORE",
    ]);
    expect(new Set(result.actions.map(({ id }) => id)).size).toBe(3);
    expect(issue).toHaveBeenCalledTimes(3);
  }));
