import { readFileSync } from "node:fs";

import { pilotContentHash } from "@awp/platform-core";
import type { RuntimeEnvironment } from "@awp/runtime-composition";

import type { CorporateAgentGrantConfiguration } from "./corporate-agent-grant-authority.ts";

/** Deployment-owned non-secret mapping. The authority rechecks the current Core grants. */
export function loadCorporateAgentConfig(
  environment: RuntimeEnvironment,
  env: NodeJS.ProcessEnv = process.env,
): readonly CorporateAgentGrantConfiguration[] {
  try {
    const path = env.AWP_CORPORATE_AGENT_CONFIG_PATH;
    const deployment = environment.deployment;
    if (
      !path?.startsWith("/") ||
      environment.profile !== "non-local" ||
      environment.environmentScope !== "NON_PROD" ||
      !deployment
    )
      throw new Error();
    const bytes = readFileSync(path);
    if (!bytes.length || bytes.length > 100_000) throw new Error();
    const value = JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).some(
        (key) => !["schemaVersion", "deploymentPolicyHash", "projects"].includes(key),
      ) ||
      value.schemaVersion !== 1 ||
      value.deploymentPolicyHash !== pilotContentHash(deployment) ||
      !Array.isArray(value.projects) ||
      value.projects.length !== deployment.projectIds.length
    )
      throw new Error();
    const projects = value.projects as CorporateAgentGrantConfiguration[];
    if (
      new Set(projects.map((entry) => entry?.projectId)).size !== projects.length ||
      projects.some(
        (entry) =>
          !entry ||
          entry.workspaceId !== deployment.workspaceId ||
          !deployment.projectIds.includes(entry.projectId) ||
          Object.keys(entry).some(
            (key) =>
              ![
                "workspaceId",
                "projectId",
                "servicePrincipalId",
                "serviceIdentity",
                "actions",
              ].includes(key),
          ) ||
          !entry.serviceIdentity ||
          Object.keys(entry.serviceIdentity).some(
            (key) => !["issuer", "subject", "serviceKey"].includes(key),
          ) ||
          !Array.isArray(entry.actions) ||
          entry.actions.some(
            (action) =>
              !action ||
              Object.keys(action).some(
                (key) => !["action", "humanPermission", "servicePermission"].includes(key),
              ),
          ),
      )
    )
      throw new Error();
    return projects;
  } catch {
    throw new Error("CORPORATE_AGENT_CONFIG_INVALID");
  }
}
