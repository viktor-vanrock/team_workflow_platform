import {
  type QaActor,
  qaAggregateSnapshotHash,
  type QaContentHash,
  QaDomainError,
  type QaExactReference,
  type QaHumanActor,
} from "./primitives.ts";

export type QaAutomationLogicalRole = "SOURCE_CONTEXT" | "TEST_EXECUTION" | "ARTIFACT_SOURCE";
export type QaAutomationCapabilityKey =
  "source-context.read" | "test-executor.trigger-status" | "artifact.ci-read";

const requiredRoles = Object.freeze([
  "SOURCE_CONTEXT",
  "TEST_EXECUTION",
  "ARTIFACT_SOURCE",
] as const);

const capabilityForRole: Readonly<Record<QaAutomationLogicalRole, QaAutomationCapabilityKey>> =
  Object.freeze({
    SOURCE_CONTEXT: "source-context.read",
    TEST_EXECUTION: "test-executor.trigger-status",
    ARTIFACT_SOURCE: "artifact.ci-read",
  });

function hash(value: unknown): value is QaContentHash {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

const automationCapabilities = Object.freeze([
  "source-context.read@1.0.0",
  "test-executor.trigger-status@1.0.0",
  "artifact.ci-read@1.0.0",
] as const);

export type QaAutomationCapabilityRequirement = (typeof automationCapabilities)[number];
export type QaAutomationTargetType = "MERGE_REQUEST" | "COMMIT" | "BUILD";

export interface QaAutomationSuiteHeader {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly suiteKey: string;
  readonly currentPublishedVersion: number | null;
  readonly currentPublishedVersionId: string | null;
  readonly resourceVersion: number;
  readonly createdBy: QaHumanActor;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface QaAutomationSuiteContent {
  readonly ownerPrincipalId: string;
  readonly suiteDefinitionRef: QaExactReference;
  readonly logicalExecutionContract: Readonly<{
    pipelineKey: string;
    sourceRefPolicyRef: string;
    resultJobKey: string;
    contractHash: QaContentHash;
  }>;
  readonly allowedTargetTypes: readonly QaAutomationTargetType[];
  readonly allowedEnvironmentRefs: readonly string[];
  readonly parameterSchemaRef: QaExactReference;
  readonly resultSchemaRef: QaExactReference;
  readonly artifactPolicyRef: QaExactReference;
  readonly retryPolicyRef: QaExactReference;
  readonly quarantinePolicyRef: QaExactReference;
  readonly capabilityRequirements: readonly QaAutomationCapabilityRequirement[];
}

export interface QaAutomationSuiteVersion {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly suiteBindingId: string;
  readonly suiteKey: string;
  readonly version: number;
  readonly state: "DRAFT" | "VALIDATED" | "PUBLISHED" | "RETIRED";
  readonly content: QaAutomationSuiteContent;
  readonly contentHash: QaContentHash;
  readonly validationReportId: string | null;
  readonly validationReportContentHash: QaContentHash | null;
  readonly createdBy: QaHumanActor;
  readonly createdAt: string;
  readonly publishedAt: string | null;
  readonly retiredAt: string | null;
}

export const qaAutomationSuiteValidationCheckOrder = Object.freeze([
  "PROJECT_SCOPE",
  "IDENTITY_SEPARATION",
  "LEAST_PRIVILEGE",
  "SOURCE_REF_POLICY",
  "CI_LINT_DRY_RUN",
  "NON_PRODUCTION_TARGET",
  "NO_DEPLOY_SURFACE",
  "RESULT_SCHEMA",
  "ARTIFACT_POLICY",
  "RETRY_POLICY",
] as const);

export type QaAutomationSuiteValidationCheckKey =
  (typeof qaAutomationSuiteValidationCheckOrder)[number];

export interface QaAutomationSuiteValidationReport {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly suiteBindingRef: QaExactReference;
  readonly status: "VALID" | "INVALID";
  readonly coreBindingRef: QaExactReference;
  readonly profilePinSetHash: QaContentHash;
  readonly discoverySnapshotRef: string;
  readonly discoverySnapshotHash: QaContentHash;
  readonly suiteProbeRef: string;
  readonly suiteProbeHash: QaContentHash;
  readonly checks: readonly Readonly<{
    key: QaAutomationSuiteValidationCheckKey;
    passed: boolean;
  }>[];
  readonly issues: readonly Readonly<{ code: string; path: string; evidenceRef?: string }>[];
  readonly validatedBy: QaActor;
  readonly authorizationBasisHash: QaContentHash;
  readonly createdAt: string;
  readonly contentHash: QaContentHash;
}

export interface QaAutomationSuitePublicationEvidence {
  readonly coreBindingRef: QaExactReference;
  readonly profilePinSetHash: QaContentHash;
  readonly discoverySnapshotHash: QaContentHash;
  readonly suiteProbeHash: QaContentHash;
  readonly discoveryCurrent: boolean;
  readonly nonProduction: boolean;
  readonly noDeploySurface: boolean;
}

function nonEmpty(value: string): boolean {
  return value.trim().length > 0;
}

function validAt(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}

function sameExact(left: QaExactReference, right: QaExactReference): boolean {
  return (
    left.id === right.id && left.version === right.version && left.contentHash === right.contentHash
  );
}

function assertExact(ref: QaExactReference, code: string): void {
  if (!exact(ref)) throw new QaDomainError(code);
}

function assertSuiteContent(content: QaAutomationSuiteContent): void {
  assertExact(content.suiteDefinitionRef, "QA_AUTOMATION_SUITE_DEFINITION_INVALID");
  assertExact(content.parameterSchemaRef, "QA_AUTOMATION_SUITE_PARAMETER_SCHEMA_INVALID");
  assertExact(content.resultSchemaRef, "QA_AUTOMATION_SUITE_RESULT_SCHEMA_INVALID");
  assertExact(content.artifactPolicyRef, "QA_AUTOMATION_SUITE_ARTIFACT_POLICY_INVALID");
  assertExact(content.retryPolicyRef, "QA_AUTOMATION_SUITE_RETRY_POLICY_INVALID");
  assertExact(content.quarantinePolicyRef, "QA_AUTOMATION_SUITE_QUARANTINE_POLICY_INVALID");
  const logical = content.logicalExecutionContract;
  if (
    !nonEmpty(content.ownerPrincipalId) ||
    !/^[a-z][a-z0-9._-]{0,127}$/u.test(logical.pipelineKey) ||
    !nonEmpty(logical.sourceRefPolicyRef) ||
    !/^[a-z][a-z0-9._-]{0,127}$/u.test(logical.resultJobKey) ||
    !hash(logical.contractHash)
  )
    throw new QaDomainError("QA_AUTOMATION_SUITE_LOGICAL_CONTRACT_INVALID");
  const targets = new Set(content.allowedTargetTypes);
  if (
    targets.size !== content.allowedTargetTypes.length ||
    targets.size < 1 ||
    [...targets].some((target) => !["MERGE_REQUEST", "COMMIT", "BUILD"].includes(target))
  ) {
    throw new QaDomainError("QA_AUTOMATION_SUITE_TARGET_TYPES_INVALID");
  }
  const environments = new Set(content.allowedEnvironmentRefs);
  if (
    environments.size !== content.allowedEnvironmentRefs.length ||
    environments.size < 1 ||
    [...environments].some((value) => !nonEmpty(value) || /prod(?:uction)?/iu.test(value))
  ) {
    throw new QaDomainError("QA_AUTOMATION_SUITE_ENVIRONMENTS_INVALID");
  }
  if (
    content.capabilityRequirements.length !== automationCapabilities.length ||
    automationCapabilities.some(
      (capability) => !content.capabilityRequirements.includes(capability),
    )
  ) {
    throw new QaDomainError("QA_AUTOMATION_SUITE_CAPABILITIES_INVALID");
  }
}

export function createAutomationSuiteHeader(
  input: Readonly<{
    id: string;
    workspaceId: string;
    projectId: string;
    suiteKey: string;
    createdBy: QaHumanActor;
    createdAt: string;
  }>,
): QaAutomationSuiteHeader {
  if (
    !nonEmpty(input.id) ||
    !nonEmpty(input.workspaceId) ||
    !nonEmpty(input.projectId) ||
    !/^[a-z][a-z0-9._-]{0,127}$/u.test(input.suiteKey) ||
    input.createdBy.kind !== "HUMAN" ||
    !nonEmpty(input.createdBy.principalId) ||
    !validAt(input.createdAt)
  )
    throw new QaDomainError("QA_AUTOMATION_SUITE_HEADER_INVALID");
  return deepFreeze({
    ...structuredClone(input),
    currentPublishedVersion: null,
    currentPublishedVersionId: null,
    resourceVersion: 1,
    updatedAt: input.createdAt,
  });
}

export function createAutomationSuiteDraft(
  input: Readonly<{
    header: QaAutomationSuiteHeader;
    previousVersions: readonly QaAutomationSuiteVersion[];
    content: QaAutomationSuiteContent;
    createdBy: QaHumanActor;
    createdAt: string;
  }>,
): QaAutomationSuiteVersion {
  if (input.createdBy.kind !== "HUMAN" || !validAt(input.createdAt))
    throw new QaDomainError("QA_AUTOMATION_SUITE_DRAFT_INVALID");
  if (
    input.previousVersions.some(
      (version) =>
        version.workspaceId !== input.header.workspaceId ||
        version.projectId !== input.header.projectId ||
        version.suiteBindingId !== input.header.id,
    )
  ) {
    throw new QaDomainError("QA_AUTOMATION_SUITE_SCOPE_MISMATCH");
  }
  assertSuiteContent(input.content);
  const content = deepFreeze(structuredClone(input.content));
  const contentHash = qaAggregateSnapshotHash(content as never);
  if (input.previousVersions.some((version) => version.contentHash === contentHash))
    throw new QaDomainError("QA_AUTOMATION_SUITE_CONTENT_ALREADY_EXISTS");
  const ordered = [...input.previousVersions].sort((left, right) => left.version - right.version);
  if (ordered.some((version, index) => version.version !== index + 1))
    throw new QaDomainError("QA_AUTOMATION_SUITE_VERSION_SEQUENCE_INVALID");
  const version = ordered.length + 1;
  return deepFreeze({
    id: `${input.header.id}:v${version}`,
    workspaceId: input.header.workspaceId,
    projectId: input.header.projectId,
    suiteBindingId: input.header.id,
    suiteKey: input.header.suiteKey,
    version,
    state: "DRAFT",
    content,
    contentHash,
    validationReportId: null,
    validationReportContentHash: null,
    createdBy: structuredClone(input.createdBy),
    createdAt: input.createdAt,
    publishedAt: null,
    retiredAt: null,
  });
}

type QaAutomationSuiteValidationReportInput = Omit<
  QaAutomationSuiteValidationReport,
  "contentHash"
>;

export function recordAutomationSuiteValidation(
  version: QaAutomationSuiteVersion,
  reportInput: QaAutomationSuiteValidationReportInput,
): Readonly<{ version: QaAutomationSuiteVersion; report: QaAutomationSuiteValidationReport }> {
  if (version.state !== "DRAFT")
    throw new QaDomainError("QA_AUTOMATION_SUITE_VALIDATION_STATE_INVALID");
  if (
    reportInput.workspaceId !== version.workspaceId ||
    reportInput.projectId !== version.projectId ||
    !sameExact(reportInput.suiteBindingRef, {
      id: version.id,
      version: version.version,
      contentHash: version.contentHash,
    })
  )
    throw new QaDomainError("QA_AUTOMATION_SUITE_VALIDATION_SUBJECT_MISMATCH");
  if (
    !nonEmpty(reportInput.id) ||
    !nonEmpty(reportInput.discoverySnapshotRef) ||
    !nonEmpty(reportInput.suiteProbeRef) ||
    !validAt(reportInput.createdAt)
  ) {
    throw new QaDomainError("QA_AUTOMATION_SUITE_VALIDATION_REPORT_INVALID");
  }
  for (const ref of [reportInput.coreBindingRef])
    assertExact(ref, "QA_AUTOMATION_SUITE_VALIDATION_REPORT_INVALID");
  for (const digest of [
    reportInput.profilePinSetHash,
    reportInput.discoverySnapshotHash,
    reportInput.suiteProbeHash,
    reportInput.authorizationBasisHash,
  ]) {
    if (!hash(digest)) throw new QaDomainError("QA_AUTOMATION_SUITE_VALIDATION_REPORT_INVALID");
  }
  if (
    reportInput.checks.length !== qaAutomationSuiteValidationCheckOrder.length ||
    reportInput.checks.some(
      (check, index) => check.key !== qaAutomationSuiteValidationCheckOrder[index],
    )
  ) {
    throw new QaDomainError("QA_AUTOMATION_SUITE_VALIDATION_CHECKS_INVALID");
  }
  if (
    reportInput.status === "VALID" &&
    (reportInput.issues.length > 0 || reportInput.checks.some(({ passed }) => !passed))
  ) {
    throw new QaDomainError("QA_AUTOMATION_SUITE_VALIDATION_EVIDENCE_INVALID");
  }
  if (
    reportInput.status === "INVALID" &&
    reportInput.issues.length === 0 &&
    reportInput.checks.every(({ passed }) => passed)
  ) {
    throw new QaDomainError("QA_AUTOMATION_SUITE_VALIDATION_EVIDENCE_INVALID");
  }
  const reportBody = deepFreeze(structuredClone(reportInput));
  const report = deepFreeze({
    ...reportBody,
    contentHash: qaAggregateSnapshotHash(reportBody as never),
  });
  const nextVersion =
    report.status === "VALID"
      ? deepFreeze({
          ...version,
          state: "VALIDATED" as const,
          validationReportId: report.id,
          validationReportContentHash: report.contentHash,
        })
      : version;
  return deepFreeze({ version: nextVersion, report });
}

function publicationEvidenceMatches(
  report: QaAutomationSuiteValidationReport,
  evidence: QaAutomationSuitePublicationEvidence,
): boolean {
  return (
    sameExact(report.coreBindingRef, evidence.coreBindingRef) &&
    report.profilePinSetHash === evidence.profilePinSetHash &&
    report.discoverySnapshotHash === evidence.discoverySnapshotHash &&
    report.suiteProbeHash === evidence.suiteProbeHash &&
    evidence.discoveryCurrent &&
    evidence.nonProduction &&
    evidence.noDeploySurface
  );
}

export function publishAutomationSuiteVersion(
  input: Readonly<{
    header: QaAutomationSuiteHeader;
    versions: readonly QaAutomationSuiteVersion[];
    reports: readonly QaAutomationSuiteValidationReport[];
    versionId: string;
    expectedResourceVersion: number;
    evidence: QaAutomationSuitePublicationEvidence;
    publishedAt: string;
  }>,
): Readonly<{ header: QaAutomationSuiteHeader; versions: readonly QaAutomationSuiteVersion[] }> {
  if (input.header.resourceVersion !== input.expectedResourceVersion)
    throw new QaDomainError("QA_AUTOMATION_SUITE_STALE_VERSION");
  if (!validAt(input.publishedAt))
    throw new QaDomainError("QA_AUTOMATION_SUITE_PUBLICATION_TIME_INVALID");
  const selected = input.versions.find(({ id }) => id === input.versionId);
  if (
    !selected ||
    selected.state !== "VALIDATED" ||
    selected.validationReportId === null ||
    selected.validationReportContentHash === null
  ) {
    throw new QaDomainError("QA_AUTOMATION_SUITE_PUBLICATION_STATE_INVALID");
  }
  if (
    selected.workspaceId !== input.header.workspaceId ||
    selected.projectId !== input.header.projectId ||
    selected.suiteBindingId !== input.header.id
  ) {
    throw new QaDomainError("QA_AUTOMATION_SUITE_SCOPE_MISMATCH");
  }
  const report = input.reports.find(({ id }) => id === selected.validationReportId);
  if (
    !report ||
    report.status !== "VALID" ||
    report.contentHash !== selected.validationReportContentHash ||
    !sameExact(report.suiteBindingRef, {
      id: selected.id,
      version: selected.version,
      contentHash: selected.contentHash,
    }) ||
    !publicationEvidenceMatches(report, input.evidence)
  )
    throw new QaDomainError("QA_AUTOMATION_SUITE_PUBLICATION_EVIDENCE_STALE");

  const versions = deepFreeze(
    input.versions.map((version) => {
      if (version.id === selected.id)
        return { ...version, state: "PUBLISHED" as const, publishedAt: input.publishedAt };
      if (version.state === "PUBLISHED")
        return { ...version, state: "RETIRED" as const, retiredAt: input.publishedAt };
      return structuredClone(version);
    }),
  );
  const header = deepFreeze({
    ...input.header,
    currentPublishedVersion: selected.version,
    currentPublishedVersionId: selected.id,
    resourceVersion: input.header.resourceVersion + 1,
    updatedAt: input.publishedAt,
  });
  return deepFreeze({ header, versions });
}

export interface QaAutomationSuiteBinding {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly suiteKey: string;
  readonly version: number;
  readonly state: "DRAFT" | "VALIDATED" | "PUBLISHED" | "RETIRED";
  readonly ownerPrincipalId: string;
  readonly definitionRef: QaExactReference;
  readonly contentHash: QaContentHash;
}

export function createAutomationSuiteBinding(
  input: QaAutomationSuiteBinding,
): QaAutomationSuiteBinding {
  if (
    !input.id ||
    !input.workspaceId ||
    !input.projectId ||
    !/^[a-z][a-z0-9._-]{0,127}$/u.test(input.suiteKey) ||
    !Number.isInteger(input.version) ||
    input.version < 1 ||
    !input.ownerPrincipalId ||
    !input.definitionRef.id ||
    input.definitionRef.version < 1 ||
    !hash(input.definitionRef.contentHash) ||
    !hash(input.contentHash)
  )
    throw new QaDomainError("QA_AUTOMATION_SUITE_BINDING_INVALID");
  return deepFreeze(structuredClone(input));
}

export interface QaAutomationConfigurationPin {
  readonly ordinal: number;
  readonly logicalRole: QaAutomationLogicalRole;
  readonly capabilityKey: QaAutomationCapabilityKey;
  readonly exactContractVersion: "1.0.0";
  readonly profileRef: QaExactReference;
  readonly connectionRef: QaExactReference;
  readonly validationReportRef: QaExactReference;
}

export interface QaAutomationSessionFoundation {
  readonly sessionId: string;
  readonly suiteBindingRef: QaExactReference;
  readonly configurationPins: readonly QaAutomationConfigurationPin[];
  readonly configurationPinSetHash: QaContentHash;
}

function exact(ref: QaExactReference): boolean {
  return (
    ref.id.length > 0 && Number.isInteger(ref.version) && ref.version > 0 && hash(ref.contentHash)
  );
}

export function createAutomationSessionFoundation(
  input: Readonly<{
    sessionId: string;
    suiteBindingRefs: readonly QaExactReference[];
    configurationPins: readonly QaAutomationConfigurationPin[];
  }>,
): QaAutomationSessionFoundation {
  if (!input.sessionId) throw new QaDomainError("QA_AUTOMATION_SESSION_INVALID");
  if (input.suiteBindingRefs.length !== 1 || !exact(input.suiteBindingRefs[0]!)) {
    throw new QaDomainError("QA_AUTOMATION_SUITE_EXACTLY_ONE_REQUIRED");
  }
  if (input.configurationPins.length !== requiredRoles.length) {
    throw new QaDomainError("QA_AUTOMATION_CONFIGURATION_PINS_INCOMPLETE");
  }
  const pins = [...input.configurationPins].sort((left, right) => left.ordinal - right.ordinal);
  for (let index = 0; index < requiredRoles.length; index += 1) {
    const pin = pins[index]!;
    const role = requiredRoles[index]!;
    if (
      pin.ordinal !== index + 1 ||
      pin.logicalRole !== role ||
      pin.capabilityKey !== capabilityForRole[role] ||
      pin.exactContractVersion !== "1.0.0" ||
      !exact(pin.profileRef) ||
      !exact(pin.connectionRef) ||
      !exact(pin.validationReportRef)
    )
      throw new QaDomainError("QA_AUTOMATION_CONFIGURATION_PINS_INVALID");
  }
  const configurationPins = deepFreeze(structuredClone(pins));
  return deepFreeze({
    sessionId: input.sessionId,
    suiteBindingRef: structuredClone(input.suiteBindingRefs[0]!),
    configurationPins,
    configurationPinSetHash: qaAggregateSnapshotHash(configurationPins as never),
  });
}
