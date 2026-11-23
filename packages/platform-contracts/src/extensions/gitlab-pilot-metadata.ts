import { type JsonValue, sha256, type Sha256Digest } from "../canonical-hash.ts";
import { designContractRegistry, SchemaValidationError } from "../schema-registry.ts";

export type GitLabPilotEnvironmentClass = "LOCAL" | "DEVELOPMENT" | "TEST";
export type GitLabPilotDeploymentPurpose =
  "CONFORMANCE_VALIDATION" | "PILOT_REHEARSAL" | "PILOT_DEPLOYMENT";
export type GitLabAutomationLogicalRole = "SOURCE_CONTEXT" | "TEST_EXECUTION" | "ARTIFACT_SOURCE";
export type GitLabIdentitySlot = "READ" | "TRIGGER" | "WEBHOOK";

export interface GitLabVersionedRef {
  readonly id: string;
  readonly version: number;
}

export interface GitLabVersionedContentRef extends GitLabVersionedRef {
  readonly contentHash: Sha256Digest;
}

export interface GitLabPilotConfigurationPin {
  readonly logicalRole: GitLabAutomationLogicalRole;
  readonly capabilityKey:
    "source-context.read" | "test-executor.trigger-status" | "artifact.ci-read";
  readonly exactContractVersion: "1.0.0";
  readonly operations: readonly string[];
  readonly operationSetHash: Sha256Digest;
  readonly projectIntegrationBindingRef: GitLabVersionedRef;
  readonly projectIntegrationBindingHash: Sha256Digest;
  readonly profileRef: GitLabVersionedRef;
  readonly profileHash: Sha256Digest;
  readonly connectionRef: GitLabVersionedRef;
  readonly connectionHash: Sha256Digest;
  readonly validationReportId: string;
  readonly validationEvidenceHash: Sha256Digest;
}

export interface GitLabPilotServiceIdentityMetadata {
  readonly identityKind: "NON_HUMAN_SERVICE" | "NON_HUMAN_PROJECT";
  readonly scopes: readonly ("api" | "read_api" | "read_repository" | "pipeline_trigger")[];
  readonly secretRef: string;
  readonly credentialFingerprint: Sha256Digest;
  readonly ownerRef: string;
  readonly nonHumanIdentityEvidenceRef: string;
  readonly leastPrivilegeEvidenceRef: string;
  readonly rotationPolicyRef: string;
  readonly revocationRunbookRef: string;
}

export interface GitLabPilotWebhookIdentityMetadata {
  readonly credentialKind: "STANDARD_WEBHOOK_HMAC_KEY";
  readonly secretRef: string;
  readonly credentialFingerprint: Sha256Digest;
  readonly keyVersionRef: string;
  readonly ownerRef: string;
  readonly rotationPolicyRef: string;
  readonly revocationRunbookRef: string;
}

