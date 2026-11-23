import { describe, expect, it, vi } from "vitest";

import { AuthorizedProjectQueryToken } from "../../../../packages/platform-core/src/project-onboarding/query-ports.ts";
import { TypeOrmOperationalAuthorityRepository } from "../../../../packages/platform-persistence-typeorm/src/operational-authority.repository.ts";
import { ProjectOnboardingRepository } from "../../../../packages/platform-persistence-typeorm/src/project-onboarding.repository.ts";
import { QueueProjectionRepository } from "../../../../packages/platform-persistence-typeorm/src/queue-projection.repository.ts";
import { TypeOrmWorkManagementRepository } from "../../../../packages/platform-persistence-typeorm/src/work-management.repository.ts";
import { onboardingFixture } from "../../../support/007-onboarding-fixture.ts";

const token = () =>
  AuthorizedProjectQueryToken.issue({
    workspaceId: onboardingFixture.workspaceId,
    principalId: onboardingFixture.qaLeadId,
    permission: "project.read",
    projects: [
      {
        projectId: onboardingFixture.projectA,
        classificationCeilingRank: 20,
        operationalState: "ACTIVE",
        entitlementRef: { id: "entitlement-a", version: 2 },
      },
    ],
    issuedAt: onboardingFixture.now,
  });
const source = () => ({
  query: vi.fn<(sql: string) => Promise<unknown[]>>(async () => []),
  transaction: vi.fn(),
});

describe("Feature 007 US3 repository authorization prefilter", () => {
  it("rejects forbidden Project before Project catalog/detail SQL", async () => {
    const db = source();
    const repository = new ProjectOnboardingRepository(db as never);
    await expect(
      repository.authorizedOnboarding(token(), onboardingFixture.forbiddenProjectC),
    ).rejects.toThrow("PROJECT_RESOURCE_NOT_AVAILABLE");
    expect(db.query).not.toHaveBeenCalled();
    await repository.authorizedCatalog(token());
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(db.query.mock.calls[0]![0]).toMatch(/ANY\(\$2::uuid\[\]\)/u);
  });

  it("requires the token before Work Item, queue and operational authority lookup", async () => {
    for (const call of [
      async (db: ReturnType<typeof source>) =>
        new TypeOrmWorkManagementRepository(db as never).getWorkItemAuthorized(
          token(),
          onboardingFixture.forbiddenProjectC,
          "work",
        ),
      async (db: ReturnType<typeof source>) =>
        new QueueProjectionRepository(db as never).currentRevisionAuthorized(
          token(),
          onboardingFixture.forbiddenProjectC,
          "queue",
        ),
      async (db: ReturnType<typeof source>) =>
        new TypeOrmOperationalAuthorityRepository(
          db as never,
        ).confirmedProjectionForWorkItemAuthorized(
          token(),
          onboardingFixture.forbiddenProjectC,
          "work",
        ),
    ]) {
      const db = source();
      await expect(call(db)).rejects.toThrow("PROJECT_RESOURCE_NOT_AVAILABLE");
      expect(db.query).not.toHaveBeenCalled();
    }
  });
});
