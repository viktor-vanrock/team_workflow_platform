export type MattermostPilotEnvironmentClass = "LOCAL" | "DEVELOPMENT" | "TEST";

export interface MattermostPilotMetadataPackage {
  readonly schemaVersion: "mattermost-pilot-metadata@1.0.0";
  readonly contourKey: string;
  readonly environmentClass: MattermostPilotEnvironmentClass;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly server: Readonly<Record<string, unknown>>;
  readonly bootstrapContinuationRef: Readonly<Record<string, unknown>>;
  readonly bootstrapValidationEvidenceRef: Readonly<Record<string, unknown>>;
  readonly projectConnectionRef: Readonly<Record<string, unknown>>;
  readonly profileRef: Readonly<Record<string, unknown>>;
  readonly profileValidationReportRef: Readonly<Record<string, unknown>>;
  readonly ingressContractRefs: readonly Readonly<Record<string, unknown>>[];
  readonly projectCredentialSecretRefs: readonly string[];
  readonly presentationTokenEncryptionKeyRef?: Readonly<Record<string, unknown>>;
  readonly presentationTokenRetention?: Readonly<Record<string, unknown>>;
  readonly secretRotationOwner: string;
  readonly secretRevocationProcedureRef: Readonly<Record<string, unknown>>;
  readonly identityBindingSourceRef: Readonly<Record<string, unknown>>;
  readonly membershipSourceRef: Readonly<Record<string, unknown>>;
  readonly callbackAuthentication:
    "DISABLED" | "AWP_OPAQUE_INTENT" | "SIGNED_PROXY_HMAC_PLUS_AWP_INTENT";
  readonly teamId: string;
  readonly botUserId: string;
  readonly credentialIdentityFingerprint: string;
  readonly channelIds: readonly string[];
  readonly membershipEvidenceHash: string;
  readonly templateCatalogRef: Readonly<Record<string, unknown>>;
  readonly redactionPolicyRef: Readonly<Record<string, unknown>>;
  readonly validatedServerLimits: Readonly<Record<string, unknown>>;
  readonly policyValidationEvidence: Readonly<Record<string, unknown>>;
  readonly operatorOptIn: true;
  readonly productionDenied: true;
}

type JsonRecord = Record<string, unknown>;

const ROOT_KEYS = Object.freeze([
  "schemaVersion",
  "contourKey",
  "environmentClass",
  "workspaceId",
  "projectId",
  "server",
  "bootstrapContinuationRef",
  "bootstrapValidationEvidenceRef",
  "projectConnectionRef",
  "profileRef",
  "profileValidationReportRef",
  "ingressContractRefs",
  "projectCredentialSecretRefs",
  "presentationTokenEncryptionKeyRef",
  "presentationTokenRetention",
  "secretRotationOwner",
  "secretRevocationProcedureRef",
  "identityBindingSourceRef",
  "membershipSourceRef",
  "callbackAuthentication",
  "teamId",
  "botUserId",
  "credentialIdentityFingerprint",
  "channelIds",
  "membershipEvidenceHash",
  "templateCatalogRef",
  "redactionPolicyRef",
  "validatedServerLimits",
  "policyValidationEvidence",
  "operatorOptIn",
  "productionDenied",
] as const);

const REQUIRED_ROOT_KEYS = Object.freeze(
  ROOT_KEYS.filter(
    (key) => key !== "presentationTokenEncryptionKeyRef" && key !== "presentationTokenRetention",
  ),
);
const ROOT_KEY_SET = new Set<string>(ROOT_KEYS);
const HASH = /^sha256:[a-f0-9]{64}$/u;
const SECRET_REF = /^secret-ref:[A-Za-z0-9._/-]+$/u;
const FORBIDDEN_SECRET_KEY =
  /^(?:clientSecret|accessToken|password|botToken|apiToken|privateKey|secretValue)$/iu;
const FORBIDDEN_SECRET_VALUE = /^(?:Bearer|Basic)\s+/iu;

function record(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function hasForbiddenSecret(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasForbiddenSecret);
  const candidate = record(value);
  if (candidate) {
    return Object.entries(candidate).some(
      ([key, nested]) => FORBIDDEN_SECRET_KEY.test(key) || hasForbiddenSecret(nested),
    );
  }
  return typeof value === "string" && FORBIDDEN_SECRET_VALUE.test(value);
}

function shape(condition: boolean): asserts condition {
  if (!condition) throw new Error("MATTERMOST_PILOT_SHAPE_INVALID");
}

function requireHash(value: unknown): void {
  shape(typeof value === "string" && HASH.test(value));
}

