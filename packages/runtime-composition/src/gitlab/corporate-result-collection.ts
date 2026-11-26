import type {
  QaAutomatedTargetSnapshot,
  QaAutomationMachineArtifactManifestEntry,
} from "@awp/competency-qa/node";
import type { GitLabResultNormalization } from "@awp/connector-gitlab";
import { defaultClassificationCatalog } from "@awp/platform-core";

import type { createCorporateGitLabResultArtifactProvider } from "./corporate-result-artifact-provider.ts";
import { corporateGitLabArtifactForQa } from "./corporate-result-artifacts.ts";
import type { createCorporateGitLabResultProvider } from "./corporate-result-provider.ts";

type Pipeline = Awaited<ReturnType<typeof createCorporateGitLabResultProvider>>;
type Artifact = Awaited<ReturnType<typeof createCorporateGitLabResultArtifactProvider>>;

/** Collect exact metadata only after schema and provider target were verified. */
export async function collectCorporateGitLabResultArtifacts(
  input: Readonly<{
    snapshot: QaAutomatedTargetSnapshot;
    attemptId: string;
    pipeline: Pipeline;
    artifacts: Artifact;
    normalized: GitLabResultNormalization;
    registeredAt: string;
    minimumClassificationRank: number;
    artifactPolicy: Readonly<{
      minimumRetentionSeconds: number;
      maximumRetentionSeconds: number;
      allowedClassifications: readonly string[];
      allowedTypes: readonly string[];
      maxBytes: number;
    }>;
  }>,
) {
  const { snapshot, pipeline, artifacts, normalized } = input;
  if (
    normalized.normalizationKind !== "SCHEMA_VALIDATED" ||
    !normalized.resultContentHash ||
    normalized.sourceResultArtifactRef !== pipeline.observation.resultDescriptorRef ||
    !Number.isFinite(Date.parse(input.registeredAt))
  )
    throw new Error("CORPORATE_GITLAB_ARTIFACT_SELECTION_INVALID");
  const result = normalized.result;
  const resultHash = normalized.resultContentHash;
  const jobId = String(result.jobId);
  const mappings = artifacts.profile.suiteMappings.filter(
    (suite) => suite.suiteKey === snapshot.suite.suiteKey,
  );
  if (mappings.length !== 1 || !mappings[0])
    throw new Error("CORPORATE_GITLAB_ARTIFACT_SELECTION_INVALID");
  const path = mappings[0].resultArtifactPath;
  const classifications = artifacts.profile.artifactPolicy.allowedClassifications
    .filter(
      (key) =>
        ["PUBLIC", "INTERNAL", "RESTRICTED", "CONFIDENTIAL"].includes(key) &&
        input.artifactPolicy.allowedClassifications.includes(key),
    )
    .map((key) => defaultClassificationCatalog.reference(key))
    .sort((a, b) => b.rank - a.rank);
  const strongest = classifications[0];
  const classification = strongest?.key;
  if (
    !strongest ||
    !classification ||
    !Number.isSafeInteger(input.minimumClassificationRank) ||
    strongest.rank < input.minimumClassificationRank
  )
    throw new Error("CORPORATE_GITLAB_ARTIFACT_CLASSIFICATION_REQUIRED");
  const providerExpiry = await pipeline.resultJobExpiry(jobId);
  const finished = Date.parse(result.finishedAt);
  const minimumExpiry = finished + input.artifactPolicy.minimumRetentionSeconds * 1000;
  const maximumExpiry = finished + input.artifactPolicy.maximumRetentionSeconds * 1000;
  if (
    !Number.isFinite(finished) ||
    !Number.isFinite(Date.parse(providerExpiry)) ||
    !Number.isSafeInteger(input.artifactPolicy.minimumRetentionSeconds) ||
    !Number.isSafeInteger(input.artifactPolicy.maximumRetentionSeconds) ||
    input.artifactPolicy.minimumRetentionSeconds < 0 ||
    input.artifactPolicy.maximumRetentionSeconds < input.artifactPolicy.minimumRetentionSeconds ||
    Date.parse(providerExpiry) < minimumExpiry ||
    maximumExpiry <= Date.parse(input.registeredAt)
  )
    throw new Error("CORPORATE_GITLAB_ARTIFACT_EXPIRY_UNVERIFIED");
  const expiry = new Date(Math.min(Date.parse(providerExpiry), maximumExpiry)).toISOString();
  const byteSize = await artifacts.resultByteSize(pipeline.observation, jobId, path, resultHash);
  const manifest: QaAutomationMachineArtifactManifestEntry[] = result.artifacts.map((item) => {
    if (
      !["PUBLIC", "INTERNAL", "RESTRICTED", "CONFIDENTIAL"].includes(item.classification) ||
      !input.artifactPolicy.allowedClassifications.includes(item.classification) ||
      defaultClassificationCatalog.reference(item.classification).rank <
        input.minimumClassificationRank ||
      !Number.isFinite(Date.parse(item.expiresAt)) ||
      Date.parse(item.expiresAt) > Date.parse(expiry) ||
      Date.parse(item.expiresAt) < minimumExpiry
    )
      throw new Error("CORPORATE_GITLAB_ARTIFACT_EXPIRY_UNVERIFIED");
    return {
      ...item,
      classification:
        item.classification as QaAutomationMachineArtifactManifestEntry["classification"],
    };
  });
  const files = [
    {
      logicalPath: path,
      mediaType: "application/json",
      byteSize,
      checksum: resultHash,
      classification,
      expiresAt: expiry,
      artifactKind: "RESULT" as const,
    },
    ...manifest.map((item) => ({
      logicalPath: item.path,
      mediaType: item.mediaType,
      byteSize: item.byteSize,
      checksum: item.checksum,
      classification: item.classification,
      expiresAt: item.expiresAt,
      artifactKind: "OTHER" as const,
    })),
  ];
  if (new Set(files.map((file) => file.logicalPath)).size !== files.length)
    throw new Error("CORPORATE_GITLAB_ARTIFACT_SELECTION_INVALID");
  if (
    !Number.isSafeInteger(input.artifactPolicy.maxBytes) ||
    input.artifactPolicy.maxBytes < 1 ||
    files.some(
      (file) =>
        file.byteSize > input.artifactPolicy.maxBytes ||
        !input.artifactPolicy.allowedTypes.includes(file.mediaType),
    )
  )
    throw new Error("CORPORATE_GITLAB_ARTIFACT_POLICY_MISMATCH");
  const readDescriptor = async (file: (typeof files)[number], index: number) => {
    const fileName = file.logicalPath.split("/").at(-1);
    if (!fileName) throw new Error("CORPORATE_GITLAB_ARTIFACT_SELECTION_INVALID");
    const descriptor = await artifacts.descriptor({
      workItemId: snapshot.workItemId,
      testSessionId: snapshot.testSessionId,
      automationAttemptId: input.attemptId,
      externalPipelineId: pipeline.observation.externalPipelineId,
      externalJobId: jobId,
      logicalArtifactKey: `artifact-${index}`,
      resultHash,
      artifactPath: file.logicalPath,
      artifactKind: file.artifactKind,
      fileName,
      mediaType: file.mediaType,
      byteSize: file.byteSize,
      checksum: file.checksum,
      classification: file.classification,
      createdAt: result.finishedAt,
      expiresAt: file.expiresAt,
    });
    return corporateGitLabArtifactForQa({
      snapshot,
      attemptId: input.attemptId,
      observation: pipeline.observation,
      descriptor,
      logicalPath: file.logicalPath,
      expectedChecksum: file.checksum,
      retentionPolicyRef: `${snapshot.executionPolicies.artifactPolicyRef.id}@${snapshot.executionPolicies.artifactPolicyRef.version}`,
      registeredAt: input.registeredAt,
    });
  };
  const descriptors = [];
  for (let index = 0; index < files.length; index += 4) {
    const batch = files.slice(index, index + 4);
    descriptors.push(
      ...(await Promise.all(batch.map((file, offset) => readDescriptor(file, index + offset)))),
    );
  }
  return Object.freeze({
    descriptors: Object.freeze(descriptors),
    manifest: Object.freeze(manifest),
  });
}