export interface GitLabPilotMetadataPackage {
  readonly schemaVersion: "gitlab-pilot-metadata@1.0.0";
  readonly deploymentPurpose: GitLabPilotDeploymentPurpose;
  readonly contourKey:
    | "qa-jira-gitlab-local"
    | "qa-jira-gitlab-development"
    | "qa-jira-gitlab-test"
    | "qa-jira-gitlab-mattermost-local"
    | "qa-jira-gitlab-mattermost-development"
    | "qa-jira-gitlab-mattermost-test";
  readonly environmentClass: GitLabPilotEnvironmentClass;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly server: Readonly<{
    baseUrl: string;
    edition: "CE" | "EE";
    exactVersion: string;
    exactBuild: string;
    apiFamily: "v4";
    tlsOwner: string;
    networkOwner: string;
  }>;
  readonly numericGitLabProjectId: number;
  readonly configurationPins: readonly GitLabPilotConfigurationPin[];
  readonly configurationPinSetHash: Sha256Digest;
  readonly suiteBindingRefs: readonly GitLabVersionedContentRef[];
  readonly identities: Readonly<{
    read: GitLabPilotServiceIdentityMetadata;
    trigger: GitLabPilotServiceIdentityMetadata;
    webhook: GitLabPilotWebhookIdentityMetadata;
    credentialRoutingMode: "NAMED_CONNECTION_SLOTS_V1";
    credentialSeparationEvidenceHash: Sha256Digest;
  }>;
  readonly capabilitiesEvidenceRef: string;
  readonly sourceContextContractRef: string;
  readonly allowedRefs: readonly string[];
  readonly allowedEnvironmentRefs: readonly string[];
  readonly triggerContract: Readonly<Record<string, JsonValue>>;
  readonly resultContract: Readonly<Record<string, JsonValue>>;
  readonly artifactContract: Readonly<Record<string, JsonValue>>;
  readonly webhookContract: Readonly<Record<string, JsonValue>>;
  readonly reconciliationContract: Readonly<Record<string, JsonValue>>;
  readonly qaRetryPolicy: Readonly<Record<string, JsonValue>>;
  readonly transportRetry: Readonly<Record<string, JsonValue>>;
  readonly cancellationSemantics: "OBSERVE_ONLY";
  readonly runnerReadinessEvidenceRef: string;
  readonly containerReadinessEvidenceRef: string;
  readonly ciNoDeployAttestationRef: string;
  readonly feature003EvidenceRef?: string;
  readonly feature003EvidenceHash?: Sha256Digest;
  readonly feature004EvidenceRef?: string;
  readonly feature004EvidenceHash?: Sha256Digest;
  readonly feature005EvidenceRef?: string;
  readonly feature005EvidenceHash?: Sha256Digest;
  readonly mattermostCompositionEvidenceRef?: string;
  readonly mattermostCompositionEvidenceHash?: Sha256Digest;
  readonly pilotRehearsalEvidenceRef?: string;
  readonly pilotRehearsalEvidenceHash?: Sha256Digest;
  readonly operatorOptIn: true;
  readonly productionDenied: true;
  readonly generatedAt: string;
  readonly contentHash: Sha256Digest;
}

export class GitLabPilotMetadataError extends Error {
  readonly code: string;
  constructor(code: string, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.code = code;
    this.name = "GitLabPilotMetadataError";
  }
}

const schemaId = "urn:awp:schemas:005:gitlab-pilot-metadata:v1";
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
const roleContracts = Object.freeze({
  SOURCE_CONTEXT: Object.freeze({
    capabilityKey: "source-context.read",
    operations: Object.freeze(["merge-request.read", "commit.read", "build.read"]),
  }),
  TEST_EXECUTION: Object.freeze({
    capabilityKey: "test-executor.trigger-status",
    operations: Object.freeze(["pipeline.trigger", "pipeline.read", "pipeline.lookup"]),
  }),
  ARTIFACT_SOURCE: Object.freeze({
    capabilityKey: "artifact.ci-read",
    operations: Object.freeze(["artifact.metadata", "artifact.stream"]),
  }),
} as const);

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function assertSecretFree(value: unknown, path = "$", seen = new Set<object>()): void {
  if (value === null || typeof value !== "object") {
    if (typeof value === "string" && /^(?:Bearer|Basic)\s+/iu.test(value)) {
      throw new GitLabPilotMetadataError("GITLAB_PILOT_SECRET_MATERIAL_FORBIDDEN", path);
    }
    return;
  }
  if (seen.has(value))
    throw new GitLabPilotMetadataError("GITLAB_PILOT_CYCLIC_VALUE_FORBIDDEN", path);
  seen.add(value);
  if (Array.isArray(value))
    value.forEach((child, index) => {
      assertSecretFree(child, `${path}[${index}]`, seen);
    });
  else {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (forbiddenSecretKeys.has(key))
        throw new GitLabPilotMetadataError(
          "GITLAB_PILOT_SECRET_MATERIAL_FORBIDDEN",
          `${path}.${key}`,
        );
      assertSecretFree(child, `${path}.${key}`, seen);
    }
  }
  seen.delete(value);
}

