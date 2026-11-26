import type {
  QaAutomatedTargetSnapshot,
  QaAutomationArtifactDescriptorInput,
} from "@awp/competency-qa/node";
import type { CiArtifactDescriptor, PipelineObservation } from "@awp/connector-sdk";
import { sha256, type JsonValue } from "@awp/platform-contracts";

/** Map a verified GitLab metadata descriptor to the existing QA artifact input. */
export function corporateGitLabArtifactForQa(
  input: Readonly<{
    snapshot: QaAutomatedTargetSnapshot;
    attemptId: string;
    observation: PipelineObservation;
    descriptor: CiArtifactDescriptor;
    logicalPath: string;
    expectedChecksum: string;
    retentionPolicyRef: string;
    registeredAt: string;
  }>,
): QaAutomationArtifactDescriptorInput {
  const { snapshot, descriptor, observation } = input;
  const { descriptorHash, ...body } = descriptor;
  const { snapshotHash, ...snapshotBody } = snapshot;
  const { observationHash, ...observationBody } = observation;
  const pins = snapshot.configurationPins.filter((pin) => pin.logicalRole === "ARTIFACT_SOURCE");
  const classification = descriptor.classification;
  if (
    sha256(snapshotBody as unknown as JsonValue) !== snapshotHash ||
    sha256(observationBody as unknown as JsonValue) !== observationHash ||
    !observation.terminal ||
    observation.sourceCommitSha !== snapshot.target.commitSha ||
    sha256(body as unknown as JsonValue) !== descriptorHash ||
    pins.length !== 1 ||
    descriptor.schemaVersion !== "artifact.ci-read@1.0.0" ||
    descriptor.messageType !== "RESULT" ||
    descriptor.operation !== "artifact.metadata" ||
    descriptor.workItemId !== snapshot.workItemId ||
    descriptor.testSessionId !== snapshot.testSessionId ||
    descriptor.automationAttemptId !== input.attemptId ||
    descriptor.externalPipelineId !== observation.externalPipelineId ||
    !observation.externalJobIds.includes(descriptor.externalJobId) ||
    descriptor.checksum !== input.expectedChecksum ||
    descriptor.sourceProfileRef.id !== pins[0]!.profileRef.id ||
    descriptor.sourceProfileRef.version !== pins[0]!.profileRef.version ||
    descriptor.sourceProfileHash !== pins[0]!.profileRef.contentHash ||
    !["PUBLIC", "INTERNAL", "RESTRICTED", "CONFIDENTIAL"].includes(classification) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
      descriptor.descriptorId,
    ) ||
    !/^sha256:[a-f0-9]{64}$/u.test(descriptor.checksum) ||
    !/^sha256:[a-f0-9]{64}$/u.test(descriptor.opaqueLocatorHash) ||
    !Number.isSafeInteger(descriptor.byteSize) ||
    descriptor.byteSize < 0 ||
    !Number.isFinite(Date.parse(descriptor.expiresAt)) ||
    !/^(?!\/)(?!.*\.\.)[A-Za-z0-9._/-]{1,512}$/u.test(input.logicalPath) ||
    input.retentionPolicyRef !==
      `${snapshot.executionPolicies.artifactPolicyRef.id}@${snapshot.executionPolicies.artifactPolicyRef.version}` ||
    !Number.isFinite(Date.parse(input.registeredAt))
  )
    throw new Error("CORPORATE_GITLAB_ARTIFACT_INVALID");
  return Object.freeze({
    artifactReferenceId: descriptor.descriptorId,
    descriptorHash,
    externalPipelineId: descriptor.externalPipelineId,
    externalJobId: descriptor.externalJobId,
    logicalPath: input.logicalPath,
    checksum: descriptor.checksum,
    checksumSource: descriptor.checksumSource,
    sizeBytes: descriptor.byteSize,
    mediaType: descriptor.mediaType,
    fileName: descriptor.fileName,
    artifactKind: descriptor.artifactKind,
    classificationKey: classification as QaAutomationArtifactDescriptorInput["classificationKey"],
    sourceProfileRef: descriptor.sourceProfileRef,
    sourceProfileContentHash: descriptor.sourceProfileHash,
    retentionPolicyRef: input.retentionPolicyRef,
    availability: descriptor.availability,
    opaqueLocatorHash: descriptor.opaqueLocatorHash,
    expiresAt: descriptor.expiresAt,
    registeredAt: input.registeredAt,
  });
}
