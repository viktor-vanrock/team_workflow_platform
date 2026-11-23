import {
  designContractRegistry,
  SchemaValidationError,
  type Sha256Digest,
} from "@awp/platform-contracts";

export type GitLabIdentitySlot = "READ" | "TRIGGER" | "WEBHOOK";
export type GitLabOperationRoutingKey =
  | "mergeRequestRead"
  | "commitRead"
  | "buildRead"
  | "pipelineTrigger"
  | "pipelineRead"
  | "pipelineLookup"
  | "artifactMetadata"
  | "artifactStream"
  | "webhookVerify";

export interface GitLabClock {
  now(): Date;
}

export const systemGitLabClock: GitLabClock = Object.freeze({ now: () => new Date() });

export interface GitLabCredentialReference {
  readonly reference: string;
  readonly referenceFingerprint: Sha256Digest;
  readonly ownerRef: string;
  readonly rotationPolicyRef: string;
  readonly revocationRunbookRef: string;
}

export interface GitLabReadCredentialReference extends GitLabCredentialReference {
  readonly identityKind: "NON_HUMAN_PROJECT";
  readonly scope: "read_api";
  readonly nonHumanIdentityEvidenceRef: string;
}

export interface GitLabTriggerCredentialReference extends GitLabCredentialReference {
  readonly identityKind: "NON_HUMAN_PROJECT";
  readonly scope: "pipeline_trigger";
  readonly nonHumanIdentityEvidenceRef: string;
}

export interface GitLabWebhookCredentialReference extends GitLabCredentialReference {
  readonly identityMaterialKind: "STANDARD_WEBHOOK_HMAC_KEY";
  readonly keyVersionRef: string;
}

export interface GitLabConnectionConfiguration {
  readonly schemaVersion: "gitlab-connection-configuration@1.0.0";
  readonly identityReferences: Readonly<{
    read: GitLabReadCredentialReference;
    trigger: GitLabTriggerCredentialReference;
    webhook: GitLabWebhookCredentialReference;
  }>;
  readonly operationIdentityRouting: Readonly<
    Record<GitLabOperationRoutingKey, GitLabIdentitySlot>
  >;
  readonly identitySeparationEvidenceHash: Sha256Digest;
}

export interface GitLabSecretLease {
  readonly metadata: Readonly<Record<string, unknown>>;
  use<T>(now: Date, consumer: (material: Uint8Array) => Promise<T>): Promise<T>;
}

export interface GitLabSecretResolver {
  resolve(
    secretRef: string,
    allowedUseHash: Sha256Digest,
    signal: AbortSignal,
  ): Promise<GitLabSecretLease>;
}

const expectedRouting: Readonly<Record<GitLabOperationRoutingKey, GitLabIdentitySlot>> =
  Object.freeze({
    mergeRequestRead: "READ",
    commitRead: "READ",
    buildRead: "READ",
    pipelineTrigger: "TRIGGER",
    pipelineRead: "READ",
    pipelineLookup: "READ",
    artifactMetadata: "READ",
    artifactStream: "READ",
    webhookVerify: "WEBHOOK",
  });

export const gitLabOperationIdentityRouting = expectedRouting;

export class GitLabAuthError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "GitLabAuthError";
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

export function validateGitLabConnectionConfiguration(
  value: unknown,
): GitLabConnectionConfiguration {
  let configuration: GitLabConnectionConfiguration;
  try {
    configuration = designContractRegistry.validateById(
      "urn:awp:schemas:005:gitlab-connection-configuration:v1",
      value,
    ) as GitLabConnectionConfiguration;
  } catch (error) {
    if (error instanceof SchemaValidationError)
      throw new GitLabAuthError("GITLAB_CONNECTION_CONFIGURATION_INVALID");
    throw error;
  }

  for (const [operation, slot] of Object.entries(expectedRouting) as readonly [
    GitLabOperationRoutingKey,
    GitLabIdentitySlot,
  ][]) {
    if (configuration.operationIdentityRouting[operation] !== slot) {
      throw new GitLabAuthError("GITLAB_IDENTITY_ROUTING_INVALID");
    }
  }
  const references = Object.values(configuration.identityReferences).map(
    ({ reference }) => reference,
  );
  const fingerprints = Object.values(configuration.identityReferences).map(
    ({ referenceFingerprint }) => referenceFingerprint,
  );
  if (
    new Set(references).size !== references.length ||
    new Set(fingerprints).size !== fingerprints.length
  ) {
    throw new GitLabAuthError("GITLAB_IDENTITY_SEPARATION_INVALID");
  }
  return deepFreeze(structuredClone(configuration));
}

