import type { JsonValue, Sha256Digest } from "@awp/platform-contracts";

import { isSystemAdministratorRole } from "../access/role-key.ts";
import type { ProjectCapabilityMode, ProjectOnboardingRevision } from "./model.ts";
import {
  assertExactRevisionRef,
  type ExactRevisionRef,
  type HumanActorSnapshot,
  onboardingContentHash,
  ProjectOnboardingError,
  type ProjectScope,
} from "./primitives.ts";

export const PROJECT_ONBOARDING_ACTION_KINDS = Object.freeze([
  "BINDING_PUBLISH",
  "BINDING_RETIRE",
  "PROJECT_RESUME",
  "ONBOARDING_PILOT_ACTIVATE",
] as const);

export type ProjectOnboardingActionKind = (typeof PROJECT_ONBOARDING_ACTION_KINDS)[number];

export interface ProjectActionCandidate extends ProjectScope {
  readonly actionId: string;
  readonly kind: ProjectOnboardingActionKind;
  readonly targetRef: ExactRevisionRef;
  readonly expectedOnboardingVersion: number;
  readonly prerequisiteRefs: readonly ExactRevisionRef[];
  readonly initiator: HumanActorSnapshot;
  readonly reason: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly contentHash: Sha256Digest;
}

export interface ProjectActionApproval {
  readonly approvalId: string;
  readonly subjectKind: "PLATFORM_ACTION";
  readonly actionKind: ProjectOnboardingActionKind;
  readonly actionId: string;
  readonly targetHash: Sha256Digest;
  readonly initiatorPrincipalId: string;
  readonly approver: HumanActorSnapshot;
  readonly stepUpAt?: string;
  readonly approvedAt: string;
  readonly expiresAt: string;
  readonly consumedAt?: string;
}

export interface EmergencyProjectSuspension extends ProjectScope {
  readonly incidentRef: string;
  readonly expectedOnboardingVersion: number;
  readonly initiatedBy: HumanActorSnapshot;
  readonly reason: string;
}

export interface ProjectResumeActionCandidate extends ProjectActionCandidate {
  readonly kind: "PROJECT_RESUME";
  readonly incidentRef: string;
  readonly incidentDispositionRef: ExactRevisionRef;
  readonly freshProbeRefs: readonly ExactRevisionRef[];
  readonly intendedCapabilityMode: ProjectCapabilityMode;
}

const exactRefKey = (ref: ExactRevisionRef): string =>
  `${ref.id}\u0000${ref.version}\u0000${ref.contentHash}`;

export function createProjectResumeActionCandidate(
  input: Readonly<{
    current: ProjectOnboardingRevision;
    actionId: string;
    incidentDispositionRef: ExactRevisionRef;
    freshProbeRefs: readonly ExactRevisionRef[];
    initiator: HumanActorSnapshot;
    reason: string;
    createdAt: string;
    expiresAt: string;
  }>,
): ProjectResumeActionCandidate {
  if (
    input.current.operationalState !== "SUSPENDED" ||
    !input.current.incidentRef ||
    input.freshProbeRefs.length === 0
  ) {
    throw new ProjectOnboardingError("PROJECT_RESUME_CANDIDATE_PREREQUISITE_INVALID");
  }
  assertExactRevisionRef(input.incidentDispositionRef);
  input.freshProbeRefs.forEach(assertExactRevisionRef);
  const freshProbeRefs = Object.freeze(
    [...input.freshProbeRefs].sort((left, right) =>
      exactRefKey(left).localeCompare(exactRefKey(right)),
    ),
  );
  if (new Set(freshProbeRefs.map(exactRefKey)).size !== freshProbeRefs.length) {
    throw new ProjectOnboardingError("PROJECT_RESUME_PROBE_SET_INVALID");
  }
  const targetRef = Object.freeze({
    id: input.current.revisionId,
    version: input.current.version,
    contentHash: input.current.contentHash,
  });
  const base = createProjectActionCandidate({
    actionId: input.actionId,
    kind: "PROJECT_RESUME",
    workspaceId: input.current.workspaceId,
    projectId: input.current.projectId,
    targetRef,
    expectedOnboardingVersion: input.current.version,
    prerequisiteRefs: [input.incidentDispositionRef, ...freshProbeRefs],
    initiator: input.initiator,
    reason: input.reason,
    createdAt: input.createdAt,
    expiresAt: input.expiresAt,
  });
  const body = {
    actionId: base.actionId,
    kind: base.kind,
    workspaceId: base.workspaceId,
    projectId: base.projectId,
    targetRef: base.targetRef,
    expectedOnboardingVersion: base.expectedOnboardingVersion,
    prerequisiteRefs: base.prerequisiteRefs,
    initiator: base.initiator,
    reason: base.reason,
    createdAt: base.createdAt,
    expiresAt: base.expiresAt,
    incidentRef: input.current.incidentRef,
    incidentDispositionRef: input.incidentDispositionRef,
    freshProbeRefs,
    intendedCapabilityMode: input.current.intendedCapabilityMode,
  } as const;
  return Object.freeze({
    ...body,
    kind: "PROJECT_RESUME" as const,
    contentHash: onboardingContentHash(body as unknown as JsonValue),
  });
}

