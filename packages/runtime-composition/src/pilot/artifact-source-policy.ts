import type { CiArtifactDescriptor } from "@awp/connector-sdk";
import { type JsonValue, sha256 } from "@awp/platform-contracts";
import {
  assertExactRevisionRef,
  assertProjectScope,
  type ExactRevisionRef,
  freezePilotValue,
  type ProjectScope,
} from "@awp/platform-core";

export interface ArtifactSourcePolicy extends ProjectScope {
  readonly ref: ExactRevisionRef;
  readonly mode: "GITLAB_ONLY";
  readonly allowManualGitLabReferences: boolean;
  readonly minimumRetentionMs: number;
  readonly maximumObservationAgeMs: number;
  readonly retentionPolicyRef: ExactRevisionRef;
  readonly gitlab: readonly Readonly<{
    numericProjectId: number;
    profileRef: ExactRevisionRef;
    connectionRef: ExactRevisionRef;
  }>[];
}
export interface ArtifactSourceRequirement {
  readonly id: string;
  readonly capture: "MANUAL" | "CI";
  readonly required: boolean;
  readonly artifactId?: string;
}
/** Loaded from authorized artifact/retention/connector repositories, never a browser attestation. */
export interface ArtifactSourceObservation extends ProjectScope {
  readonly artifactId: string;
  readonly checksum: `sha256:${string}`;
  readonly sizeBytes: number;
  readonly availability: "AVAILABLE" | "EXPIRED" | "QUARANTINED" | "UNAVAILABLE";
  readonly observedAt: string;
  readonly retainedUntil: string;
  readonly retentionPolicyRef: ExactRevisionRef;
  readonly source: Readonly<{
    kind: "GITLAB_CI";
    numericProjectId: number;
    connectionRef: ExactRevisionRef;
    descriptor: CiArtifactDescriptor;
  }>;
}
const same = (left: ExactRevisionRef | undefined, right: ExactRevisionRef): boolean =>
  Boolean(
    left &&
    left.id === right.id &&
    left.version === right.version &&
    left.contentHash === right.contentHash,
  );
const hash = (value: string) => /^sha256:[a-f0-9]{64}$/u.test(value);

