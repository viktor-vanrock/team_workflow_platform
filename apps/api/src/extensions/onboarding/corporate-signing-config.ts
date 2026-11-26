import { readFileSync } from "node:fs";

import {
  assertExactRevisionRef,
  freezePilotValue,
  pilotContentHash,
  samePilotRef,
  type ExactRevisionRef,
} from "@awp/platform-core";
import type { RuntimeConfigurationPublication } from "@awp/platform-persistence-typeorm";
import type { CorporateSigningGrant, RuntimeEnvironment } from "@awp/runtime-composition";

export interface CorporateSigningHostProject {
  readonly grant: CorporateSigningGrant;
  readonly redactionPolicyRef: ExactRevisionRef;
  readonly exportPolicyRef: ExactRevisionRef;
  readonly trustedPublicKeys: readonly ExactRevisionRef[];
}
export interface CorporateSigningHostConfig {
  readonly publicKeyHistoryDirectory: string;
  readonly projects: readonly CorporateSigningHostProject[];
}

export function parseCorporateSigningHostConfig(
  value: unknown,
  environment: RuntimeEnvironment,
  publications: readonly RuntimeConfigurationPublication[],
): CorporateSigningHostConfig {
  const denied = (): never => {
    throw new Error("CORPORATE_SIGNING_CONFIG_INVALID");
  };
  const object = (child: unknown, keys: readonly string[]): Record<string, unknown> => {
    if (!child || typeof child !== "object" || Array.isArray(child)) return denied();
    const result = child as Record<string, unknown>;
    if (Object.keys(result).some((key) => !keys.includes(key))) return denied();
    return result;
  };
  const exact = (child: unknown): ExactRevisionRef => {
    const ref = object(child, ["id", "version", "contentHash"]);
    assertExactRevisionRef(ref as unknown as ExactRevisionRef);
    return ref as unknown as ExactRevisionRef;
  };
  const input = object(value, [
    "schemaVersion",
    "deploymentPolicyHash",
    "publicKeyHistoryDirectory",
    "projects",
  ]);
  const deployment = environment.deployment;
  if (
    !deployment ||
    environment.profile !== "non-local" ||
    environment.environmentScope !== "NON_PROD" ||
    input.schemaVersion !== 1 ||
    input.deploymentPolicyHash !== pilotContentHash(deployment) ||
    typeof input.publicKeyHistoryDirectory !== "string" ||
    !input.publicKeyHistoryDirectory.startsWith("/") ||
    !Array.isArray(input.projects) ||
    input.projects.length !== deployment.projectIds.length
  )
    return denied();
  const published = publications.filter(
    (entry) =>
      entry.kind === "SIGNING_POLICY" && samePilotRef(entry.ref, deployment.signingPolicyRef),
  );
  if (published.length !== 1) return denied();
  const seen = new Set<string>();
  for (const raw of input.projects) {
    const entry = object(raw, [
      "grant",
      "redactionPolicyRef",
      "exportPolicyRef",
      "trustedPublicKeys",
    ]);
    const grant = object(entry.grant, ["configuration", "serviceIdentity", "permission"]);
    const config = object(grant.configuration, [
      "workspaceId",
      "projectId",
      "servicePrincipalId",
      "mount",
      "keyName",
      "keyVersion",
      "kid",
      "publicKeyRef",
      "signingPolicyRef",
    ]);
    const identity = object(grant.serviceIdentity, ["issuer", "subject", "serviceKey"]);
    if (
      config.workspaceId !== deployment.workspaceId ||
      typeof config.projectId !== "string" ||
      !deployment.projectIds.includes(config.projectId) ||
      seen.has(config.projectId) ||
      typeof config.servicePrincipalId !== "string" ||
      !config.servicePrincipalId ||
      typeof grant.permission !== "string" ||
      !/^[a-z][a-z0-9_.-]{0,127}$/u.test(grant.permission) ||
      [identity.issuer, identity.subject, identity.serviceKey].some(
        (v) => typeof v !== "string" || !v,
      ) ||
      !samePilotRef(exact(config.signingPolicyRef), deployment.signingPolicyRef) ||
      !Array.isArray(entry.trustedPublicKeys) ||
      !entry.trustedPublicKeys.length
    )
      return denied();
    seen.add(config.projectId);
    const current = exact(config.publicKeyRef);
    const trusted = entry.trustedPublicKeys.map(exact);
    if (!trusted.some((ref) => samePilotRef(ref, current))) return denied();
    exact(entry.redactionPolicyRef);
    exact(entry.exportPolicyRef);
  }
  return freezePilotValue(
    structuredClone({
      publicKeyHistoryDirectory: input.publicKeyHistoryDirectory,
      projects: input.projects,
    }),
  ) as unknown as CorporateSigningHostConfig;
}

export function loadCorporateSigningHostConfig(
  environment: RuntimeEnvironment,
  publications: readonly RuntimeConfigurationPublication[],
  env: NodeJS.ProcessEnv = process.env,
): CorporateSigningHostConfig {
  if (!env.AWP_CORPORATE_SIGNING_CONFIG_PATH) throw new Error("CORPORATE_SIGNING_CONFIG_REQUIRED");
  try {
    const data = readFileSync(env.AWP_CORPORATE_SIGNING_CONFIG_PATH);
    if (!data.length || data.length > 100_000) throw new Error();
    return parseCorporateSigningHostConfig(
      JSON.parse(data.toString("utf8")),
      environment,
      publications,
    );
  } catch {
    throw new Error("CORPORATE_SIGNING_CONFIG_INVALID");
  }
}
