import { readFileSync } from "node:fs";

import {
  assertExactRevisionRef,
  type ExactRevisionRef,
  freezePilotValue,
  pilotContentHash,
} from "@awp/platform-core";
import type { RuntimeConfigurationPublication } from "@awp/platform-persistence-typeorm";
import {
  type QaCompletionPins,
  type QaDefectPublicationPins,
  type QaDodPolicyPins,
  type QaReadinessPins,
  type RuntimeEnvironment,
} from "@awp/runtime-composition";

/** Server-only, non-secret configuration for one exact published deployment. */
export interface CorporateQaHostConfig {
  readonly schemaVersion: 1;
  readonly deploymentPolicyHash: string;
  readonly readinessPins: readonly QaReadinessPins[];
  readonly dodPins: readonly QaDodPolicyPins[];
  readonly defectPins: readonly QaDefectPublicationPins[];
  readonly completionPins: readonly QaCompletionPins[];
  readonly stepUpPermissions: readonly string[];
}

const allowedKeys = new Set([
  "schemaVersion",
  "deploymentPolicyHash",
  "readinessPins",
  "dodPins",
  "defectPins",
  "completionPins",
  "stepUpPermissions",
]);

export function parseCorporateQaHostConfig(
  value: unknown,
  environment: RuntimeEnvironment,
): CorporateQaHostConfig {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("CORPORATE_QA_CONFIG_INVALID");
  const input = value as Record<string, unknown>;
  const deployment = environment.deployment;
  if (
    environment.profile !== "non-local" ||
    environment.environmentScope !== "NON_PROD" ||
    !deployment ||
    input.schemaVersion !== 1 ||
    input.deploymentPolicyHash !== pilotContentHash(deployment) ||
    Object.keys(input).some((key) => !allowedKeys.has(key)) ||
    !Array.isArray(input.readinessPins) ||
    !Array.isArray(input.dodPins) ||
    !Array.isArray(input.defectPins) ||
    !Array.isArray(input.completionPins) ||
    !Array.isArray(input.stepUpPermissions) ||
    input.stepUpPermissions.some(
      (permission) =>
        typeof permission !== "string" || !/^[a-z][a-z0-9_.-]{0,127}$/u.test(permission),
    )
  )
    throw new Error("CORPORATE_QA_CONFIG_INVALID");
  // Reject credential-like properties anywhere, including unknown nested fields.
  const inspect = (child: unknown): void => {
    if (!child || typeof child !== "object") return;
    if (Array.isArray(child)) {
      child.forEach(inspect);
      return;
    }
    for (const [key, nested] of Object.entries(child)) {
      if (/password|secret|credential|token|privatekey/iu.test(key))
        throw new Error("CORPORATE_QA_CONFIG_SECRET_FORBIDDEN");
      inspect(nested);
    }
  };
  inspect(input);
  const object = (item: unknown, keys: readonly string[]): Record<string, unknown> => {
    if (!item || typeof item !== "object" || Array.isArray(item))
      throw new Error("CORPORATE_QA_CONFIG_INVALID");
    const record = item as Record<string, unknown>;
    if (Object.keys(record).some((key) => !keys.includes(key)))
      throw new Error("CORPORATE_QA_CONFIG_INVALID");
    return record;
  };
  const exact = (item: unknown): void => {
    const ref = object(item, ["id", "version", "contentHash"]);
    assertExactRevisionRef(ref as unknown as ExactRevisionRef);
  };
  const scope = (item: Record<string, unknown>): void => {
    if (
      item.workspaceId !== deployment.workspaceId ||
      typeof item.projectId !== "string" ||
      !deployment.projectIds.includes(item.projectId)
    )
      throw new Error("CORPORATE_QA_CONFIG_SCOPE_DENIED");
  };
  const pins = (value: unknown[], keys: readonly string[], refs: readonly string[]) => {
    if (value.length !== deployment.projectIds.length)
      throw new Error("CORPORATE_QA_CONFIG_SCOPE_DENIED");
    const projects = new Set<string>();
    for (const raw of value) {
      const item = object(raw, ["workspaceId", "projectId", ...keys]);
      scope(item);
      if (projects.has(item.projectId as string))
        throw new Error("CORPORATE_QA_CONFIG_SCOPE_DENIED");
      projects.add(item.projectId as string);
      refs.forEach((key) => {
        exact(item[key]);
      });
    }
  };
  pins(
    input.readinessPins,
    [
      "bindingRef",
      "profileRef",
      "connectionRef",
      "contextRef",
      "freshnessPolicyRef",
      "maximumProjectionAgeMs",
      "authorityScopeKey",
    ],
    ["bindingRef", "profileRef", "connectionRef", "contextRef", "freshnessPolicyRef"],
  );
  pins(input.dodPins, ["contextRef", "riskPolicyRef"], ["contextRef", "riskPolicyRef"]);
  pins(
    input.completionPins,
    [
      "bindingRef",
      "profileRef",
      "mappingRef",
      "connectionRef",
      "authorityScopeKey",
      "externalProjectId",
      "maximumClassificationKey",
      "maximumProjectionAgeMs",
      "allowedFromStates",
    ],
    ["bindingRef", "profileRef", "mappingRef", "connectionRef"],
  );
  pins(
    input.defectPins,
    [
      "bindingRef",
      "destination",
      "requestAuthority",
      "authorityScopeKey",
      "externalProjectId",
      "externalIssueTypeId",
      "maximumClassificationKey",
    ],
    ["bindingRef"],
  );
  for (const raw of input.defectPins) {
    const item = raw as Record<string, unknown>;
    for (const key of ["destination", "requestAuthority"]) {
      const chain = object(item[key], ["profileRef", "mappingRef", "connectionRef"]);
      ["profileRef", "mappingRef", "connectionRef"].forEach((name) => {
        exact(chain[name]);
      });
    }
  }
  return freezePilotValue(structuredClone(input)) as unknown as CorporateQaHostConfig;
}

