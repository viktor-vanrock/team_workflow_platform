import type { JsonValue, Sha256Digest } from "@awp/platform-contracts";

import {
  assertExactRevisionRef,
  assertProjectScope,
  canonicalSet,
  type ExactRevisionRef,
  type HumanActorSnapshot,
  onboardingContentHash,
  ProjectOnboardingError,
  type ProjectScope,
} from "./primitives.ts";

export type ProjectOnboardingStage =
  "DRAFT" | "VALIDATING" | "NEEDS_FIX" | "SHADOW" | "PILOT_ACTIVE";
/** An opaque Pack-owned capability key. Published v1 field names remain stable for hashing. */
export type ProjectCapabilityMode = string;
export type ProjectOperationalState = "ACTIVE" | "SUSPENDED";

export interface ProjectRegistryRevision extends ProjectScope {
  readonly revisionId: string;
  readonly version: number;
  readonly key: string;
  readonly name: string;
  readonly ownerIds: readonly string[];
  readonly criticalityKey: string;
  readonly dataClassificationKey: string;
  readonly verificationStatus: "CURRENT" | "DUE" | "NEEDS_REVIEW";
  readonly lastVerifiedAt?: string;
  readonly nextVerificationAt?: string;
  readonly reason: string;
  readonly createdBy: HumanActorSnapshot;
  readonly createdAt: string;
  readonly contentHash: Sha256Digest;
}

export interface ProjectHeader extends ProjectScope {
  readonly key: string;
  readonly name: string;
  readonly registrationStatus: "ACTIVE" | "ARCHIVED";
  readonly currentRegistryVersion: number;
  readonly rowVersion: number;
}

export interface ProjectOnboardingRevision extends ProjectScope {
  readonly revisionId: string;
  readonly onboardingId: string;
  readonly version: number;
  readonly stage: ProjectOnboardingStage;
  readonly qaCapabilityMode: ProjectCapabilityMode;
  readonly operationalState: ProjectOperationalState;
  readonly intendedCapabilityMode: ProjectCapabilityMode;
  readonly projectRegistryRef: ExactRevisionRef;
  readonly bindingRef?: ExactRevisionRef;
  readonly qaProjectContextRef?: ExactRevisionRef;
  readonly starterEntitlementSetHash: Sha256Digest;
  readonly gateResultRefs: readonly ExactRevisionRef[];
  readonly ownerSetHash: Sha256Digest;
  readonly reasonCode: string;
  readonly reason: string;
  readonly incidentRef?: string;
  readonly actor: HumanActorSnapshot;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly createdAt: string;
  readonly contentHash: Sha256Digest;
}

export interface ProjectAggregate {
  readonly header: ProjectHeader;
  readonly registryRevisions: readonly ProjectRegistryRevision[];
  readonly onboardingRevisions: readonly ProjectOnboardingRevision[];
}

function assertTime(value: string): void {
  if (Number.isNaN(Date.parse(value)))
    throw new ProjectOnboardingError("PROJECT_TIMESTAMP_INVALID");
}

function hashWithout<T extends Record<string, unknown>>(value: T): Sha256Digest {
  return onboardingContentHash(value as unknown as JsonValue);
}

export function createProjectRegistryRevision(
  input: Omit<ProjectRegistryRevision, "ownerIds" | "contentHash"> & {
    readonly ownerIds: readonly string[];
  },
): ProjectRegistryRevision {
  assertProjectScope(input);
  assertTime(input.createdAt);
  if (
    !input.revisionId ||
    input.version < 1 ||
    !input.key ||
    !input.name ||
    !input.criticalityKey ||
    !input.dataClassificationKey ||
    !input.reason
  ) {
    throw new ProjectOnboardingError("PROJECT_REGISTRY_REVISION_INVALID");
  }
  const ownerIds = canonicalSet(input.ownerIds);
  if (ownerIds.length === 0) throw new ProjectOnboardingError("PROJECT_OWNER_REQUIRED");
  const body = { ...structuredClone(input), ownerIds };
  return Object.freeze({ ...body, contentHash: hashWithout(body) });
}

export function createOnboardingRevision(
  input: Omit<ProjectOnboardingRevision, "gateResultRefs" | "contentHash"> & {
    readonly gateResultRefs: readonly ExactRevisionRef[];
  },
): ProjectOnboardingRevision {
  assertProjectScope(input);
  assertExactRevisionRef(input.projectRegistryRef);
  input.gateResultRefs.forEach(assertExactRevisionRef);
  if (input.bindingRef) assertExactRevisionRef(input.bindingRef);
  if (input.qaProjectContextRef) assertExactRevisionRef(input.qaProjectContextRef);
  if (
    !input.qaCapabilityMode ||
    !input.intendedCapabilityMode ||
    input.version < 1 ||
    !input.revisionId ||
    !input.onboardingId ||
    !input.reason ||
    !input.reasonCode ||
    Number.isNaN(Date.parse(input.createdAt))
  ) {
    throw new ProjectOnboardingError("PROJECT_ONBOARDING_REVISION_INVALID");
  }
  if (
    ["SHADOW", "PILOT_ACTIVE"].includes(input.stage) &&
    (!input.bindingRef || !input.qaProjectContextRef)
  ) {
    throw new ProjectOnboardingError("ONBOARDING_CONFIGURATION_REQUIRED");
  }
  if (input.operationalState === "SUSPENDED" && !input.incidentRef)
    throw new ProjectOnboardingError("SUSPENSION_INCIDENT_REQUIRED");
  const gateResultRefs = Object.freeze(
    [...input.gateResultRefs].sort((a, b) =>
      `${a.id}:${a.version}`.localeCompare(`${b.id}:${b.version}`),
    ),
  );
  const body = { ...structuredClone(input), gateResultRefs };
  return Object.freeze({ ...body, contentHash: hashWithout(body) });
}

const stageTransitions: Readonly<
  Record<ProjectOnboardingStage, readonly ProjectOnboardingStage[]>
> = Object.freeze({
  DRAFT: ["VALIDATING"],
  VALIDATING: ["NEEDS_FIX", "SHADOW"],
  NEEDS_FIX: ["VALIDATING"],
  SHADOW: ["VALIDATING", "PILOT_ACTIVE"],
  PILOT_ACTIVE: ["VALIDATING", "SHADOW"],
});

export function assertOnboardingTransition(
  previous: ProjectOnboardingRevision,
  next: ProjectOnboardingRevision,
): void {
  if (
    previous.workspaceId !== next.workspaceId ||
    previous.projectId !== next.projectId ||
    previous.onboardingId !== next.onboardingId
  ) {
    throw new ProjectOnboardingError("ONBOARDING_SCOPE_MISMATCH");
  }
  if (next.version !== previous.version + 1)
    throw new ProjectOnboardingError("ONBOARDING_VERSION_GAP");
  if (
    previous.operationalState === next.operationalState &&
    previous.stage !== next.stage &&
    !stageTransitions[previous.stage].includes(next.stage)
  ) {
    throw new ProjectOnboardingError("ONBOARDING_STAGE_TRANSITION_INVALID");
  }
  if (
    previous.operationalState === "ACTIVE" &&
    next.operationalState === "SUSPENDED" &&
    next.qaCapabilityMode !== previous.qaCapabilityMode
  ) {
    throw new ProjectOnboardingError("SUSPENSION_MODE_MUTATION_FORBIDDEN");
  }
}
