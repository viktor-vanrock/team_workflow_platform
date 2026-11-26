import { describe, expect, it, vi } from "vitest";

import { createRequestedCapabilityProbeWorker } from "../../../packages/runtime-composition/src/onboarding/requested-probe-worker.ts";
import { createCapabilityProbeMaintenanceWorker } from "../../../packages/runtime-composition/src/pilot/maintenance-probes.ts";

describe("corporate capability probes", () => {
  const scope = { workspaceId: "workspace", projectIds: ["project"] };
  it("limits requested and maintenance scans before claiming work", async () => {
    const query = vi.fn<(sql: string, params: readonly unknown[]) => Promise<unknown[]>>(
      async () => [],
    );
    const source = { query } as never;
    await createRequestedCapabilityProbeWorker(source, {
      deadlineMs: 100,
      validForMs: 1000,
      deploymentScope: scope,
    }).run();
    expect(query.mock.calls[0]?.[0]).toContain("project_id=ANY($3::uuid[])");
    expect(query.mock.calls[0]?.[1].slice(1)).toEqual(["workspace", ["project"]]);
    await createCapabilityProbeMaintenanceWorker(source, {
      refreshAfterMs: 1000,
      deadlineMs: 100,
      validForMs: 2000,
      now: () => "2026-01-01T00:00:00.000Z",
      deploymentScope: scope,
    }).run();
    expect(query.mock.calls[1]?.[0]).toContain("b.project_id=ANY($5::uuid[])");
    expect(query.mock.calls[1]?.[1].slice(3)).toEqual(["workspace", ["project"]]);
  });
  it("rejects an empty corporate scope", () => {
    expect(() =>
      createRequestedCapabilityProbeWorker({} as never, {
        deadlineMs: 100,
        validForMs: 1000,
        deploymentScope: { workspaceId: "workspace", projectIds: [] },
      }),
    ).toThrow("PROBE_POLICY_INVALID");
  });
});
