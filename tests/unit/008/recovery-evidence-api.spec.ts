import { describe, expect, it, vi } from "vitest";

import { projectRecoveryEvidence008 } from "../../../apps/api/src/extensions/pilot/pilot.controller.ts";
import { PilotBrowserClient } from "../../../apps/web/src/routes/pilot/pilot-client.ts";

const scope = {
  workspaceId: "10000000-0000-4000-8000-000000000001",
  projectId: "20000000-0000-4000-8000-000000000001",
};
describe("008 authorized recovery evidence projection", () => {
  it("returns only the recovery allowlist", () =>
    expect(
      projectRecoveryEvidence008({
        recoveryId: "recovery-1",
        stage: "VERIFIED",
        status: "PASS",
        faultDeclaredAt: "2026-09-05T00:00:00Z",
        serviceRestoredAt: "2026-09-05T00:03:00Z",
        rpoObservedSeconds: 30,
        rtoObservedSeconds: 180,
        unresolvedEffects: [],
        providerPayload: "private",
      }),
    ).toEqual({
      recoveryId: "recovery-1",
      stage: "VERIFIED",
      status: "PASS",
      faultDeclaredAt: "2026-09-05T00:00:00Z",
      serviceRestoredAt: "2026-09-05T00:03:00Z",
      rpoObservedSeconds: 30,
      rtoObservedSeconds: 180,
      unresolvedEffects: [],
    }));
  it("rejects malformed drill evidence", () =>
    expect(() =>
      projectRecoveryEvidence008({
        recoveryId: "recovery-1",
        stage: "INVALID",
        status: "PASS",
        unresolvedEffects: [],
      }),
    ).toThrow("RECOVERY_EVIDENCE_INVALID"));
  it("validates exact scoped browser recovery results", async () => {
    const body = {
      ...scope,
      evaluatedAt: "2026-09-05T00:03:00Z",
      drills: [
        {
          recoveryId: "recovery-1",
          stage: "VERIFIED",
          status: "PASS",
          faultDeclaredAt: "2026-09-05T00:00:00Z",
          serviceRestoredAt: "2026-09-05T00:03:00Z",
          rpoObservedSeconds: 30,
          rtoObservedSeconds: 180,
          unresolvedEffects: [],
        },
      ],
      uncertainEffects: [
        {
          commandId: "command-1",
          certainty: "POSSIBLY_APPLIED",
          reasonCode: "LOOKUP_REQUIRED",
          attemptCount: 1,
          replayCount: 0,
        },
      ],
    };
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    await expect(new PilotBrowserClient(fetcher).recovery(scope)).resolves.toEqual(body);
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining(
        `/workspaces/${scope.workspaceId}/projects/${scope.projectId}/pilot/recovery`,
      ),
      expect.objectContaining({ cache: "no-store", redirect: "error" }),
    );
  });
});
