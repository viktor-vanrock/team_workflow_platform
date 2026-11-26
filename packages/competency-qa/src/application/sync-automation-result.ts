import { createHash } from "node:crypto";

import { canonicalClassificationReference } from "@awp/platform-contracts";

import {
  appendAutomationAttemptStatus,
  createQaAutomationAttemptResult,
  type QaAutomationArtifactSyncState,
  type QaAutomationAttemptRecord,
  type QaAutomationAttemptResult,
  type QaAutomationAttemptStatusRevision,
  type QaAutomationNormalizationIssueCode,
  type QaAutomationProviderStatus,
  type QaAutomationResultTarget,
  type QaAutomationTechnicalResult,
} from "../domain/automation-attempt.ts";
import {
  qaAggregateSnapshotHash,
  type QaContentHash,
  QaDomainError,
  qaScopeFromContext,
  type QaWorkspaceContext,
} from "../domain/primitives.ts";
import type { QaAutomatedTargetSnapshot } from "../domain/snapshots.ts";
import { qaAutomationFlakySuspected } from "./automation-retry-policy.ts";
import {
  buildQaAutomationArtifactRegisteredEvent,
  buildQaAutomationAttemptCompletedEvent,
  buildQaAutomationAttemptStatusObservedEvent,
  type QaDomainEventEnvelope,
} from "./domain-events.ts";

export interface QaAutomationTerminalObservation {
  readonly externalPipelineId: string;
  readonly externalJobIds: readonly string[];
  readonly providerStatus: Exclude<QaAutomationProviderStatus, "NOT_OBSERVED">;
  readonly providerRevisionToken: string;
  readonly providerUpdatedAt: string;
  readonly terminal: true;
  readonly observedAt: string;
  readonly observationHash: QaContentHash;
  readonly source: "POLL_READ" | "RECONCILIATION_READ";
  readonly sourceReceiptRef: string;
}

export interface QaAutomationNormalizedResultInput {
  readonly normalizationKind: "SCHEMA_VALIDATED" | "SYNTHETIC_INCOMPLETE";
  readonly normalizationStatus: "VALID" | "INVALID" | "MISSING";
  readonly issueCodes: readonly QaAutomationNormalizationIssueCode[];
  readonly syntheticReasonCode?: QaAutomationNormalizationIssueCode;
  readonly outcome: QaAutomationTechnicalResult;
  readonly resultSchemaRef: Readonly<{ id: string; version: number; digest: QaContentHash }>;
  readonly observedResultSchemaRef?: Readonly<{
    id: string;
    version: number;
    digest: QaContentHash;
  }>;
  readonly sourceResultArtifactRef?: string;
  readonly resultContentHash?: QaContentHash;
  readonly externalPipelineId?: string;
  readonly externalJobIds?: readonly string[];
  readonly target?: QaAutomationResultTarget;
  readonly suiteKey: string;
  readonly environmentRef: string;
  readonly durationMs?: number;
  readonly infrastructureCode?: string;
  readonly cancellationReasonCode?: string;
  readonly terminalAt: string;
}

export type QaAutomationArtifactAvailability =
  "AVAILABLE" | "MISSING" | "EXPIRED" | "CHECKSUM_MISMATCH";

export interface QaAutomationArtifactDescriptorInput {
  readonly artifactReferenceId: string;
  readonly descriptorHash: QaContentHash;
  readonly externalPipelineId: string;
  readonly externalJobId: string;
  readonly logicalPath: string;
  readonly checksum: QaContentHash;
  readonly checksumSource: "MACHINE_RESULT_MANIFEST" | "CONNECTOR_CONTENT_SHA256";
  readonly sizeBytes: number;
  readonly mediaType: string;
  readonly fileName: string;
  readonly artifactKind: "RESULT" | "REPORT" | "LOG" | "SCREENSHOT" | "TRACE" | "OTHER";
  readonly classificationKey: "PUBLIC" | "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED";
  readonly sourceProfileRef: Readonly<{ id: string; version: number }>;
  readonly sourceProfileContentHash: QaContentHash;
  readonly retentionPolicyRef: string;
  readonly availability: QaAutomationArtifactAvailability;
  readonly opaqueLocatorHash: QaContentHash;
  readonly expiresAt: string;
  readonly registeredAt: string;
}