export function projectResumePrerequisitesCurrent(
  candidate: ProjectResumeActionCandidate,
  live: Readonly<{
    incidentRef: string;
    incidentDispositionRef: ExactRevisionRef;
    incidentDispositionAccepted: boolean;
    freshProbeRefs: readonly ExactRevisionRef[];
  }>,
): boolean {
  if (
    !live.incidentDispositionAccepted ||
    live.incidentRef !== candidate.incidentRef ||
    exactRefKey(live.incidentDispositionRef) !== exactRefKey(candidate.incidentDispositionRef)
  )
    return false;
  const expected = candidate.freshProbeRefs.map(exactRefKey).sort();
  const actual = live.freshProbeRefs.map(exactRefKey).sort();
  return (
    expected.length === actual.length && expected.every((value, index) => value === actual[index])
  );
}

export function createProjectActionCandidate(
  input: Omit<ProjectActionCandidate, "contentHash">,
): ProjectActionCandidate {
  if (
    !PROJECT_ONBOARDING_ACTION_KINDS.includes(input.kind) ||
    !input.actionId ||
    !input.workspaceId ||
    !input.projectId ||
    input.expectedOnboardingVersion < 1 ||
    !input.reason ||
    Number.isNaN(Date.parse(input.createdAt)) ||
    Number.isNaN(Date.parse(input.expiresAt)) ||
    Date.parse(input.expiresAt) <= Date.parse(input.createdAt)
  ) {
    throw new ProjectOnboardingError("PROJECT_ACTION_CANDIDATE_INVALID");
  }
  assertExactRevisionRef(input.targetRef);
  input.prerequisiteRefs.forEach(assertExactRevisionRef);
  const body = structuredClone(input);
  return Object.freeze({
    ...body,
    contentHash: onboardingContentHash(body as unknown as JsonValue),
  });
}

export function consumeProjectActionApproval<T extends ProjectActionApproval>(
  candidate: ProjectActionCandidate,
  approval: T,
  now: string,
): T & Readonly<{ consumedAt: string }> {
  if (approval.consumedAt) throw new ProjectOnboardingError("APPROVAL_ALREADY_CONSUMED");
  if (
    approval.subjectKind !== "PLATFORM_ACTION" ||
    approval.actionKind !== candidate.kind ||
    approval.actionId !== candidate.actionId ||
    approval.targetHash !== candidate.contentHash ||
    approval.initiatorPrincipalId !== candidate.initiator.principalId
  ) {
    throw new ProjectOnboardingError("APPROVAL_EXACT_SUBJECT_MISMATCH");
  }
  if (approval.approver.kind !== "HUMAN")
    throw new ProjectOnboardingError("HUMAN_APPROVER_REQUIRED");
  if (approval.approver.principalId === candidate.initiator.principalId)
    throw new ProjectOnboardingError("SELF_APPROVAL_FORBIDDEN");
  if (!approval.stepUpAt || Number.isNaN(Date.parse(approval.stepUpAt)))
    throw new ProjectOnboardingError("APPROVAL_STEP_UP_REQUIRED");
  const timestamp = Date.parse(now);
  if (
    Number.isNaN(timestamp) ||
    timestamp > Date.parse(approval.expiresAt) ||
    timestamp > Date.parse(candidate.expiresAt)
  ) {
    throw new ProjectOnboardingError("APPROVAL_EXPIRED");
  }
  return Object.freeze({ ...approval, consumedAt: now });
}

export function consumeAuthorizedProjectAction<T extends ProjectActionApproval>(
  candidate: ProjectActionCandidate,
  approval: T,
  live: Readonly<{
    now: string;
    currentOnboardingVersion: number;
    initiatorCurrentlyAuthorized: boolean;
    approverCurrentlyAuthorized: boolean;
    prerequisitesCurrent: boolean;
  }>,
): T & Readonly<{ consumedAt: string }> {
  if (candidate.expectedOnboardingVersion !== live.currentOnboardingVersion)
    throw new ProjectOnboardingError("ONBOARDING_VERSION_CONFLICT");
  if (!live.initiatorCurrentlyAuthorized || !live.approverCurrentlyAuthorized)
    throw new ProjectOnboardingError("PROJECT_ACTION_AUTHORIZATION_REVOKED");
  if (!live.prerequisitesCurrent)
    throw new ProjectOnboardingError("PROJECT_ACTION_PREREQUISITE_STALE");
  if (!isSystemAdministratorRole(approval.approver.roleKey))
    throw new ProjectOnboardingError("PROJECT_ACTION_WORKSPACE_OWNER_REQUIRED");
  return consumeProjectActionApproval(candidate, approval, live.now);
}
