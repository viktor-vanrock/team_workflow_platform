import {
  qaAggregateSnapshotHash,
  type QaContentHash,
  QaDomainError,
  type QaHumanActor,
} from "./primitives.ts";
import type { QaExternalImmutableRef } from "./qa-project-context.ts";

export type QaPlanOperationalStatus =
  "NEW" | "READY" | "PLANNED" | "IN_PROGRESS" | "REVIEW" | "BLOCKED" | "CANCELLED" | "DONE";

export interface QaRequiredSessionRequirementInput {
  readonly requirementKey: string;
  readonly mode: "MANUAL";
  readonly purpose: string;
  readonly minimumSessionCount: number;
  readonly requiredCapabilities: readonly string[];
  readonly targetPolicyRef: QaExternalImmutableRef;
  readonly scopePolicyRef: QaExternalImmutableRef;
  readonly checklistPolicyRefs: readonly QaExternalImmutableRef[];
  readonly resolution: "REQUIRED" | "WAIVED";
  readonly waiverRef?: Readonly<{ id: string; version: number; contentHash: QaContentHash }>;
}

export const qaAutomationRequiredCapabilities = Object.freeze([
  "source-context.read@1.0.0",
  "test-executor.trigger-status@1.0.0",
  "artifact.ci-read@1.0.0",
] as const);

export interface QaAutomatedRequiredSession {
  readonly schemaVersion: 2;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly workItemId: string;
  readonly requiredSessionPlanId: string;
  readonly planVersion: number;
  readonly requirementId: string;
  readonly mode: "AUTOMATED";
  readonly suiteBindingKey: string;
  readonly suiteSelectionPolicy: "CURRENT_PUBLISHED_AT_SESSION_CREATION";
  readonly allowedTargetTypes: readonly ("MERGE_REQUEST" | "COMMIT" | "BUILD")[];
  readonly allowedEnvironmentRefs: readonly string[];
  readonly capabilityRequirements: typeof qaAutomationRequiredCapabilities;
  readonly contentHash: QaContentHash;
  readonly createdAt: string;
}

export function createAutomatedRequiredSession(
  input: Readonly<{
    workspaceId: string;
    projectId: string;
    workItemId: string;
    requiredSessionPlanId: string;
    planVersion: number;
    requirementId: string;
    suiteBindingKey: string;
    allowedTargetTypes: readonly ("MERGE_REQUEST" | "COMMIT" | "BUILD")[];
    allowedEnvironmentRefs: readonly string[];
    createdAt: string;
  }>,
): QaAutomatedRequiredSession {
  const ids = [
    input.workspaceId,
    input.projectId,
    input.workItemId,
    input.requiredSessionPlanId,
    input.requirementId,
  ];
  const targets = new Set(input.allowedTargetTypes);
  const environments = new Set(input.allowedEnvironmentRefs);
  if (
    ids.some((value) => !value) ||
    !Number.isInteger(input.planVersion) ||
    input.planVersion < 1 ||
    !/^[a-z][a-z0-9._-]{0,127}$/u.test(input.suiteBindingKey) ||
    targets.size !== input.allowedTargetTypes.length ||
    targets.size < 1 ||
    environments.size !== input.allowedEnvironmentRefs.length ||
    environments.size < 1 ||
    [...environments].some((value) => !value.trim() || /prod(?:uction)?/iu.test(value)) ||
    Number.isNaN(Date.parse(input.createdAt))
  )
    throw new QaDomainError("QA_AUTOMATED_REQUIREMENT_INVALID");
  const body = Object.freeze({
    schemaVersion: 2 as const,
    ...structuredClone(input),
    allowedTargetTypes: Object.freeze([...input.allowedTargetTypes]),
    allowedEnvironmentRefs: Object.freeze([...input.allowedEnvironmentRefs]),
    mode: "AUTOMATED" as const,
    suiteSelectionPolicy: "CURRENT_PUBLISHED_AT_SESSION_CREATION" as const,
    capabilityRequirements: qaAutomationRequiredCapabilities,
  });
  return Object.freeze({ ...body, contentHash: qaAggregateSnapshotHash(body as never) });
}

