import { describe, expect, it } from "vitest";

import {
  acceptSessionPlanProposal,
  QaSessionPlanProposalAggregate,
} from "../../../packages/competency-qa/src/index.ts";

const proposal = () =>
  QaSessionPlanProposalAggregate.create({
    id: "plan",
    workspaceId: "w",
    projectId: "p",
    subject: { kind: "WORK_ITEM", id: "wi", version: 2, contentHash: "sha256:wi" },
    revision: 1,
    content: {
      sessionSlices: [{ mode: "MANUAL", goal: "review" }],
      facts: [{ sourceRef: "wi", sourceVersion: "2", contentHash: "sha256:wi" }],
    },
    expiresAt: new Date("2026-09-03"),
  }).snapshot();

describe("US3 SessionPlanProposal", () => {
  it("is WORK_ITEM-only and never mutates an accepted Session", () => {
    expect(proposal()).not.toHaveProperty("sessionId");
    expect(() =>
      QaSessionPlanProposalAggregate.create({
        ...proposal(),
        subject: { kind: "DRAFT", id: "d", version: 1, contentHash: "sha256:d" },
      } as never),
    ).toThrow("SESSION_PLAN_WORK_ITEM_REQUIRED");
  });

  it("keeps acceptance behind an exact HUMAN boundary", () => {
    const current = proposal();
    expect(() =>
      acceptSessionPlanProposal(current, {
        actorKind: "SERVICE",
        actorId: "worker",
        acceptedPlanRef: "plan:accepted",
        currentFactSetHash: current.sourceFactSetHash,
        now: new Date("2026-09-01"),
      }),
    ).toThrow("SESSION_PLAN_ACCEPT_HUMAN_REQUIRED");
    expect(
      acceptSessionPlanProposal(current, {
        actorKind: "HUMAN",
        actorId: "person",
        acceptedPlanRef: "plan:accepted",
        currentFactSetHash: current.sourceFactSetHash,
        now: new Date("2026-09-01"),
      }),
    ).toMatchObject({ state: "ACCEPTED", acceptedBy: "person" });
  });
});
