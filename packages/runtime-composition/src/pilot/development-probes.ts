import type { DataSource } from "typeorm";

import { pilotContentHash } from "@awp/platform-core";

import type { RuntimeEnvironment } from "../config/environment.ts";
import {
  createRequestedCapabilityProbeWorker,
  type RequestedProbeTarget,
} from "../onboarding/requested-probe-worker.ts";
import { createPilotDevelopmentComposition } from "./composition.ts";
import {
  createCapabilityProbeMaintenanceWorker,
  currentProjectCapabilityPlans,
} from "./maintenance-probes.ts";

/** The explicit dev adapter performs a real bounded call to the external capability emulator. */
export function createDevelopmentCapabilityProbeWorker(
  source: DataSource,
  environment: RuntimeEnvironment,
  now: () => string = () => new Date().toISOString(),
) {
  createPilotDevelopmentComposition(environment);
  const observe = async (
    target: RequestedProbeTarget,
    signal: AbortSignal,
  ): Promise<{
    status: "AVAILABLE" | "DEGRADED" | "UNAVAILABLE";
    safeIssueCodes: readonly string[];
  }> => {
    const response = await fetch(new URL("/mock/pilot/capabilities", environment.mockHubUrl), {
      method: "POST",
      redirect: "error",
      signal,
      headers: {
        "content-type": "application/json",
        "x-awp-mock-control-key": "local-gitlab-control",
      },
      body: JSON.stringify(target),
    });
    if (!response.ok)
      return {
        status: "UNAVAILABLE",
        safeIssueCodes: [
          response.status === 429
            ? "PROVIDER_RATE_LIMITED"
            : response.status === 401 || response.status === 403
              ? "PROVIDER_PERMISSION_DENIED"
              : "PROVIDER_UNAVAILABLE",
        ],
      };
    const body = (await response.json()) as { status?: string; subjectHash?: string };
    if (
      body.subjectHash !== pilotContentHash(target) ||
      !["AVAILABLE", "DEGRADED", "UNAVAILABLE"].includes(body.status ?? "")
    )
      throw new Error("PROVIDER_CONFIGURATION_DRIFT");
    return {
      status: body.status as "AVAILABLE" | "DEGRADED" | "UNAVAILABLE",
      safeIssueCodes: body.status === "AVAILABLE" ? [] : ["PROVIDER_UNAVAILABLE"],
    };
  };
  const maintenance = createCapabilityProbeMaintenanceWorker(source, {
    now,
    refreshAfterMs: 30_000,
    validForMs: 90_000,
    deadlineMs: 3000,
    authorize: async (target, signal) => {
      if (signal.aborted || target.environmentScope !== "LOCAL") return false;
      const projects = (await source.query(
        "SELECT 1 FROM projects p JOIN workspaces w ON w.id=p.workspace_id WHERE p.workspace_id=$1 AND p.id=$2 AND p.state='ACTIVE' AND w.state='ACTIVE' AND p.registration_status='ACTIVE'",
        [target.workspaceId, target.projectId],
      )) as unknown[];
      if (projects.length !== 1) return false;
      const plans = await currentProjectCapabilityPlans(source, target);
      return (
        !signal.aborted &&
        plans.some((plan) =>
          plan.targets.some((current) => pilotContentHash(current) === pilotContentHash(target)),
        )
      );
    },
    observe,
  });
  const requested = createRequestedCapabilityProbeWorker(source, {
    deadlineMs: 3000,
    validForMs: 90_000,
    observe,
    authorize: async (target, signal) => {
      if (signal.aborted || target.environmentScope !== "LOCAL") return false;
      const rows = (await source.query(
        "SELECT 1 FROM projects p JOIN workspaces w ON w.id=p.workspace_id WHERE p.workspace_id=$1 AND p.id=$2 AND p.state IN ('ACTIVE','SUSPENDED') AND w.state='ACTIVE' AND p.registration_status='ACTIVE'",
        [target.workspaceId, target.projectId],
      )) as unknown[];
      return rows.length === 1 && !signal.aborted;
    },
  });
  return {
    async run() {
      const requests = await requested.run();
      return { ...(await maintenance.run()), requests };
    },
  };
}
