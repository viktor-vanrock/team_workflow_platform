import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Ajv2020 } from "ajv/dist/2020.js";

export interface Feature004MattermostMetadata {
  readonly schemaVersion: "mattermost-pilot-metadata@1.0.0";
  readonly contourKey: string;
  readonly environmentClass: "LOCAL" | "DEVELOPMENT" | "TEST";
  readonly workspaceId: string;
  readonly projectId: string;
  readonly server: Readonly<{
    baseUrl: string;
    buildVersion: string;
    apiFamily: "v4";
    tlsOwner: string;
    networkOwner: string;
  }>;
  readonly callbackAuthentication:
    "DISABLED" | "AWP_OPAQUE_INTENT" | "SIGNED_PROXY_HMAC_PLUS_AWP_INTENT";
  readonly ingressContractRefs: readonly Readonly<{ key: string; version: string; hash: string }>[];
  readonly projectCredentialSecretRefs: readonly string[];
  readonly credentialIdentityFingerprint: string;
  readonly teamId: string;
  readonly botUserId: string;
  readonly channelIds: readonly string[];
  readonly operatorOptIn: boolean;
  readonly productionDenied: true;
  readonly presentationTokenEncryptionKeyRef?: Readonly<{
    workspaceId: string;
    projectId: string;
    environmentClass: string;
    decryptUntil: string;
  }>;
  readonly presentationTokenRetention?: Readonly<{
    maxCapsuleLifetimeSeconds: number;
    expirySweepIntervalSeconds: number;
    expiryPurgeSlaSeconds: number;
    terminalPurgeSlaSeconds: 0;
    walRetentionMaxSeconds: number;
    backupRetentionMaxSeconds: number;
    keyDisableSlaSeconds: number;
  }>;
  readonly validatedServerLimits: Readonly<{
    pendingPostIdLookupSupported: boolean;
    effectMarkerLookupSupported: boolean;
    requestTimeoutMs: number;
    maxRequestsPerMinute: number;
    maxMessageCharacters: number;
  }>;
  readonly [key: string]: unknown;
}

const forbiddenKeys =
  /^(?:accessToken|apiToken|authorization|clientSecret|cookie|password|privateKey|secret|secretValue|token)$/iu;
const productionHost = /(?:^|[.-])prod(?:uction)?(?:[.-]|$)/iu;

function assertSecretFree(value: unknown, path = "$"): void {
  if (typeof value === "string" && /^(?:Bearer|Basic)\s+/iu.test(value))
    throw new Error(`METADATA_EMBEDDED_SECRET:${path}`);
  if (Array.isArray(value))
    value.forEach((child, index) => {
      assertSecretFree(child, `${path}[${index}]`);
    });
  else if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Readonly<Record<string, unknown>>)) {
      if (forbiddenKeys.test(key)) throw new Error(`METADATA_EMBEDDED_SECRET:${path}.${key}`);
      assertSecretFree(child, `${path}.${key}`);
    }
  }
}

export function isProductionTarget(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Readonly<Record<string, unknown>>;
  const environment = String(record.environmentClass ?? "");
  const server =
    record.server !== null && typeof record.server === "object" && !Array.isArray(record.server)
      ? (record.server as Readonly<Record<string, unknown>>)
      : {};
  let host = "";
  try {
    host = new URL(String(server.baseUrl ?? "")).hostname;
  } catch {
    /* schema validation reports malformed URLs */
  }
  return /^PROD(?:UCTION)?$/iu.test(environment) || productionHost.test(host);
}

export function validateFeature004MattermostMetadata(
  value: unknown,
  workspace: string,
): Feature004MattermostMetadata {
  if (isProductionTarget(value)) throw new Error("PRODUCTION_TARGET_DENIED");
  assertSecretFree(value);
  const schema = JSON.parse(
    readFileSync(
      resolve(
        workspace,
        "specs/004-mattermost-hermes-intake/contracts/schemas/mattermost-pilot-metadata.v1.schema.json",
      ),
      "utf8",
    ),
  ) as Record<string, unknown>;
  const validate = new Ajv2020({ allErrors: true, strict: false, validateFormats: false }).compile(
    schema,
  );
  if (!validate(value))
    throw new Error(`METADATA_SCHEMA_INVALID:${JSON.stringify(validate.errors)}`);
  const metadata = value as Feature004MattermostMetadata;
  const endpoint = new URL(metadata.server.baseUrl);
  if (metadata.environmentClass === "LOCAL") {
    if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(endpoint.hostname))
      throw new Error("LOCAL_ENDPOINT_NOT_LOOPBACK");
  } else {
    if (endpoint.protocol !== "https:") throw new Error("NONPROD_TLS_REQUIRED");
    if (!metadata.operatorOptIn) throw new Error("NONPROD_OPERATOR_OPT_IN_REQUIRED");
  }
  if (metadata.callbackAuthentication !== "DISABLED") {
    const key = metadata.presentationTokenEncryptionKeyRef;
    const retention = metadata.presentationTokenRetention;
    if (!key || !retention) throw new Error("CALLBACK_RETENTION_METADATA_REQUIRED");
    if (
      key.workspaceId !== metadata.workspaceId ||
      key.projectId !== metadata.projectId ||
      key.environmentClass !== metadata.environmentClass
    )
      throw new Error("PRESENTATION_KEY_SCOPE_MISMATCH");
    if (retention.expirySweepIntervalSeconds > retention.expiryPurgeSlaSeconds)
      throw new Error("EXPIRY_SWEEP_EXCEEDS_PURGE_SLA");
    if (retention.terminalPurgeSlaSeconds !== 0) throw new Error("TERMINAL_PURGE_MUST_BE_ATOMIC");
    if (Date.parse(key.decryptUntil) <= Date.now())
      throw new Error("PRESENTATION_KEY_DECRYPT_HORIZON_EXPIRED");
  }
  return metadata;
}

export function assertFeature004LiveNonProd(metadata: Feature004MattermostMetadata): URL {
  if (!metadata.productionDenied || isProductionTarget(metadata))
    throw new Error("PRODUCTION_TARGET_DENIED");
  if (
    !(["DEVELOPMENT", "TEST"] as const).includes(
      metadata.environmentClass as "DEVELOPMENT" | "TEST",
    )
  )
    throw new Error("LIVE_METADATA_NOT_NONPROD");
  if (!metadata.operatorOptIn) throw new Error("NONPROD_OPERATOR_OPT_IN_REQUIRED");
  const endpoint = new URL(metadata.server.baseUrl);
  if (endpoint.protocol !== "https:") throw new Error("NONPROD_TLS_REQUIRED");
  return endpoint;
}