export interface QaAutomationMachineArtifactManifestEntry {
  readonly path: string;
  readonly mediaType: string;
  readonly byteSize: number;
  readonly checksum: QaContentHash;
  readonly classification: "PUBLIC" | "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED";
  readonly expiresAt: string;
}

export interface QaAutomationCoreArtifactReferenceRegistration {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly owner: Readonly<{ entityType: "AUTOMATION_ATTEMPT"; entityId: string }>;
  readonly artifactKind: string;
  readonly storage: Readonly<{
    providerKind: "GITLAB_CI";
    opaqueLocator: string;
    objectVersionOrEtag: QaContentHash;
  }>;
  readonly fileName: string;
  readonly mediaType: string;
  readonly sizeBytes: number;
  readonly checksum: Readonly<{ algorithm: "SHA256"; value: QaContentHash }>;
  readonly classification: Readonly<{ key: string; rank: number }>;
  readonly availability: "AVAILABLE" | "EXPIRED" | "QUARANTINED" | "UNAVAILABLE";
  readonly createdBy: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

export interface QaAutomationArtifactMembership {
  readonly membershipId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly workItemId: string;
  readonly testSessionId: string;
  readonly automationAttemptId: string;
  readonly automationAttemptResultId: string;
  readonly artifactDescriptorSetHash: QaContentHash;
  readonly ordinal: number;
  readonly artifactReferenceId: string;
  readonly externalAuthorityHash: QaContentHash;
  readonly externalPipelineId: string;
  readonly externalJobId: string;
  readonly logicalPath: string;
  readonly externalDescriptorHash: QaContentHash;
  readonly checksum: QaContentHash;
  readonly checksumSource: "MACHINE_RESULT_MANIFEST" | "CONNECTOR_CONTENT_SHA256";
  readonly sizeBytes: number;
  readonly mediaType: string;
  readonly artifactKind: QaAutomationArtifactDescriptorInput["artifactKind"];
  readonly classificationKey: QaAutomationArtifactDescriptorInput["classificationKey"];
  readonly sourceProfileRef: Readonly<{ id: string; version: number }>;
  readonly sourceProfileContentHash: QaContentHash;
  readonly retentionPolicyRef: string;
  readonly availabilityAtResult: QaAutomationArtifactAvailability;
  readonly opaqueLocatorHash: QaContentHash;
  readonly expiresAt: string;
  readonly registeredAt: string;
  readonly correlationId: string;
  readonly causationId: string;
  readonly contentHash: QaContentHash;
}

export interface QaAutomationResultSyncPreparation {
  readonly attempt: QaAutomationAttemptRecord;
  readonly terminalStatus: QaAutomationAttemptStatusRevision;
  readonly result: QaAutomationAttemptResult;
  readonly artifactReferences: readonly QaAutomationCoreArtifactReferenceRegistration[];
  readonly artifactMemberships: readonly QaAutomationArtifactMembership[];
  readonly session: Readonly<{
    previousState: "RUNNING" | "REVIEW_REQUIRED";
    state: "REVIEW_REQUIRED";
    resourceVersion: number;
    changed: boolean;
  }>;
  readonly reviewFlags: readonly "FLAKY_SUSPECTED"[];
  readonly events: readonly QaDomainEventEnvelope<Readonly<Record<string, unknown>>>[];
}

function deterministicUuid(namespace: string): string {
  const hex = createHash("sha256").update(namespace).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}

function hash(value: string): value is QaContentHash {
  return /^sha256:[a-f0-9]{64}$/u.test(value);
}

function sameSchema(
  left: Readonly<{ id: string; version: number; digest: QaContentHash }>,
  right: Readonly<{ id: string; version: number; digest: QaContentHash }>,
): boolean {
  return left.id === right.id && left.version === right.version && left.digest === right.digest;
}

function targetEqual(
  left: QaAutomationResultTarget | undefined,
  right: QaAutomatedTargetSnapshot["target"],
): boolean {
  return (
    left !== undefined &&
    qaAggregateSnapshotHash(left as never) === qaAggregateSnapshotHash(right as never)
  );
}

function classificationRank(key: QaAutomationArtifactDescriptorInput["classificationKey"]): number {
  return canonicalClassificationReference(key).rank;
}

function coreAvailability(
  value: QaAutomationArtifactAvailability,
): QaAutomationCoreArtifactReferenceRegistration["availability"] {
  if (value === "AVAILABLE") return "AVAILABLE";
  if (value === "EXPIRED") return "EXPIRED";
  if (value === "CHECKSUM_MISMATCH") return "QUARANTINED";
  return "UNAVAILABLE";
}

function artifactSyncState(
  descriptors: readonly QaAutomationArtifactDescriptorInput[],
): QaAutomationArtifactSyncState {
  if (descriptors.length === 0) return "UNAVAILABLE";
  if (descriptors.some(({ availability }) => availability === "EXPIRED")) return "EXPIRED";
  if (descriptors.every(({ availability }) => availability === "AVAILABLE")) return "COMPLETE";
  if (descriptors.some(({ availability }) => availability === "AVAILABLE")) return "PARTIAL";
  return "UNAVAILABLE";
}

function descriptorIssue(
  input: Readonly<{
    descriptors: readonly QaAutomationArtifactDescriptorInput[];
    manifest: readonly QaAutomationMachineArtifactManifestEntry[];
    normalization: QaAutomationNormalizedResultInput;
    observation: QaAutomationTerminalObservation;
    artifactProfile: Readonly<{ id: string; version: number; contentHash: QaContentHash }>;
  }>,
): QaAutomationNormalizationIssueCode | undefined {
  const ids = new Set<string>();
  const paths = new Set<string>();
  for (const descriptor of input.descriptors) {
    if (
      ids.has(descriptor.artifactReferenceId) ||
      paths.has(descriptor.logicalPath) ||
      !hash(descriptor.descriptorHash) ||
      !hash(descriptor.checksum) ||
      !hash(descriptor.opaqueLocatorHash) ||
      descriptor.externalPipelineId !== input.observation.externalPipelineId ||
      !input.observation.externalJobIds.includes(descriptor.externalJobId) ||
      descriptor.sourceProfileRef.id !== input.artifactProfile.id ||
      descriptor.sourceProfileRef.version !== input.artifactProfile.version ||
      descriptor.sourceProfileContentHash !== input.artifactProfile.contentHash ||
      !Number.isSafeInteger(descriptor.sizeBytes) ||
      descriptor.sizeBytes < 0 ||
      Number.isNaN(Date.parse(descriptor.expiresAt)) ||
      Number.isNaN(Date.parse(descriptor.registeredAt))
    )
      return "RESULT_SCOPE_MISMATCH";
    ids.add(descriptor.artifactReferenceId);
    paths.add(descriptor.logicalPath);
    if (descriptor.availability === "CHECKSUM_MISMATCH") return "ARTIFACT_CHECKSUM_MISMATCH";
    if (descriptor.availability === "EXPIRED") return "ARTIFACT_EXPIRED";
    if (descriptor.artifactKind === "RESULT") {
      if (
        descriptor.checksumSource !== "CONNECTOR_CONTENT_SHA256" ||
        descriptor.checksum !== input.normalization.resultContentHash
      )
        return "ARTIFACT_CHECKSUM_MISMATCH";
      continue;
    }
    const expected = input.manifest.filter(({ path }) => path === descriptor.logicalPath);
    const artifact = expected[0];
    if (expected.length !== 1 || !artifact) return "RESULT_SCOPE_MISMATCH";
    if (
      descriptor.checksumSource !== "MACHINE_RESULT_MANIFEST" ||
      descriptor.checksum !== artifact.checksum ||
      descriptor.sizeBytes !== artifact.byteSize
    )
      return "ARTIFACT_CHECKSUM_MISMATCH";
    if (
      descriptor.mediaType !== artifact.mediaType ||
      descriptor.classificationKey !== artifact.classification ||
      descriptor.expiresAt !== artifact.expiresAt
    )
      return "RESULT_SCOPE_MISMATCH";
  }
  const nonResultPaths = input.descriptors
    .filter(({ artifactKind }) => artifactKind !== "RESULT")
    .map(({ logicalPath }) => logicalPath)
    .sort();
  const manifestPaths = input.manifest.map(({ path }) => path).sort();
  if (
    nonResultPaths.length !== manifestPaths.length ||
    nonResultPaths.some((path, index) => path !== manifestPaths[index])
  )
    return "RESULT_SCOPE_MISMATCH";
  if (
    input.normalization.normalizationKind === "SCHEMA_VALIDATED" &&
    input.descriptors.filter(({ artifactKind }) => artifactKind === "RESULT").length !== 1
  )
    return "RESULT_MISSING";
  return undefined;
}

export function prepareQaAutomationResultSync(
  input: Readonly<{
    context: QaWorkspaceContext;
    attempt: QaAutomationAttemptRecord;
    previousStatus: QaAutomationAttemptStatusRevision;
    targetSnapshot: QaAutomatedTargetSnapshot;
    observation: QaAutomationTerminalObservation;
    normalization: QaAutomationNormalizedResultInput;
    artifactDescriptors: readonly QaAutomationArtifactDescriptorInput[];
    machineArtifactManifest: readonly QaAutomationMachineArtifactManifestEntry[];
    previousLineageResults: readonly Readonly<{
      attemptNo: number;
      outcome: QaAutomationTechnicalResult;
    }>[];
    session: Readonly<{ state: "RUNNING" | "REVIEW_REQUIRED"; resourceVersion: number }>;
    recordedAt: string;
  }>,
): QaAutomationResultSyncPreparation {
  const scope = qaScopeFromContext(input.context);
  if (
    input.context.actor.kind !== "SERVICE" ||
    !input.context.actor.principalId ||
    scope.workspaceId !== input.attempt.workspaceId ||
    scope.projectId !== input.attempt.projectId ||
    input.attempt.currentStatus !== "RUNNING" ||
    input.previousStatus.statusRevisionId !== input.attempt.currentStatusRevisionId ||
    input.previousStatus.status !== "RUNNING" ||
    input.targetSnapshot.snapshotHash !== input.attempt.targetSnapshotHash ||
    input.targetSnapshot.testSessionId !== input.attempt.testSessionId ||
    !input.observation.terminal ||
    !hash(input.observation.observationHash) ||
    Number.isNaN(Date.parse(input.recordedAt)) ||
    Date.parse(input.recordedAt) < Date.parse(input.observation.observedAt) ||
    input.session.resourceVersion < 1
  )
    throw new QaDomainError("QA_AUTOMATION_RESULT_SYNC_INPUT_INVALID");
  const artifactPin = input.attempt.configurationPins.find(
    ({ logicalRole }) => logicalRole === "ARTIFACT_SOURCE",
  );
  if (!artifactPin) throw new QaDomainError("QA_AUTOMATION_ARTIFACT_PIN_MISSING");
  const descriptors = Object.freeze(
    [...input.artifactDescriptors].sort(
      (left, right) =>
        left.logicalPath.localeCompare(right.logicalPath) ||
        left.artifactReferenceId.localeCompare(right.artifactReferenceId),
    ),
  );
  let issue = input.normalization.syntheticReasonCode;
  if (!sameSchema(input.normalization.resultSchemaRef, input.attempt.resultSchemaRef))
    issue = "RESULT_SCHEMA_DRIFT";
  else if (
    input.normalization.externalPipelineId !== input.observation.externalPipelineId ||
    input.normalization.suiteKey !== input.targetSnapshot.suite.suiteKey ||
    input.normalization.environmentRef !== input.targetSnapshot.environment.environmentRef ||
    (input.normalization.externalJobIds ?? []).some(
      (jobId) => !input.observation.externalJobIds.includes(jobId),
    )
  )
    issue = "RESULT_SCOPE_MISMATCH";
  else if (
    input.normalization.normalizationKind === "SCHEMA_VALIDATED" &&
    !targetEqual(input.normalization.target, input.targetSnapshot.target)
  )
    issue = "RESULT_TARGET_MISMATCH";
  else
    issue =
      issue ??
      descriptorIssue({
        descriptors,
        manifest: input.machineArtifactManifest,
        normalization: input.normalization,
        observation: input.observation,
        artifactProfile: artifactPin.profileRef,
      });

  const descriptorSetBody = descriptors.map((descriptor, ordinal) => ({
    ordinal: ordinal + 1,
    ...descriptor,
  }));
  const artifactDescriptorSetHash = qaAggregateSnapshotHash(descriptorSetBody as never);
  const resultId = deterministicUuid(
    `qa-automation-result:${input.attempt.workspaceId}:${input.attempt.projectId}:${input.attempt.automationAttemptId}`,
  );
  const synthetic =
    issue !== undefined || input.normalization.normalizationKind === "SYNTHETIC_INCOMPLETE";
  const observedResultSchemaRef =
    issue === "RESULT_SCHEMA_UNKNOWN" || issue === "RESULT_SCHEMA_DRIFT"
      ? (input.normalization.observedResultSchemaRef ?? input.normalization.resultSchemaRef)
      : undefined;
  const result = createQaAutomationAttemptResult({
    automationAttemptResultId: resultId,
    workspaceId: input.attempt.workspaceId,
    projectId: input.attempt.projectId,
    automationAttemptId: input.attempt.automationAttemptId,
    normalizationKind: synthetic ? "SYNTHETIC_INCOMPLETE" : "SCHEMA_VALIDATED",
    outcome: synthetic ? "INCOMPLETE" : input.normalization.outcome,
    resultSchemaRef: input.attempt.resultSchemaRef,
    ...(observedResultSchemaRef === undefined ? {} : { observedResultSchemaRef }),
    ...(input.normalization.sourceResultArtifactRef === undefined
      ? {}
      : { sourceResultArtifactRef: input.normalization.sourceResultArtifactRef }),
    normalizationStatus: synthetic
      ? input.normalization.normalizationStatus === "MISSING" || issue === "RESULT_MISSING"
        ? "MISSING"
        : "INVALID"
      : "VALID",
    normalizationIssueCodes: synthetic ? [issue ?? input.normalization.issueCodes[0]!] : [],
    externalPipelineId: input.observation.externalPipelineId,
    externalJobIds: input.observation.externalJobIds,
    ...(input.normalization.target === undefined ? {} : { target: input.normalization.target }),
    suiteKey: input.targetSnapshot.suite.suiteKey,
    environmentRef: input.targetSnapshot.environment.environmentRef,
    ...(input.normalization.durationMs === undefined
      ? {}
      : { durationMs: input.normalization.durationMs }),
    ...(!synthetic && input.normalization.infrastructureCode !== undefined
      ? { infrastructureCode: input.normalization.infrastructureCode }
      : {}),
    ...(!synthetic && input.normalization.cancellationReasonCode !== undefined
      ? { cancellationReasonCode: input.normalization.cancellationReasonCode }
      : {}),
    ...(synthetic
      ? { syntheticReasonCode: issue ?? input.normalization.syntheticReasonCode! }
      : {}),
    artifactDescriptorSetHash,
    artifactSyncState: artifactSyncState(descriptors),
    terminalAt: input.normalization.terminalAt,
    recordedAt: input.recordedAt,
  });
  const appended = appendAutomationAttemptStatus(input.attempt, input.previousStatus, {
    statusRevisionId: deterministicUuid(
      `qa-automation-terminal-status:${input.attempt.automationAttemptId}:${result.contentHash}`,
    ),
    status: "TERMINAL",
    externalPipelineId: input.observation.externalPipelineId,
    externalJobIds: input.observation.externalJobIds,
    providerStatus: input.observation.providerStatus,
    providerRevisionToken: input.observation.providerRevisionToken,
    providerUpdatedAt: input.observation.providerUpdatedAt,
    source: input.observation.source,
    sourceReceiptRef: input.observation.sourceReceiptRef,
    sourceReceiptHash: input.observation.observationHash,
    terminalResultId: result.automationAttemptResultId,
    terminalResultHash: result.contentHash,
    observedAt: input.observation.observedAt,
    recordedAt: input.recordedAt,
  });
  const memberships: QaAutomationArtifactMembership[] = descriptorSetBody.map((descriptor) => {
    const body = Object.freeze({
      membershipId: deterministicUuid(
        `qa-automation-artifact-membership:${resultId}:${descriptor.artifactReferenceId}`,
      ),
      workspaceId: input.attempt.workspaceId,
      projectId: input.attempt.projectId,
      workItemId: input.attempt.workItemId,
      testSessionId: input.attempt.testSessionId,
      automationAttemptId: input.attempt.automationAttemptId,
      automationAttemptResultId: resultId,
      artifactDescriptorSetHash,
      ordinal: descriptor.ordinal,
      artifactReferenceId: descriptor.artifactReferenceId,
      externalAuthorityHash: input.previousStatus.externalAuthorityHash,
      externalPipelineId: descriptor.externalPipelineId,
      externalJobId: descriptor.externalJobId,
      logicalPath: descriptor.logicalPath,
      externalDescriptorHash: descriptor.descriptorHash,
      checksum: descriptor.checksum,
      checksumSource: descriptor.checksumSource,
      sizeBytes: descriptor.sizeBytes,
      mediaType: descriptor.mediaType,
      artifactKind: descriptor.artifactKind,
      classificationKey: descriptor.classificationKey,
      sourceProfileRef: descriptor.sourceProfileRef,
      sourceProfileContentHash: descriptor.sourceProfileContentHash,
      retentionPolicyRef: descriptor.retentionPolicyRef,
      availabilityAtResult: descriptor.availability,
      opaqueLocatorHash: descriptor.opaqueLocatorHash,
      expiresAt: descriptor.expiresAt,
      registeredAt: descriptor.registeredAt,
      correlationId: input.context.correlationId,
      causationId: input.context.causationId,
    });
    return Object.freeze({ ...body, contentHash: qaAggregateSnapshotHash(body as never) });
  });
  const artifactReferences = descriptors.map(
    (descriptor): QaAutomationCoreArtifactReferenceRegistration =>
      Object.freeze({
        id: descriptor.artifactReferenceId,
        workspaceId: input.attempt.workspaceId,
        projectId: input.attempt.projectId,
        owner: Object.freeze({
          entityType: "AUTOMATION_ATTEMPT" as const,
          entityId: input.attempt.automationAttemptId,
        }),
        artifactKind: descriptor.artifactKind,
        storage: Object.freeze({
          providerKind: "GITLAB_CI" as const,
          opaqueLocator: `gitlab-artifact-reference:${descriptor.artifactReferenceId}`,
          objectVersionOrEtag: descriptor.descriptorHash,
        }),
        fileName: descriptor.fileName,
        mediaType: descriptor.mediaType,
        sizeBytes: descriptor.sizeBytes,
        checksum: Object.freeze({ algorithm: "SHA256" as const, value: descriptor.checksum }),
        classification: Object.freeze({
          key: descriptor.classificationKey,
          rank: classificationRank(descriptor.classificationKey),
        }),
        availability: coreAvailability(descriptor.availability),
        createdBy: input.context.actor.principalId,
        createdAt: new Date(descriptor.registeredAt),
        expiresAt: new Date(descriptor.expiresAt),
      }),
  );
  const reviewFlags = qaAutomationFlakySuspected([
    ...input.previousLineageResults,
    { attemptNo: input.attempt.attemptNo, outcome: result.outcome },
  ])
    ? Object.freeze(["FLAKY_SUSPECTED"] as const)
    : Object.freeze([] as const);
  const eventNamespace = `${input.attempt.automationAttemptId}:${result.contentHash}`;
  const events = Object.freeze([
    buildQaAutomationAttemptStatusObservedEvent({
      context: input.context,
      eventId: deterministicUuid(`event:status:${eventNamespace}`),
      attempt: appended.attempt,
      revision: appended.revision,
    }),
    ...memberships.map((membership) =>
      buildQaAutomationArtifactRegisteredEvent({
        context: input.context,
        eventId: deterministicUuid(
          `event:artifact:${eventNamespace}:${membership.artifactReferenceId}`,
        ),
        automationAttemptId: input.attempt.automationAttemptId,
        artifactReferenceId: membership.artifactReferenceId,
        checksum: membership.checksum,
        classification: membership.classificationKey,
        expiresAt: membership.expiresAt,
        registeredAt: membership.registeredAt,
      }),
    ),
    buildQaAutomationAttemptCompletedEvent({
      context: input.context,
      eventId: deterministicUuid(`event:completed:${eventNamespace}`),
      attempt: appended.attempt,
      result,
    }),
  ]);
  return Object.freeze({
    attempt: appended.attempt,
    terminalStatus: appended.revision,
    result,
    artifactReferences: Object.freeze(artifactReferences),
    artifactMemberships: Object.freeze(memberships),
    session: Object.freeze({
      previousState: input.session.state,
      state: "REVIEW_REQUIRED" as const,
      resourceVersion: input.session.resourceVersion + (input.session.state === "RUNNING" ? 1 : 0),
      changed: input.session.state === "RUNNING",
    }),
    reviewFlags,
    events,
  });
}
