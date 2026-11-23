import { describe, expect, it } from "vitest";

import { AuthorizedProjectQueryToken } from "../../../../packages/platform-core/src/project-onboarding/query-ports.ts";
import { InMemoryProjectSearchIndex } from "../../../../packages/runtime-composition/src/onboarding/project-search.ts";
import { onboardingFixture } from "../../../support/007-onboarding-fixture.ts";

const documents = [
  {
    workspaceId: onboardingFixture.workspaceId,
    projectId: onboardingFixture.projectA,
    projectName: "Project A",
    classificationRank: 10,
    workItemIds: ["a-1"],
    queueEntryIds: ["qa"],
  },
  {
    workspaceId: onboardingFixture.workspaceId,
    projectId: onboardingFixture.projectB,
    projectName: "Project B",
    classificationRank: 20,
    workItemIds: ["b-1"],
    queueEntryIds: ["qb"],
  },
  {
    workspaceId: onboardingFixture.workspaceId,
    projectId: onboardingFixture.forbiddenProjectC,
    projectName: "Secret C",
    classificationRank: 10,
    workItemIds: ["c-1"],
    queueEntryIds: ["qc"],
  },
] as const;
const token = AuthorizedProjectQueryToken.issue({
  workspaceId: onboardingFixture.workspaceId,
  principalId: onboardingFixture.qaLeadId,
  permission: "project.read",
  projects: [
    {
      projectId: onboardingFixture.projectA,
      classificationCeilingRank: 10,
      operationalState: "ACTIVE",
      entitlementRef: { id: "a", version: 1 },
    },
    {
      projectId: onboardingFixture.projectB,
      classificationCeilingRank: 20,
      operationalState: "ACTIVE",
      entitlementRef: { id: "b", version: 1 },
    },
  ],
  issuedAt: onboardingFixture.now,
});

describe("Feature 007 US3 read-surface isolation", () => {
  it("uses identical authorized scope for catalog, direct URL, Work Item, queue and search", () => {
    const index = new InMemoryProjectSearchIndex(documents);
    expect(index.catalog(token).map(({ projectId }) => projectId)).toEqual([
      onboardingFixture.projectA,
      onboardingFixture.projectB,
    ]);
    expect(index.onboarding(token, onboardingFixture.forbiddenProjectC)).toEqual(
      index.onboarding(token, "missing-project"),
    );
    expect(index.workItem(token, onboardingFixture.forbiddenProjectC, "c-1")).toEqual(
      index.workItem(token, "missing-project", "none"),
    );
    expect(index.queue(token).map(({ projectId }) => projectId)).toEqual([
      onboardingFixture.projectA,
      onboardingFixture.projectB,
    ]);
    expect(index.search(token, "Project", 10).items.map(({ projectId }) => projectId)).toEqual([
      onboardingFixture.projectA,
      onboardingFixture.projectB,
    ]);
  });
});