export function loadCorporateQaHostConfig(
  environment: RuntimeEnvironment,
  env: NodeJS.ProcessEnv = process.env,
): CorporateQaHostConfig {
  const path = env.AWP_CORPORATE_QA_CONFIG_PATH;
  if (!path) throw new Error("CORPORATE_QA_CONFIG_REQUIRED");
  try {
    const bytes = readFileSync(path);
    if (!bytes.length || bytes.length > 100_000) throw new Error();
    return parseCorporateQaHostConfig(JSON.parse(bytes.toString("utf8")), environment);
  } catch {
    throw new Error("CORPORATE_QA_CONFIG_INVALID");
  }
}

/** Check the host's request-authority pins against the approved Jira deployment publication. */
export function assertCorporateQaDeploymentPins(
  config: CorporateQaHostConfig,
  publications: readonly RuntimeConfigurationPublication[],
): void {
  const jira = publications.filter(
    (item) => item.kind === "CONNECTOR_BINDING" && item.document.provider === "jira",
  );
  if (jira.length !== 1 || !Array.isArray(jira[0]!.document.projects))
    throw new Error("CORPORATE_QA_DEPLOYMENT_PINS_INVALID");
  const projects = jira[0]!.document.projects as unknown[];
  const same = (value: unknown, ref: ExactRevisionRef): boolean => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const candidate = value as Record<string, unknown>;
    return (
      candidate.id === ref.id &&
      candidate.version === ref.version &&
      candidate.contentHash === ref.contentHash
    );
  };
  for (const pin of config.readinessPins) {
    const candidates = projects.filter(
      (value) =>
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        (value as Record<string, unknown>).projectId === pin.projectId,
    );
    if (candidates.length !== 1) throw new Error("CORPORATE_QA_DEPLOYMENT_PINS_INVALID");
    const candidate = candidates[0] as Record<string, unknown>;
    if (
      !same(candidate.integrationBindingRef, pin.bindingRef) ||
      !same(candidate.profileRef, pin.profileRef) ||
      !same(candidate.connectionRef, pin.connectionRef)
    )
      throw new Error("CORPORATE_QA_DEPLOYMENT_PINS_INVALID");
  }
}