function authorizationHeaders(material: Uint8Array): Readonly<Record<string, string>> {
  if (material.byteLength === 0) throw new GitLabAuthError("GITLAB_CREDENTIAL_EMPTY");
  const credential = new TextDecoder("utf-8", { fatal: true }).decode(material);
  if (!credential || /[\r\n]/u.test(credential))
    throw new GitLabAuthError("GITLAB_CREDENTIAL_INVALID");
  return Object.freeze({ accept: "application/json", "private-token": credential });
}

export function redactGitLabHeaders(
  headers: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(headers).map(([key, value]) => [
        key,
        /authorization|cookie|private-token|token/iu.test(key) ? "[REDACTED]" : value,
      ]),
    ),
  );
}

export class GitLabAuth {
  constructor(
    private readonly configuration: GitLabConnectionConfiguration,
    private readonly resolver: GitLabSecretResolver,
    private readonly clock: GitLabClock = systemGitLabClock,
  ) {}

  identitySlot(operation: GitLabOperationRoutingKey): GitLabIdentitySlot {
    const expected = expectedRouting[operation];
    const configured = this.configuration.operationIdentityRouting[operation];
    if (!expected || configured !== expected)
      throw new GitLabAuthError("GITLAB_IDENTITY_ROUTING_INVALID");
    return configured;
  }

  async withReadHeaders<T>(
    operation: Exclude<GitLabOperationRoutingKey, "pipelineTrigger" | "webhookVerify">,
    signal: AbortSignal,
    consumer: (headers: Readonly<Record<string, string>>) => Promise<T>,
  ): Promise<T> {
    if (this.identitySlot(operation) !== "READ")
      throw new GitLabAuthError("GITLAB_READ_IDENTITY_REQUIRED");
    const reference = this.configuration.identityReferences.read;
    const lease = await this.resolver.resolve(
      reference.reference,
      reference.referenceFingerprint,
      signal,
    );
    return await lease.use(
      this.clock.now(),
      async (material) => await consumer(authorizationHeaders(material)),
    );
  }

  async withTriggerCredential<T>(
    signal: AbortSignal,
    consumer: (material: Uint8Array) => Promise<T>,
  ): Promise<T> {
    if (this.identitySlot("pipelineTrigger") !== "TRIGGER")
      throw new GitLabAuthError("GITLAB_TRIGGER_IDENTITY_REQUIRED");
    const reference = this.configuration.identityReferences.trigger;
    const lease = await this.resolver.resolve(
      reference.reference,
      reference.referenceFingerprint,
      signal,
    );
    return await lease.use(this.clock.now(), consumer);
  }

  async withWebhookKey<T>(
    signal: AbortSignal,
    consumer: (material: Uint8Array) => Promise<T>,
  ): Promise<T> {
    if (this.identitySlot("webhookVerify") !== "WEBHOOK")
      throw new GitLabAuthError("GITLAB_WEBHOOK_IDENTITY_REQUIRED");
    const reference = this.configuration.identityReferences.webhook;
    const lease = await this.resolver.resolve(
      reference.reference,
      reference.referenceFingerprint,
      signal,
    );
    return await lease.use(this.clock.now(), consumer);
  }
}

export const redactGitLabAuth = redactGitLabHeaders;