function metadataHashInput(value: unknown): JsonValue {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new GitLabPilotMetadataError("GITLAB_PILOT_PACKAGE_INVALID");
  }
  const copy = structuredClone(value) as Record<string, unknown>;
  delete copy.contentHash;
  return copy as JsonValue;
}

export function gitLabPilotMetadataContentHash(value: unknown): Sha256Digest {
  return sha256(metadataHashInput(value));
}

function validateRoleContracts(pins: readonly GitLabPilotConfigurationPin[]): void {
  for (const pin of pins) {
    const expected = roleContracts[pin.logicalRole];
    if (
      pin.capabilityKey !== expected.capabilityKey ||
      pin.exactContractVersion !== "1.0.0" ||
      pin.operations.length !== expected.operations.length ||
      pin.operations.some((operation, index) => operation !== expected.operations[index])
    ) {
      throw new GitLabPilotMetadataError("GITLAB_PILOT_ROLE_CONTRACT_INVALID", pin.logicalRole);
    }
  }
}

function validateIdentitySeparation(metadata: GitLabPilotMetadataPackage): void {
  const identities = [
    metadata.identities.read,
    metadata.identities.trigger,
    metadata.identities.webhook,
  ] as const;
  if (
    new Set(identities.map(({ secretRef }) => secretRef)).size !== identities.length ||
    new Set(identities.map(({ credentialFingerprint }) => credentialFingerprint)).size !==
      identities.length
  ) {
    throw new GitLabPilotMetadataError("GITLAB_PILOT_IDENTITY_SEPARATION_INVALID");
  }
}

function validateCrossFieldSemantics(metadata: GitLabPilotMetadataPackage): void {
  validateRoleContracts(metadata.configurationPins);
  validateIdentitySeparation(metadata);
  const trigger = metadata.triggerContract;
  const allowedInputNames = trigger.allowedInputNames;
  if (
    !Array.isArray(allowedInputNames) ||
    !allowedInputNames.includes(trigger.markerInputName as JsonValue)
  ) {
    throw new GitLabPilotMetadataError("GITLAB_PILOT_TRIGGER_MARKER_INVALID");
  }
  const artifact = metadata.artifactContract;
  if (Number(artifact.minimumRetentionSeconds) > Number(artifact.maximumRetentionSeconds)) {
    throw new GitLabPilotMetadataError("GITLAB_PILOT_RETENTION_INVALID");
  }
  const retry = metadata.transportRetry;
  if (Number(retry.minimumBackoffMs) > Number(retry.maximumBackoffMs)) {
    throw new GitLabPilotMetadataError("GITLAB_PILOT_TRANSPORT_RETRY_INVALID");
  }
  const reconciliation = metadata.reconciliationContract;
  if (Number(reconciliation.pollIntervalSeconds) > Number(reconciliation.freshnessTargetSeconds)) {
    throw new GitLabPilotMetadataError("GITLAB_PILOT_RECONCILIATION_BUDGET_INVALID");
  }
}

export function validateGitLabPilotMetadataPackage(value: unknown): GitLabPilotMetadataPackage {
  assertSecretFree(value);
  let candidate: GitLabPilotMetadataPackage;
  try {
    candidate = designContractRegistry.validateById(schemaId, value) as GitLabPilotMetadataPackage;
  } catch (error) {
    if (error instanceof SchemaValidationError)
      throw new GitLabPilotMetadataError("GITLAB_PILOT_SCHEMA_INVALID", error.message);
    throw error;
  }
  validateCrossFieldSemantics(candidate);
  const actualHash = gitLabPilotMetadataContentHash(candidate);
  if (candidate.contentHash !== actualHash) {
    throw new GitLabPilotMetadataError(
      "GITLAB_PILOT_CONTENT_HASH_MISMATCH",
      `expected ${actualHash}`,
    );
  }
  return deepFreeze(structuredClone(candidate));
}