/** Evidence sufficiency only. Existing Core authorization and effect gates remain authoritative. */
export function assessArtifactSources(
  policy: ArtifactSourcePolicy,
  requirements: readonly ArtifactSourceRequirement[],
  observations: readonly ArtifactSourceObservation[],
  now: Date,
) {
  try {
    assertProjectScope(policy);
    assertExactRevisionRef(policy.ref);
    assertExactRevisionRef(policy.retentionPolicyRef);
    for (const source of policy.gitlab) {
      assertExactRevisionRef(source.profileRef);
      assertExactRevisionRef(source.connectionRef);
      if (!Number.isSafeInteger(source.numericProjectId) || source.numericProjectId < 1)
        throw new Error();
    }
    if (
      policy.mode !== "GITLAB_ONLY" ||
      typeof policy.allowManualGitLabReferences !== "boolean" ||
      !Number.isSafeInteger(policy.minimumRetentionMs) ||
      policy.minimumRetentionMs < 0 ||
      !Number.isSafeInteger(policy.maximumObservationAgeMs) ||
      policy.maximumObservationAgeMs < 1 ||
      !Number.isFinite(now.getTime() + policy.minimumRetentionMs) ||
      requirements.length > 256 ||
      observations.length > 256 ||
      new Set(requirements.map((item) => item.id)).size !== requirements.length ||
      requirements.some(
        (item) =>
          !item.id ||
          !["MANUAL", "CI"].includes(item.capture) ||
          typeof item.required !== "boolean",
      )
    )
      throw new Error();
  } catch {
    throw new Error("ARTIFACT_SOURCE_POLICY_INVALID");
  }
  const reasonCodes = new Set<string>();
  const accepted: { requirementId: string; artifactId: string; checksum: string }[] = [];
  for (const requirement of requirements) {
    const candidates = requirement.artifactId
      ? observations.filter((value) => value.artifactId === requirement.artifactId)
      : [];
    if (!candidates.length && !requirement.required) continue;
    if (candidates.length !== 1) {
      reasonCodes.add(
        candidates.length ? "ARTIFACT_OBSERVATION_CONFLICT" : "REQUIRED_ARTIFACT_MISSING",
      );
      continue;
    }
    const value = candidates[0]!;
    const reasons: string[] = [];
    if (value.workspaceId !== policy.workspaceId || value.projectId !== policy.projectId)
      reasons.push("ARTIFACT_SCOPE_DENIED");
    if (value.availability !== "AVAILABLE") reasons.push("ARTIFACT_UNAVAILABLE");
    const observedAt = Date.parse(value.observedAt);
    const retainedUntil = Date.parse(value.retainedUntil);
    if (
      !Number.isFinite(observedAt) ||
      observedAt > now.getTime() ||
      now.getTime() - observedAt > policy.maximumObservationAgeMs
    )
      reasons.push("ARTIFACT_OBSERVATION_STALE");
    if (
      !same(policy.retentionPolicyRef, value.retentionPolicyRef) ||
      !Number.isFinite(retainedUntil) ||
      retainedUntil < now.getTime() + policy.minimumRetentionMs
    )
      reasons.push("ARTIFACT_RETENTION_INSUFFICIENT");
    if (!hash(value.checksum) || !Number.isSafeInteger(value.sizeBytes) || value.sizeBytes < 1)
      reasons.push("ARTIFACT_INTEGRITY_MISMATCH");
    const source = value.source;
    const { descriptorHash, ...body } = source.descriptor;
    const descriptor = source.descriptor;
    if (
      !policy.gitlab.some(
        (approved) =>
          approved.numericProjectId === source.numericProjectId &&
          same(approved.connectionRef, source.connectionRef) &&
          approved.profileRef.id === descriptor.sourceProfileRef.id &&
          approved.profileRef.version === descriptor.sourceProfileRef.version &&
          approved.profileRef.contentHash === descriptor.sourceProfileHash,
      )
    )
      reasons.push("ARTIFACT_SOURCE_PIN_MISMATCH");
    if (
      descriptor.schemaVersion !== "artifact.ci-read@1.0.0" ||
      descriptor.messageType !== "RESULT" ||
      descriptor.operation !== "artifact.metadata" ||
      descriptorHash !== sha256(body as unknown as JsonValue) ||
      descriptor.checksum !== value.checksum ||
      descriptor.byteSize !== value.sizeBytes ||
      !hash(descriptor.provenanceHash) ||
      !hash(descriptor.opaqueLocatorHash)
    )
      reasons.push("ARTIFACT_INTEGRITY_MISMATCH");
    if (descriptor.availability !== "AVAILABLE") reasons.push("ARTIFACT_UNAVAILABLE");
    if (
      !Number.isFinite(Date.parse(descriptor.expiresAt)) ||
      Date.parse(descriptor.expiresAt) < now.getTime() + policy.minimumRetentionMs ||
      Date.parse(descriptor.expiresAt) < retainedUntil
    )
      reasons.push("ARTIFACT_RETENTION_INSUFFICIENT");
    if (requirement.capture === "MANUAL" && !policy.allowManualGitLabReferences)
      reasons.push("MANUAL_ARTIFACT_SOURCE_UNSUPPORTED");
    reasons.forEach((reason) => {
      reasonCodes.add(reason);
    });
    if (!reasons.length)
      accepted.push({
        requirementId: requirement.id,
        artifactId: value.artifactId,
        checksum: value.checksum,
      });
  }
  return freezePilotValue({
    allowed: reasonCodes.size === 0,
    policyRef: policy.ref,
    reasonCodes: [...reasonCodes].sort(),
    accepted,
  });
}

export interface ArtifactSourceObservationPort {
  authorize(scope: ProjectScope): Promise<boolean>;
  load(
    scope: ProjectScope,
    artifactIds: readonly string[],
  ): Promise<readonly ArtifactSourceObservation[]>;
}
export async function assessAuthorizedArtifactSources(
  policy: ArtifactSourcePolicy,
  requirements: readonly ArtifactSourceRequirement[],
  port: ArtifactSourceObservationPort,
  now: Date,
) {
  const scope = Object.freeze({ workspaceId: policy.workspaceId, projectId: policy.projectId });
  if (!(await port.authorize(scope))) throw new Error("PROJECT_RESOURCE_NOT_AVAILABLE");
  if (requirements.length > 256) throw new Error("ARTIFACT_SOURCE_POLICY_INVALID");
  const observations = await port.load(scope, [
    ...new Set(requirements.flatMap((item) => (item.artifactId ? [item.artifactId] : []))),
  ]);
  if (!(await port.authorize(scope))) throw new Error("PROJECT_RESOURCE_NOT_AVAILABLE");
  return assessArtifactSources(policy, requirements, observations, now);
}
