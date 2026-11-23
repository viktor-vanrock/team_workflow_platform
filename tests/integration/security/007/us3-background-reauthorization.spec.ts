import { describe, expect, it, vi } from "vitest";

import { AuthorizedProjectQueryToken } from "../../../../packages/platform-core/src/project-onboarding/query-ports.ts";
import {
  createScopedWorkEnvelope,
  executeScopedWork,
  projectScopedCacheKey,
} from "../../../../packages/runtime-composition/src/onboarding/scoped-execution.ts";
import { onboardingFixture } from "../../../support/007-onboarding-fixture.ts";

const issue = (allowed = true) =>
  AuthorizedProjectQueryToken.issue({
    workspaceId: onboardingFixture.workspaceId,
    principalId: onboardingFixture.qaLeadId,
    permission: "connector.effect",
    projects: allowed
      ? [
          {
            projectId: onboardingFixture.projectA,
            classificationCeilingRank: 10,
            operationalState: "ACTIVE",
            entitlementRef: { id: "a", version: 2 },
          },
        ]
      : [],
    issuedAt: onboardingFixture.now,
  });

describe("Feature 007 US3 background reauthorization", () => {
  it("partitions cache/outbox/job/command identities and reauthorizes immediately before effect", async () => {
    expect(
      projectScopedCacheKey(
        { workspaceId: onboardingFixture.workspaceId, projectId: onboardingFixture.projectA },
        "queue",
        "current",
      ),
    ).toContain(`${onboardingFixture.workspaceId}:${onboardingFixture.projectA}`);
    const envelope = createScopedWorkEnvelope({
      workId: "effect",
      workspaceId: onboardingFixture.workspaceId,
      projectId: onboardingFixture.projectA,
      permission: "connector.effect",
      classificationRank: 10,
      payloadHash: ("sha256:" + "a".repeat(64)) as `sha256:${string}`,
    });
    const effect = vi.fn(async () => "done");
    await expect(executeScopedWork(envelope, async () => issue(false), effect)).rejects.toThrow(
      "SCOPED_WORK_AUTHORIZATION_REVOKED",
    );
    expect(effect).not.toHaveBeenCalled();
    await expect(executeScopedWork(envelope, async () => issue(true), effect)).resolves.toBe(
      "done",
    );
    expect(effect).toHaveBeenCalledTimes(1);
  });
});
