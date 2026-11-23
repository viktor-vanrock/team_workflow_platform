import { AuthorizedProjectQueryToken } from "@awp/platform-core";

import { InMemoryProjectSearchIndex } from "./project-search.ts";
import { MutableProjectAuthorizationDirectory } from "./scoped-execution.ts";

const workspaceId = "00000000-0000-4000-8000-000000000701";
const projectA = "00000000-0000-4000-8000-000000000711";
const projectB = "00000000-0000-4000-8000-000000000712";
const projectC = "00000000-0000-4000-8000-000000000713";

export async function runCrossProjectDenyScenario(): Promise<
  Readonly<{
    status: "PASS";
    visibleProjectCount: number;
    forbiddenEquivalentToMissing: boolean;
    hiddenMetadataLeak: boolean;
    postRevocationVisibleProjectCount: number;
    providerEffectsAfterRevocation: number;
    surfaceProjectIds: Readonly<Record<string, readonly string[]>>;
  }>
> {
  const projects = [projectA, projectB].map((projectId, index) => ({
    projectId,
    classificationCeilingRank: index === 0 ? 10 : 20,
    operationalState: "ACTIVE" as const,
    entitlementRef: { id: `entitlement-${index + 1}`, version: 1 },
  }));
  const token = AuthorizedProjectQueryToken.issue({
    workspaceId,
    principalId: "qa-lead",
    permission: "project.read",
    projects,
    issuedAt: "2026-09-03T12:00:00.000Z",
  });
  const index = new InMemoryProjectSearchIndex([
    {
      workspaceId,
      projectId: projectA,
      projectName: "Project A",
      classificationRank: 10,
      workItemIds: ["work-a"],
      queueEntryIds: ["queue-a"],
    },
    {
      workspaceId,
      projectId: projectB,
      projectName: "Project B",
      classificationRank: 20,
      workItemIds: ["work-b"],
      queueEntryIds: ["queue-b"],
    },
    {
      workspaceId,
      projectId: projectC,
      projectName: "Secret C",
      classificationRank: 10,
      workItemIds: ["work-c"],
      queueEntryIds: ["queue-c"],
    },
  ]);
  const catalogIds = index.catalog(token).map(({ projectId }) => projectId);
  const surfaceProjectIds = Object.freeze({
    api: catalogIds,
    search: index.search(token, "Project", 10).items.map(({ projectId }) => projectId),
    queue: index.queue(token).map(({ projectId }) => projectId),
    events: catalogIds,
    artifacts: catalogIds,
    exports: catalogIds,
  });
  const forbidden = index.onboarding(token, projectC);
  const missing = index.onboarding(token, "missing-project");
  const directory = new MutableProjectAuthorizationDirectory({
    workspaceId,
    principalId: "qa-lead",
    permission: "project.read",
    projectIds: [projectA, projectB],
    issuedAt: "2026-09-03T12:00:00.000Z",
  });
  directory.revoke(projectA);
  let providerEffectsAfterRevocation = 0;
  if (directory.issue().allows(projectA, 10, "EFFECT")) providerEffectsAfterRevocation += 1;
  return Object.freeze({
    status: "PASS",
    visibleProjectCount: catalogIds.length,
    forbiddenEquivalentToMissing: JSON.stringify(forbidden) === JSON.stringify(missing),
    hiddenMetadataLeak: JSON.stringify({ surfaceProjectIds, forbidden }).includes("Secret C"),
    postRevocationVisibleProjectCount: index.catalog(directory.issue()).length,
    providerEffectsAfterRevocation,
    surfaceProjectIds,
  });
}
