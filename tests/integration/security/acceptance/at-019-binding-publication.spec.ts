import { describe, expect, it } from "vitest";

import {
  BindingPublicationService,
  InMemoryPlatformActionRepository,
} from "../../../../packages/platform-core/src/approval/binding-publication-action.ts";

describe("AT-019 Binding publication action", () => {
  it("enforces separation, exact CAS, idempotent replay and drift denial", async () => {
    const repository = new InMemoryPlatformActionRepository({
      bindingId: "b",
      version: 1,
      resourceVersion: 2,
      contentHash: "sha256:candidate",
      currentPublishedVersion: 0,
    });
    const service = new BindingPublicationService(repository);
    const requested = await service.request({
      initiatorId: "integration-admin",
      initiatorRole: "INTEGRATION_ADMINISTRATOR",
      candidateRef: { id: "b", version: 1 },
      expectedResourceVersion: 2,
    });
    await expect(
      service.approve(requested.action.id, {
        approverId: "integration-admin",
        approverRole: "WORKSPACE_OWNER",
        permissions: ["project.admin"],
      }),
    ).rejects.toThrow("SELF_APPROVAL_FORBIDDEN");
    const published = await service.approve(requested.action.id, {
      approverId: "owner",
      approverRole: "WORKSPACE_OWNER",
      permissions: ["project.admin"],
    });
    expect(published.binding.state).toBe("PUBLISHED");
    expect(
      (
        await service.approve(requested.action.id, {
          approverId: "owner",
          approverRole: "WORKSPACE_OWNER",
          permissions: ["project.admin"],
        })
      ).binding,
    ).toEqual(published.binding);
    repository.driftCandidate();
    const second = await service.request({
      initiatorId: "integration-admin",
      initiatorRole: "INTEGRATION_ADMINISTRATOR",
      candidateRef: { id: "b", version: 1 },
      expectedResourceVersion: 2,
    });
    await expect(
      service.approve(second.action.id, {
        approverId: "owner",
        approverRole: "WORKSPACE_OWNER",
        permissions: ["project.admin"],
      }),
    ).rejects.toThrow("CANDIDATE_DRIFT");
  });
});