function requireVersionedHashRef(value: unknown): void {
  const candidate = record(value);
  shape(candidate !== undefined);
  shape(isNonEmptyString(candidate.key));
  shape(
    typeof candidate.version === "string" &&
      /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(candidate.version),
  );
  requireHash(candidate.hash);
}

function requirePinnedRef(value: unknown): void {
  const candidate = record(value);
  shape(candidate !== undefined && isNonEmptyString(candidate.id));
  shape(Number.isInteger(candidate.version) && Number(candidate.version) >= 1);
  requireHash(candidate.digest);
}

function validateRootShape(candidate: JsonRecord): void {
  shape(Object.keys(candidate).every((key) => ROOT_KEY_SET.has(key)));
  shape(REQUIRED_ROOT_KEYS.every((key) => Object.hasOwn(candidate, key)));
  shape(candidate.schemaVersion === "mattermost-pilot-metadata@1.0.0");
  shape(
    isNonEmptyString(candidate.contourKey) &&
      /^[a-z0-9][a-z0-9._-]{0,127}$/u.test(candidate.contourKey),
  );
  shape(
    candidate.environmentClass === "LOCAL" ||
      candidate.environmentClass === "DEVELOPMENT" ||
      candidate.environmentClass === "TEST",
  );
  shape(isNonEmptyString(candidate.workspaceId) && isNonEmptyString(candidate.projectId));
  shape(candidate.operatorOptIn === true && candidate.productionDenied === true);
  shape(
    candidate.callbackAuthentication === "DISABLED" ||
      candidate.callbackAuthentication === "AWP_OPAQUE_INTENT" ||
      candidate.callbackAuthentication === "SIGNED_PROXY_HMAC_PLUS_AWP_INTENT",
  );
  shape(isNonEmptyString(candidate.teamId) && isNonEmptyString(candidate.botUserId));
  requireHash(candidate.credentialIdentityFingerprint);
  requireHash(candidate.membershipEvidenceHash);

  const server = record(candidate.server);
  shape(
    server !== undefined &&
      isNonEmptyString(server.baseUrl) &&
      isNonEmptyString(server.buildVersion),
  );
  shape(
    server.apiFamily === "v4" &&
      isNonEmptyString(server.tlsOwner) &&
      isNonEmptyString(server.networkOwner),
  );
  if (candidate.environmentClass === "LOCAL")
    shape(
      /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?(?:\/|$)/u.test(server.baseUrl),
    );
  else shape(server.baseUrl.startsWith("https://"));

  requireVersionedHashRef(candidate.bootstrapContinuationRef);
  requireVersionedHashRef(candidate.bootstrapValidationEvidenceRef);
  requirePinnedRef(candidate.projectConnectionRef);
  requirePinnedRef(candidate.profileRef);
  requirePinnedRef(candidate.profileValidationReportRef);
  requireVersionedHashRef(candidate.secretRevocationProcedureRef);
  requireVersionedHashRef(candidate.identityBindingSourceRef);
  requireVersionedHashRef(candidate.membershipSourceRef);
  requireVersionedHashRef(candidate.templateCatalogRef);
  requireVersionedHashRef(candidate.redactionPolicyRef);

  shape(Array.isArray(candidate.ingressContractRefs) && candidate.ingressContractRefs.length <= 2);
  for (const reference of candidate.ingressContractRefs) requireVersionedHashRef(reference);
  shape(
    Array.isArray(candidate.projectCredentialSecretRefs) &&
      candidate.projectCredentialSecretRefs.length >= 1,
  );
  shape(
    candidate.projectCredentialSecretRefs.every(
      (reference) => typeof reference === "string" && SECRET_REF.test(reference),
    ),
  );
  shape(
    Array.isArray(candidate.channelIds) &&
      candidate.channelIds.length >= 1 &&
      candidate.channelIds.every(isNonEmptyString),
  );
  shape(new Set(candidate.channelIds).size === candidate.channelIds.length);
  shape(isNonEmptyString(candidate.secretRotationOwner));
  shape(
    record(candidate.validatedServerLimits) !== undefined &&
      record(candidate.policyValidationEvidence) !== undefined,
  );
}