export interface QaRequiredSessionPlanRequirement extends QaRequiredSessionRequirementInput {
  readonly id: string;
  readonly ordinal: number;
  readonly contentHash: QaContentHash;
  readonly carriedForwardFromRequirementRef: null | Readonly<{
    id: string;
    version: number;
    contentHash: QaContentHash;
  }>;
}

export interface QaRequiredSessionPlanRevision {
  readonly id: string;
  readonly version: number;
  readonly previousRevisionRef: null | Readonly<{
    id: string;
    version: number;
    contentHash: QaContentHash;
  }>;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly workItemId: string;
  readonly readinessProofRef: Readonly<{ id: string; version: number; contentHash: QaContentHash }>;
  readonly requirements: readonly QaRequiredSessionPlanRequirement[];
  readonly reason: string;
  readonly publishedBy: QaHumanActor;
  readonly publishedAt: string;
  readonly contentHash: QaContentHash;
}

export interface QaRequiredSessionPlanHeader {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly workItemId: string;
  readonly extensionId: string;
  readonly currentRevisionRef: null | Readonly<{
    id: string;
    version: number;
    contentHash: QaContentHash;
  }>;
  readonly revisions: readonly QaRequiredSessionPlanRevision[];
  readonly resourceVersion: number;
  readonly frozenAt?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function createRequiredSessionPlanHeader(
  input: Readonly<{
    id: string;
    workspaceId: string;
    projectId: string;
    workItemId: string;
    extensionId: string;
    createdAt: string;
  }>,
): QaRequiredSessionPlanHeader {
  if (
    [input.id, input.workspaceId, input.projectId, input.workItemId, input.extensionId].some(
      (value) => value.length === 0,
    ) ||
    Number.isNaN(Date.parse(input.createdAt))
  )
    throw new QaDomainError("QA_PLAN_HEADER_INVALID");
  return Object.freeze({
    ...input,
    currentRevisionRef: null,
    revisions: Object.freeze([]),
    resourceVersion: 1,
    updatedAt: input.createdAt,
  });
}

const key = (ref: QaExternalImmutableRef) =>
  `${ref.kind}\0${ref.id}\0${ref.version}\0${ref.contentHash}`;
const reference = (revision: QaRequiredSessionPlanRevision) =>
  Object.freeze({ id: revision.id, version: revision.version, contentHash: revision.contentHash });

function requirementHash(requirement: QaRequiredSessionRequirementInput): QaContentHash {
  return qaAggregateSnapshotHash(requirement as never);
}

export function publishRequiredSessionPlan(
  input: Readonly<{
    header: QaRequiredSessionPlanHeader;
    expectedResourceVersion: number;
    readiness: Readonly<{
      confirmed: boolean;
      proofRef: { id: string; version: number; contentHash: QaContentHash };
    }>;
    operationalStatus: QaPlanOperationalStatus;
    requirements: readonly QaRequiredSessionRequirementInput[];
    catalogs: Readonly<{
      target: readonly QaExternalImmutableRef[];
      scope: readonly QaExternalImmutableRef[];
      checklist: readonly QaExternalImmutableRef[];
    }>;
    actor: QaHumanActor;
    reason: string;
    publishedAt: string;
    revisionId: string;
  }>,
): Readonly<{ header: QaRequiredSessionPlanHeader; revision: QaRequiredSessionPlanRevision }> {
  if (input.expectedResourceVersion !== input.header.resourceVersion)
    throw new QaDomainError("QA_PLAN_STALE_VERSION");
  if (input.header.frozenAt) throw new QaDomainError("QA_PLAN_FROZEN");
  if (!input.readiness.confirmed) throw new QaDomainError("QA_PLAN_REQUIRES_CONFIRMED_READY");
  if (input.header.currentRevisionRef === null && input.operationalStatus !== "READY")
    throw new QaDomainError("QA_PLAN_INITIAL_REQUIRES_CURRENT_READY");
  if (
    input.header.currentRevisionRef !== null &&
    (input.operationalStatus === "CANCELLED" || input.operationalStatus === "DONE")
  )
    throw new QaDomainError("QA_PLAN_TERMINAL_OPERATIONAL_STATE");
  if (
    input.header.currentRevisionRef !== null &&
    !["READY", "PLANNED", "IN_PROGRESS", "REVIEW", "BLOCKED"].includes(input.operationalStatus)
  )
    throw new QaDomainError("QA_PLAN_OPERATIONAL_STATE_STALE");
  if (input.reason.trim().length < 5 || input.requirements.length === 0)
    throw new QaDomainError("QA_PLAN_INVALID");
  if (!input.requirements.some(({ resolution }) => resolution === "REQUIRED"))
    throw new QaDomainError("QA_PLAN_REQUIRES_REQUIRED_SLOT");
  const keys = new Set<string>();
  const targetCatalog = new Set(input.catalogs.target.map(key));
  const scopeCatalog = new Set(input.catalogs.scope.map(key));
  const checklistCatalog = new Set(input.catalogs.checklist.map(key));
  const previous = input.header.revisions.at(-1);
  const requirements = input.requirements.map(
    (requirement, index): QaRequiredSessionPlanRequirement => {
      if (
        !requirement.requirementKey ||
        keys.has(requirement.requirementKey) ||
        requirement.mode !== "MANUAL" ||
        requirement.minimumSessionCount < 1 ||
        requirement.requiredCapabilities.length === 0
      )
        throw new QaDomainError("QA_PLAN_REQUIREMENT_INVALID");
      keys.add(requirement.requirementKey);
      if (
        !targetCatalog.has(key(requirement.targetPolicyRef)) ||
        !scopeCatalog.has(key(requirement.scopePolicyRef)) ||
        requirement.checklistPolicyRefs.length === 0 ||
        requirement.checklistPolicyRefs.some((ref) => !checklistCatalog.has(key(ref)))
      )
        throw new QaDomainError("QA_PLAN_POLICY_NOT_IN_CATALOG");
      if ((requirement.resolution === "WAIVED") !== (requirement.waiverRef !== undefined))
        throw new QaDomainError("QA_PLAN_WAIVER_REF_INVALID");
      const contentHash = requirementHash(requirement);
      const predecessor = previous?.requirements.find(
        (candidate) =>
          candidate.requirementKey === requirement.requirementKey &&
          candidate.contentHash === contentHash,
      );
      return Object.freeze({
        ...structuredClone(requirement),
        id: `${input.revisionId}:${requirement.requirementKey}`,
        ordinal: index + 1,
        contentHash,
        carriedForwardFromRequirementRef: predecessor
          ? { id: predecessor.id, version: previous!.version, contentHash: predecessor.contentHash }
          : null,
      });
    },
  );
  const body = Object.freeze({
    id: input.revisionId,
    version: input.header.revisions.length + 1,
    previousRevisionRef: previous ? reference(previous) : null,
    workspaceId: input.header.workspaceId,
    projectId: input.header.projectId,
    workItemId: input.header.workItemId,
    readinessProofRef: structuredClone(input.readiness.proofRef),
    requirements: Object.freeze(requirements),
    reason: input.reason,
    publishedBy: structuredClone(input.actor),
    publishedAt: input.publishedAt,
  });
  const revision = Object.freeze({ ...body, contentHash: qaAggregateSnapshotHash(body as never) });
  const revisions = Object.freeze([...input.header.revisions, revision]);
  const header = Object.freeze({
    ...input.header,
    currentRevisionRef: reference(revision),
    revisions,
    resourceVersion: input.header.resourceVersion + 1,
    updatedAt: input.publishedAt,
  });
  return Object.freeze({ header, revision });
}

export function assertRequirementCarryForward(
  current: QaRequiredSessionPlanRequirement,
  previous: QaRequiredSessionPlanRequirement,
): void {
  if (
    current.requirementKey !== previous.requirementKey ||
    current.contentHash !== previous.contentHash ||
    current.carriedForwardFromRequirementRef?.id !== previous.id ||
    current.carriedForwardFromRequirementRef.contentHash !== previous.contentHash
  )
    throw new QaDomainError("QA_PLAN_CARRY_FORWARD_INVALID");
}
