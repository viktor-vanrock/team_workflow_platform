import { type JsonValue, sha256, type Sha256Digest } from "../canonical-hash.ts";
import { designContractRegistry, SchemaValidationError } from "../schema-registry.ts";

export type JiraPilotEnvironment = "LOCAL" | "NON_PROD";
export type JiraEdition = "CLOUD" | "DATA_CENTER";
export type JiraAdapterFamily =
  "jira-cloud-v3" | "jira-dc-9-v2" | "jira-dc-10-v2" | "jira-dc-11-v2";
export type JiraApiFlavor = "CLOUD_REST_V3" | "DC_REST_V2";
export type JiraServiceAuthKind =
  | "CLOUD_SERVICE_OAUTH2_CLIENT"
  | "CLOUD_SERVICE_API_TOKEN"
  | "DC_SERVICE_2LO"
  | "DC_TECHNICAL_ACCOUNT_PAT"
  | "LOCAL_FAKE";

export interface JiraContentReference {
  readonly id: string;
  readonly version: number;
  readonly contentHash: Sha256Digest;
}

export interface JiraPilotMetadataPackage {
  readonly schemaVersion: 1;
  readonly packageId: string;
  readonly version: number;
  readonly environment: JiraPilotEnvironment;
  readonly adapter: Readonly<{
    edition: JiraEdition;
    family: JiraAdapterFamily;
    contractVersion: string;
    exactBuild: string;
    apiFlavor: JiraApiFlavor;
    capabilityEvidenceRef: JiraContentReference;
  }>;
  readonly endpoint: Readonly<{
    baseUrl: string;
    tenantKey: string;
    cloudId?: string;
    contextPath?: string;
    tlsPolicyRef: JiraContentReference;
  }>;
  readonly auth: Readonly<{
    kind: JiraServiceAuthKind;
    secretRef: string;
    credentialOwner: string;
    rotationPolicyRef: JiraContentReference;
    revocationRunbookRef: JiraContentReference;
    leastPrivilegeEvidenceRef: JiraContentReference;
  }>;
  readonly centralRequestProfileRef: JiraContentReference;
  readonly sourceContextProfileRefs: readonly JiraContentReference[];
  readonly defectProfileRefs: readonly JiraContentReference[];
  readonly webhook: Readonly<{
    registrationKind: "ADMIN_STATIC" | "DYNAMIC_REFRESHED" | "LOCAL_FAKE";
    verificationMode: "HMAC" | "OPAQUE_PATH_SECRET_AND_DEDUPE" | "LOCAL_HMAC";
    deliveryIdentityMode: "CLOUD_HEADER" | "CHANGELOG_TUPLE" | "CANONICAL_PAYLOAD_HASH";
    retryHorizonSeconds: number;
    dedupeHorizonSeconds: number;
    expirySeconds?: number;
    renewalLeadSeconds?: number;
    bootstrapCredentialRef?: JiraContentReference;
    evidenceRef: JiraContentReference;
  }>;
  readonly reconciliation: Readonly<{
    freshnessTargetSeconds: number;
    webhookGraceSeconds: number;
    pollIntervalSeconds: number;
    fullSweepIntervalSeconds: number;
    overlapSeconds: number;
    pageSize: number;
    maxConcurrency: number;
  }>;
  readonly rateBudget: Readonly<{
    windowSeconds: number;
    maxRequests: number;
    burst: number;
    maxInFlight: number;
    maxRetryAfterSeconds: number;
  }>;
  readonly concurrency: Readonly<{
    mode: "JIRA_SIDE_CAS" | "COMPARE_AND_VERIFY";
    safetyEvidenceRef: JiraContentReference;
    conditionalMutationCapabilityRef?: JiraContentReference;
    riskAcceptanceRef?: JiraContentReference;
  }>;
  readonly networkEvidenceRef: JiraContentReference;
  readonly generatedAt: string;
  readonly contentHash: Sha256Digest;
}

export interface JiraSecretLeaseMetadata {
  readonly schemaVersion: 1;
  readonly leaseId: string;
  readonly secretRefHash: Sha256Digest;
  readonly secretVersionRef: string;
  readonly allowedUseHash: Sha256Digest;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly redactionToken: string;
}

export class JiraPilotMetadataError extends Error {
  constructor(
    readonly code: string,
    detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "JiraPilotMetadataError";
  }
}

