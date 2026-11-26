import { describe, expect, it, vi } from "vitest";

import {
  createCorporateWorkerContributions,
  createDeferredGitLabEventsStep,
} from "../../../apps/worker/src/corporate-contributions.ts";
import { pilotNonLocalWorkerKeys } from "../../../packages/runtime-composition/src/pilot/composition.ts";

describe("corporate worker contributions", () => {
  it("rejects local deployments and incomplete ports", () => {
    expect(() =>
      createCorporateWorkerContributions({
        source: { isInitialized: true },
        environment: { profile: "local" },
      } as never),
    ).toThrow("CORPORATE_WORKER_PORTS_REQUIRED");
    expect(() =>
      createCorporateWorkerContributions({
        source: { isInitialized: true },
        environment: { profile: "non-local", environmentScope: "NON_PROD", deployment: {} },
      } as never),
    ).toThrow("CORPORATE_WORKER_PORTS_REQUIRED");
  });

  it("keeps the non-local contribution set closed", () => {
    const contributions = createCorporateWorkerContributions({
      source: { isInitialized: true },
      environment: {
        profile: "non-local",
        environmentScope: "NON_PROD",
        deployment: {
          workspaceId: "workspace",
          projectIds: ["project"],
        },
      },
      grants: [
        {
          binding: {
            provider: "JIRA",
            workspaceId: "workspace",
            projectId: "project",
            connectionRef: { id: "connection", version: 1, contentHash: "hash" },
          },
        },
      ],
      factories: {},
      commands: { guard: { assertCommandAllowed: async () => undefined } },
      connectorAuthority: { authorize: async () => false },
      fences: { current: async () => undefined },
      effectGuard: { assertEffectsAllowed: async () => ({}) },
    } as never);
    expect(contributions.map((entry) => entry.key).sort()).toEqual(
      [...pilotNonLocalWorkerKeys].sort(),
    );
  });
  it("leaves GitLab events pending in the database for a future recipient", async () => {
    const query = vi.fn(async (_sql: string, _parameters: readonly unknown[]) => [{ pending: 3 }]);
    const step = createDeferredGitLabEventsStep({ query } as never, {
      workspaceId: "workspace",
      projectIds: ["project"],
    });
    expect(await step.run()).toEqual({ deferred: 3 });
    expect(query.mock.calls[0]?.[0]).toMatch(/^SELECT/);
    expect(query.mock.calls[0]?.[1].slice(1)).toEqual(["workspace", ["project"]]);
  });
});
