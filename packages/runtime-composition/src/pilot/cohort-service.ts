import { type JsonValue, sha256, type Sha256Digest } from "@awp/platform-contracts";

export interface PilotCohortProject {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly onboardingRef: Readonly<{ id: string; version: number; contentHash: Sha256Digest }>;
}

export interface PilotCohortRevision {
  readonly cohortId: string;
  readonly version: number;
  readonly projects: readonly PilotCohortProject[];
  readonly userIds: readonly string[];
  readonly channelRefs: readonly string[];
  readonly environmentRefs: readonly string[];
  readonly suiteRefs: readonly string[];
  readonly gateRefs: readonly Readonly<{
    kind: "L0" | "C1" | "N2" | "P3";
    id: string;
    contentHash: Sha256Digest;
  }>[];
  readonly startAt: string;
  readonly endAt: string;
  readonly sponsorRef: string;
  readonly qaLeadRef: string;
  readonly onCallRef: string;
  readonly rollbackRunbookRef: string;
  readonly comparisonProtocolRef: Readonly<{ id: string; contentHash: Sha256Digest }>;
  readonly state: "CURRENT" | "REVOKED";
  readonly predecessorHash: Sha256Digest | null;
  readonly contentHash: Sha256Digest;
}

/** The reviewed scope excludes gate results, which are produced after IN-10 approval. */
export function pilotCohortScopeHash(cohort: PilotCohortRevision): Sha256Digest {
  const { gateRefs: _gateRefs, contentHash: _contentHash, ...scope } = cohort;
  void _gateRefs;
  void _contentHash;
  return sha256(scope as unknown as JsonValue);
}

function canonical(values: readonly string[]): readonly string[] {
  const result = [...values].sort();
  if (
    result.length === 0 ||
    result.some((value) => !value.trim()) ||
    new Set(result).size !== result.length
  )
    throw new Error("PILOT_COHORT_SCOPE_INVALID");
  return Object.freeze(result);
}

export function createInitialPilotCohort(
  input: Omit<PilotCohortRevision, "version" | "state" | "predecessorHash" | "contentHash">,
): PilotCohortRevision {
  if (input.projects.length !== 1) throw new Error("PILOT_INITIAL_COHORT_ONE_PROJECT_REQUIRED");
  return createCohort({ ...input, version: 1, state: "CURRENT", predecessorHash: null });
}

function createCohort(input: Omit<PilotCohortRevision, "contentHash">): PilotCohortRevision {
  if (
    !input.cohortId ||
    !Number.isSafeInteger(input.version) ||
    input.version < 1 ||
    Date.parse(input.endAt) <= Date.parse(input.startAt) ||
    !input.sponsorRef ||
    !input.qaLeadRef ||
    input.sponsorRef === input.qaLeadRef ||
    !input.onCallRef ||
    !input.rollbackRunbookRef ||
    !input.comparisonProtocolRef.id ||
    input.gateRefs.length !== 4 ||
    new Set(input.gateRefs.map((gate) => gate.kind)).size !== 4
  )
    throw new Error("PILOT_COHORT_INVALID");
  const projects = Object.freeze(
    [...input.projects].sort((left, right) =>
      `${left.workspaceId}:${left.projectId}`.localeCompare(
        `${right.workspaceId}:${right.projectId}`,
      ),
    ),
  );
  if (
    new Set(projects.map((value) => `${value.workspaceId}:${value.projectId}`)).size !==
    projects.length
  )
    throw new Error("PILOT_COHORT_PROJECT_DUPLICATE");
  const body = Object.freeze({
    ...structuredClone(input),
    projects,
    userIds: canonical(input.userIds),
    channelRefs: canonical(input.channelRefs),
    environmentRefs: canonical(input.environmentRefs),
    suiteRefs: canonical(input.suiteRefs),
    gateRefs: Object.freeze(
      [...input.gateRefs].sort((left, right) => left.kind.localeCompare(right.kind)),
    ),
  });
  return Object.freeze({ ...body, contentHash: sha256(body as unknown as JsonValue) });
}

export function expandPilotCohort(
  current: PilotCohortRevision,
  project: PilotCohortProject,
): PilotCohortRevision {
  if (
    current.state !== "CURRENT" ||
    current.projects.some(
      (value) => value.workspaceId === project.workspaceId && value.projectId === project.projectId,
    )
  ) {
    throw new Error("PILOT_COHORT_EXPANSION_INVALID");
  }
  return createCohort({
    ...current,
    version: current.version + 1,
    projects: [...current.projects, project],
    predecessorHash: current.contentHash,
  });
}

export function revokePilotCohort(current: PilotCohortRevision): PilotCohortRevision {
  if (current.state !== "CURRENT") throw new Error("PILOT_COHORT_ALREADY_REVOKED");
  return createCohort({
    ...current,
    version: current.version + 1,
    state: "REVOKED",
    predecessorHash: current.contentHash,
  });
}

export type PilotDispatchDecision =
  | Readonly<{ allowed: true; cohortHash: Sha256Digest }>
  | Readonly<{
      allowed: false;
      reason:
        | "COHORT_REVOKED"
        | "WINDOW_CLOSED"
        | "PROJECT_OUTSIDE_COHORT"
        | "USER_OUTSIDE_COHORT"
        | "CHANNEL_OUTSIDE_COHORT"
        | "ENVIRONMENT_OUTSIDE_COHORT"
        | "PROJECT_SUSPENDED"
        | "ONBOARDING_NOT_ACTIVE"
        | "COHORT_DRIFT";
    }>;

export function authorizePilotDispatch(
  input: Readonly<{
    cohort: PilotCohortRevision;
    pinnedCohortHash: Sha256Digest;
    workspaceId: string;
    projectId: string;
    userId: string;
    channelRef: string;
    environmentRef: string;
    onboardingStage: string;
    operationalState: string;
    now: string;
  }>,
): PilotDispatchDecision {
  if (input.cohort.contentHash !== input.pinnedCohortHash)
    return Object.freeze({ allowed: false, reason: "COHORT_DRIFT" });
  if (input.cohort.state !== "CURRENT")
    return Object.freeze({ allowed: false, reason: "COHORT_REVOKED" });
  const timestamp = Date.parse(input.now);
  if (
    !Number.isFinite(timestamp) ||
    timestamp < Date.parse(input.cohort.startAt) ||
    timestamp >= Date.parse(input.cohort.endAt)
  )
    return Object.freeze({ allowed: false, reason: "WINDOW_CLOSED" });
  if (
    !input.cohort.projects.some(
      (value) => value.workspaceId === input.workspaceId && value.projectId === input.projectId,
    )
  )
    return Object.freeze({ allowed: false, reason: "PROJECT_OUTSIDE_COHORT" });
  if (!input.cohort.userIds.includes(input.userId))
    return Object.freeze({ allowed: false, reason: "USER_OUTSIDE_COHORT" });
  if (!input.cohort.channelRefs.includes(input.channelRef))
    return Object.freeze({ allowed: false, reason: "CHANNEL_OUTSIDE_COHORT" });
  if (!input.cohort.environmentRefs.includes(input.environmentRef))
    return Object.freeze({ allowed: false, reason: "ENVIRONMENT_OUTSIDE_COHORT" });
  if (input.operationalState !== "ACTIVE")
    return Object.freeze({ allowed: false, reason: "PROJECT_SUSPENDED" });
  if (input.onboardingStage !== "PILOT_ACTIVE")
    return Object.freeze({ allowed: false, reason: "ONBOARDING_NOT_ACTIVE" });
  return Object.freeze({ allowed: true, cohortHash: input.cohort.contentHash });
}