const pilotSchemaId = "urn:awp:schemas:jira:pilot-metadata-package:v1";
const secretLeaseSchemaId = "urn:awp:schemas:jira:secret-lease:v1";
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

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function assertSecretFree(value: unknown, path = "$", seen = new Set<object>()): void {
  if (value === null || typeof value !== "object") {
    if (typeof value === "string" && /^(?:Bearer|Basic)\s+/iu.test(value))
      throw new JiraPilotMetadataError("JIRA_PILOT_SECRET_MATERIAL_FORBIDDEN", path);
    return;
  }
  if (seen.has(value)) throw new JiraPilotMetadataError("JIRA_PILOT_CYCLIC_VALUE_FORBIDDEN", path);
  seen.add(value);
  if (Array.isArray(value))
    value.forEach((child, index) => {
      assertSecretFree(child, `${path}[${index}]`, seen);
    });
  else {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (forbiddenSecretKeys.has(key))
        throw new JiraPilotMetadataError("JIRA_PILOT_SECRET_MATERIAL_FORBIDDEN", `${path}.${key}`);
      assertSecretFree(child, `${path}.${key}`, seen);
    }
  }
  seen.delete(value);
}

function metadataHashInput(value: unknown): JsonValue {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new JiraPilotMetadataError("JIRA_PILOT_PACKAGE_INVALID");
  const copy = structuredClone(value) as Record<string, unknown>;
  delete copy.contentHash;
  return copy as JsonValue;
}

export function jiraPilotMetadataContentHash(value: unknown): Sha256Digest {
  return sha256(metadataHashInput(value));
}

function validateSchema<T>(id: string, value: T, code: string): T {
  try {
    return designContractRegistry.validateById(id, value);
  } catch (error) {
    if (error instanceof SchemaValidationError)
      throw new JiraPilotMetadataError(code, error.message);
    throw error;
  }
}

export function validateJiraPilotMetadataPackage(value: unknown): JiraPilotMetadataPackage {
  assertSecretFree(value);
  const candidate = validateSchema(
    pilotSchemaId,
    value,
    "JIRA_PILOT_SCHEMA_INVALID",
  ) as JiraPilotMetadataPackage;
  const actualHash = jiraPilotMetadataContentHash(candidate);
  if (candidate.contentHash !== actualHash)
    throw new JiraPilotMetadataError("JIRA_PILOT_CONTENT_HASH_MISMATCH", `expected ${actualHash}`);
  if (candidate.webhook.dedupeHorizonSeconds < candidate.webhook.retryHorizonSeconds)
    throw new JiraPilotMetadataError("JIRA_PILOT_DEDUPE_HORIZON_INVALID");
  if (
    candidate.webhook.registrationKind === "DYNAMIC_REFRESHED" &&
    candidate.webhook.renewalLeadSeconds! >= candidate.webhook.expirySeconds!
  )
    throw new JiraPilotMetadataError("JIRA_PILOT_WEBHOOK_RENEWAL_INVALID");
  if (candidate.rateBudget.burst > candidate.rateBudget.maxRequests)
    throw new JiraPilotMetadataError("JIRA_PILOT_RATE_BUDGET_INVALID");
  if (
    candidate.reconciliation.webhookGraceSeconds > candidate.reconciliation.freshnessTargetSeconds
  )
    throw new JiraPilotMetadataError("JIRA_PILOT_FRESHNESS_BUDGET_INVALID");
  return deepFreeze(structuredClone(candidate));
}

export class EphemeralJiraSecretLease {
  readonly metadata: JiraSecretLeaseMetadata;
  #secret: Uint8Array | undefined;

  constructor(metadata: JiraSecretLeaseMetadata, secret: Uint8Array) {
    this.metadata = deepFreeze(
      structuredClone(
        validateSchema(secretLeaseSchemaId, metadata, "JIRA_SECRET_LEASE_METADATA_INVALID"),
      ),
    );
    if (secret.byteLength === 0) throw new JiraPilotMetadataError("JIRA_SECRET_LEASE_EMPTY");
    this.#secret = secret.slice();
    Object.freeze(this);
  }

  use<T>(consumer: (secret: Uint8Array) => T): T {
    if (!this.#secret) throw new JiraPilotMetadataError("JIRA_SECRET_LEASE_CLOSED");
    const isolated = this.#secret.slice();
    try {
      return consumer(isolated);
    } finally {
      isolated.fill(0);
    }
  }

  close(): void {
    this.#secret?.fill(0);
    this.#secret = undefined;
  }

  toJSON(): JiraSecretLeaseMetadata {
    return this.metadata;
  }
}