function validateScope(candidate: JsonRecord): void {
  const key = record(candidate.presentationTokenEncryptionKeyRef);
  if (candidate.callbackAuthentication === "DISABLED") {
    if (
      candidate.ingressContractRefs !== undefined &&
      Array.isArray(candidate.ingressContractRefs) &&
      candidate.ingressContractRefs.length > 0
    ) {
      throw new Error("MATTERMOST_PILOT_CALLBACK_DISABLED_INVALID");
    }
    if (key || candidate.presentationTokenRetention !== undefined)
      throw new Error("MATTERMOST_PILOT_CALLBACK_DISABLED_INVALID");
    return;
  }
  if (
    !key ||
    candidate.presentationTokenRetention === undefined ||
    !Array.isArray(candidate.ingressContractRefs) ||
    candidate.ingressContractRefs.length !== 2
  ) {
    throw new Error("MATTERMOST_PILOT_CALLBACK_METADATA_REQUIRED");
  }
  if (
    key.workspaceId !== candidate.workspaceId ||
    key.projectId !== candidate.projectId ||
    key.environmentClass !== candidate.environmentClass
  ) {
    throw new Error("MATTERMOST_PILOT_SCOPE_MISMATCH");
  }
}

function validatePresentationKey(candidate: JsonRecord): void {
  if (candidate.callbackAuthentication === "DISABLED") return;
  const key = record(candidate.presentationTokenEncryptionKeyRef);
  shape(key !== undefined);
  shape(isNonEmptyString(key.keyId) && Number.isInteger(key.version) && Number(key.version) >= 1);
  shape(key.purpose === "INTERACTION_PRESENTATION_AEAD" && isNonEmptyString(key.decryptUntil));
  requireHash(key.keyIdentityFingerprint);
  requireHash(key.metadataHash);
  if (key.keyIdentityFingerprint === candidate.credentialIdentityFingerprint)
    throw new Error("MATTERMOST_PILOT_PRESENTATION_KEY_ALIAS");
  if (Number.isNaN(Date.parse(key.decryptUntil)))
    throw new Error("MATTERMOST_PILOT_PRESENTATION_KEY_INVALID");
}

function validateRetention(candidate: JsonRecord): void {
  if (candidate.callbackAuthentication === "DISABLED") return;
  const retention = record(candidate.presentationTokenRetention);
  shape(retention !== undefined);
  requireVersionedHashRef(retention.policyRef);
  requireVersionedHashRef(retention.validationEvidenceRef);
  const maximum = Number(retention.maxCapsuleLifetimeSeconds);
  const sweep = Number(retention.expirySweepIntervalSeconds);
  const purge = Number(retention.expiryPurgeSlaSeconds);
  const wal = Number(retention.walRetentionMaxSeconds);
  const backup = Number(retention.backupRetentionMaxSeconds);
  const keyDisable = Number(retention.keyDisableSlaSeconds);
  if (
    ![maximum, sweep, purge, wal, backup, keyDisable].every(Number.isInteger) ||
    maximum < 30 ||
    sweep < 1 ||
    purge < 1 ||
    sweep > purge ||
    retention.terminalPurgeSlaSeconds !== 0 ||
    wal < maximum ||
    backup < wal ||
    keyDisable < 0
  ) {
    throw new Error("MATTERMOST_PILOT_RETENTION_INVALID");
  }
}

function validateReconciliation(candidate: JsonRecord): void {
  const limits = record(candidate.validatedServerLimits);
  shape(limits !== undefined);
  const integers = [
    limits.requestTimeoutMs,
    limits.maxRequestsPerMinute,
    limits.maxMessageCharacters,
    limits.maxRetryAfterSeconds,
  ];
  shape(integers.every((value) => Number.isInteger(value) && Number(value) >= 0));
  const capabilities = [
    "retryAfterSupported",
    "mentionsSupported",
    "directMessagesSupported",
    "interactiveDialogsSupported",
    "interactiveMessagesSupported",
    "pendingPostIdLookupSupported",
    "effectMarkerLookupSupported",
  ];
  shape(capabilities.every((key) => typeof limits[key] === "boolean"));
  if (
    candidate.callbackAuthentication !== "DISABLED" &&
    limits.pendingPostIdLookupSupported !== true &&
    limits.effectMarkerLookupSupported !== true
  ) {
    throw new Error("MATTERMOST_PILOT_RECONCILIATION_UNSUPPORTED");
  }
}

export function validateMattermostPilotMetadataPackage(
  value: unknown,
): MattermostPilotMetadataPackage {
  if (hasForbiddenSecret(value)) throw new Error("MATTERMOST_PILOT_SECRET_MATERIAL_FORBIDDEN");
  const candidate = record(value);
  shape(candidate !== undefined);
  if (candidate.environmentClass === "PRODUCTION" || candidate.productionDenied === false)
    throw new Error("MATTERMOST_PILOT_PRODUCTION_FORBIDDEN");
  validateRootShape(candidate);
  validateScope(candidate);
  validatePresentationKey(candidate);
  validateRetention(candidate);
  validateReconciliation(candidate);
  return Object.freeze(structuredClone(candidate)) as unknown as MattermostPilotMetadataPackage;
}
