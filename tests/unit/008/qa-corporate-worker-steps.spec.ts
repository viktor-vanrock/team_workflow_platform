import { afterEach, describe, expect, it, vi } from "vitest";

import { TypeOrmCommandDeliveryStore } from "../../../packages/platform-persistence-typeorm/src/index.ts";
import { createQaJiraCorporateWorkerSteps } from "../../../packages/runtime-composition/src/jira/qa-corporate-worker-steps.ts";

afterEach(() => vi.restoreAllMocks());

describe("corporate Jira worker steps", () => {
  it("rejects local and incomplete environments", () => {
    expect(() =>
      createQaJiraCorporateWorkerSteps({
        source: { isInitialized: true },
        environment: { profile: "local" },
      } as never),
    ).toThrow("CORPORATE_JIRA_WORKER_REQUIRED");
  });

  it("limits dispatch and recovery to deployed projects and request creation", async () => {
    const claim = vi.spyOn(TypeOrmCommandDeliveryStore.prototype, "claim").mockResolvedValue([]);
    const recover = vi
      .spyOn(TypeOrmCommandDeliveryStore.prototype, "recoverExpired")
      .mockResolvedValue([]);
    const steps = createQaJiraCorporateWorkerSteps({
      source: { isInitialized: true },
      environment: {
        profile: "non-local",
        environmentScope: "NON_PROD",
        deployment: {
          workspaceId: "workspace",
          projectIds: ["project"],
        },
      },
      grants: [],
      factories: {},
      commands: {},
      createObservation: { read: vi.fn() },
    } as never);
    await steps.dispatcher.run();
    await steps.recovery.run();
    expect(claim).toHaveBeenCalledWith(
      expect.any(Date),
      expect.any(Date),
      20,
      ["operational-work-item"],
      { workspaceId: "workspace", projectIds: ["project"], operations: ["request.create"] },
    );
    expect(recover).toHaveBeenCalledWith(expect.any(Date), 50, {
      workspaceId: "workspace",
      projectIds: ["project"],
      operations: ["request.create"],
    });
  });
});
