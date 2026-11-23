import assert from "node:assert/strict";

import { describe, expect, it } from "vitest";

import { IntakeCandidateAggregate } from "../../packages/platform-core/src/index.ts";
import {
  createCandidateActionSet,
  JiraCandidateDiscovery,
} from "../../packages/runtime-composition/src/index.ts";

describe("US2 candidate decision journey", () =>
  it("discovers, presents and converts only to a Draft", async () => {
    let aggregate: IntakeCandidateAggregate | undefined;
    const discovery = new JiraCandidateDiscovery(
      {
        discoverOrObserve: async (input) => {
          aggregate = IntakeCandidateAggregate.discover({
            id: input.id,
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            deduplicationKey: input.deduplicationKey,
            currentSourceFingerprint: input.sourceFingerprint,
            expiresAt: input.expiresAt,
          });
          return aggregate.snapshot();
        },
      },
      { issueTypes: ["Bug"], statuses: ["Open"], labelsAny: ["qa-intake"] },
    );
    const observed = await discovery.discover({
      workspaceId: "w",
      projectId: "p",
      connectionId: "jira",
      externalEntityId: "I-1",
      externalVersion: "1",
      title: "Checkout",
      issueType: "Bug",
      status: "Open",
      labels: ["qa-intake"],
      classificationKey: "INTERNAL",
      observedAt: new Date("2026-09-01"),
    });
    expect(observed.status).toBe("OBSERVED");
    assert(observed.status === "OBSERVED");
    const actions = await createCandidateActionSet({
      workspaceId: "w",
      projectId: "p",
      candidateId: observed.candidateId!,
      candidateVersion: 1,
      sourceObservationVersion: 1,
      principalId: "u",
      target: { kind: "PRINCIPAL_DM", principalId: "u" },
      expiresAt: new Date("2026-09-02"),
      issuer: { issue: async () => {} },
    });
    expect(actions.actions).toHaveLength(3);
    expect(
      aggregate!.decide("HUMAN", "CREATE", new Date("2026-09-01"), 1, {
        expectedSourceObservationVersion: 1,
        convertedDraftId: "draft",
      }),
    ).toMatchObject({ state: "CONVERTED", convertedDraftId: "draft" });
    expect(aggregate!.snapshot()).not.toHaveProperty("workItemId");
  }));
