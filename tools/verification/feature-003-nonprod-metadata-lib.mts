import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Ajv2020 } from "ajv/dist/2020.js";

export interface ContentReference {
  readonly id: string;
  readonly version: number;
  readonly contentHash: string;
}
export interface PilotMetadata {
  readonly schemaVersion: 1;
  readonly packageId: string;
  readonly version: number;
  readonly environment: "LOCAL" | "NON_PROD";
  readonly contentHash: string;
  readonly adapter: Readonly<{
    edition: "CLOUD" | "DATA_CENTER";
    family: string;
    contractVersion: string;
    exactBuild: string;
    apiFlavor: "CLOUD_REST_V3" | "DC_REST_V2";
    capabilityEvidenceRef: ContentReference;
  }>;
  readonly endpoint: Readonly<{
    baseUrl: string;
    tenantKey: string;
    tlsPolicyRef: ContentReference;
  }>;
  readonly auth: Readonly<{
    kind: string;
    secretRef: string;
    rotationPolicyRef: ContentReference;
    revocationRunbookRef: ContentReference;
    leastPrivilegeEvidenceRef: ContentReference;
  }>;
  readonly webhook: Readonly<{
    registrationKind: string;
    verificationMode: string;
    retryHorizonSeconds: number;
    dedupeHorizonSeconds: number;
    evidenceRef: ContentReference;
  }>;
  readonly reconciliation: Readonly<{ maxConcurrency: number; [key: string]: unknown }>;
  readonly rateBudget: Readonly<{ maxInFlight: number; [key: string]: unknown }>;
  readonly concurrency: Readonly<{
    mode: "JIRA_SIDE_CAS" | "COMPARE_AND_VERIFY";
    safetyEvidenceRef: ContentReference;
    conditionalMutationCapabilityRef?: ContentReference;
    riskAcceptanceRef?: ContentReference;
  }>;
  readonly networkEvidenceRef: ContentReference;
}

const forbiddenSecretKeys = new Set([
  "accessToken",
  "apiToken",
  "authorization",
  "clientSecret",
  "cookie",
  "password",
  "privateKey",
  "secret",
  "secretValue",
  "token",
]);

function canonicalize(value: unknown): string {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  )
    return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value !== "object") throw new Error("C1_UNSUPPORTED_VALUE");
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
    .join(",")}}`;
}

function assertSecretFree(value: unknown, path = "$"): void {
  if (typeof value === "string" && /^(?:Bearer|Basic)\s+/iu.test(value))
    throw new Error(`C1_EMBEDDED_SECRET:${path}`);
  if (Array.isArray(value))
    value.forEach((child, index) => {
      assertSecretFree(child, `${path}[${index}]`);
    });
  else if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Readonly<Record<string, unknown>>)) {
      if (forbiddenSecretKeys.has(key)) throw new Error(`C1_EMBEDDED_SECRET:${path}.${key}`);
      assertSecretFree(child, `${path}.${key}`);
    }
  }
}

export function validatePilotMetadata(value: unknown, workspace: string): PilotMetadata {
  assertSecretFree(value);
  const schema = JSON.parse(
    readFileSync(
      resolve(
        workspace,
        "specs/003-jira-operational-authority/contracts/schemas/jira/pilot-metadata-package.v1.schema.json",
      ),
      "utf8",
    ),
  ) as Record<string, unknown>;
  const validate = new Ajv2020({ allErrors: true, strict: false, validateFormats: false }).compile(
    schema,
  );
  if (!validate(value)) throw new Error(`C1_SCHEMA_INVALID:${JSON.stringify(validate.errors)}`);
  const metadata = value as PilotMetadata;
  const hashInput = structuredClone(value) as Record<string, unknown>;
  delete hashInput.contentHash;
  const actualHash = `sha256:${createHash("sha256").update(canonicalize(hashInput)).digest("hex")}`;
  if (metadata.contentHash !== actualHash)
    throw new Error(`C1_CONTENT_HASH_MISMATCH:${actualHash}`);
  if (metadata.webhook.dedupeHorizonSeconds < metadata.webhook.retryHorizonSeconds)
    throw new Error("C1_WEBHOOK_DEDUPE_TOO_SHORT");
  return metadata;
}
