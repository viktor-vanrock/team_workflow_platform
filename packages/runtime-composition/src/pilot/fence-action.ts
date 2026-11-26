import { designContractRegistry, type JsonValue, pilotSchemaIds } from "@awp/platform-contracts";
import {
  assertExactRevisionRef,
  createProjectActionCandidate,
  pilotContentHash,
  type ProjectActionCandidate,
} from "@awp/platform-core";

import type { PilotCohortRevision } from "./cohort-service.ts";
import type { PublishedPilotFenceV1 } from "./published-fence.ts";

export interface PilotFenceActionDetails {
  readonly schemaVersion: 1;
  readonly fenceId: string;
  readonly cohortId: string;
  readonly fence: PublishedPilotFenceV1;
  readonly cohort: PilotCohortRevision;
}
export type PilotFenceAction = ProjectActionCandidate &
  Readonly<{ pilotFence: PilotFenceActionDetails }>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export function pilotFenceCohortRecord(
  input: Pick<
    ProjectActionCandidate,
    "workspaceId" | "projectId" | "actionId" | "createdAt" | "initiator"
  >,
  details: PilotFenceActionDetails,
) {
  const body = {
    id: details.cohortId,
    version: 1,
    schemaVersion: 1 as const,
    kind: "COHORT" as const,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    actorRef: input.initiator.principalId,
    correlationId: input.actionId,
    createdAt: input.createdAt,
    body: details.cohort as unknown as Readonly<Record<string, JsonValue>>,
  };
  return { ...body, contentHash: pilotContentHash(body) };
}

/** Pins the complete proposed rules in the existing exact project-action approval subject. */
export function createPilotFenceAction(
  input: Omit<ProjectActionCandidate, "kind" | "contentHash" | "targetRef" | "prerequisiteRefs">,
  details: PilotFenceActionDetails,
): PilotFenceAction {
  designContractRegistry.validateById(pilotSchemaIds.fenceAction, details);
  if (
    details.schemaVersion !== 1 ||
    !uuid.test(details.fenceId) ||
    !uuid.test(details.cohortId) ||
    details.cohort.cohortId !== details.cohortId ||
    details.cohort.version !== 1 ||
    details.cohort.state !== "CURRENT" ||
    details.fence.revoked ||
    details.fence.environment !== "NON_PROD" ||
    details.fence.schemaVersion !== 1 ||
    details.fence.cohortRef.id !== details.cohortId ||
    details.fence.cohortRef.version !== 1 ||
    details.cohort.projects.length !== 1 ||
    details.cohort.projects[0]!.workspaceId !== input.workspaceId ||
    details.cohort.projects[0]!.projectId !== input.projectId ||
    ![input.expectedOnboardingVersion, input.expectedOnboardingVersion - 1].includes(
      details.cohort.projects[0]!.onboardingRef.version,
    ) ||
    !uuid.test(details.fence.runtimeInstanceId) ||
    !["COHORT_WRITES", "SANDBOX_CONFORMANCE"].includes(details.fence.mode) ||
    !Number.isFinite(Date.parse(details.fence.startsAt)) ||
    !Number.isFinite(Date.parse(details.fence.expiresAt)) ||
    Date.parse(details.fence.startsAt) >= Date.parse(details.fence.expiresAt) ||
    Date.parse(details.fence.startsAt) < Date.parse(details.cohort.startAt) ||
    Date.parse(details.fence.expiresAt) > Date.parse(details.cohort.endAt) ||
    details.cohort.userIds.some((id) => !uuid.test(id)) ||
    Object.keys(details.fence).some(
      (key) =>
        ![
          "schemaVersion",
          "mode",
          "environment",
          "deploymentRef",
          "cohortRef",
          "runtimeInstanceId",
          "startsAt",
          "expiresAt",
          "revoked",
        ].includes(key),
    )
  )
    throw new Error("PILOT_FENCE_ACTION_INVALID");
  assertExactRevisionRef(details.fence.deploymentRef);
  assertExactRevisionRef(details.fence.cohortRef);
  assertExactRevisionRef(details.cohort.projects[0]!.onboardingRef);
  const { contentHash, ...cohortBody } = details.cohort;
  if (
    pilotContentHash(cohortBody) !== contentHash ||
    pilotFenceCohortRecord(input, details).contentHash !== details.fence.cohortRef.contentHash
  )
    throw new Error("PILOT_FENCE_ACTION_INVALID");
  const detailsCopy = structuredClone(details);
  const targetRef = {
    id: details.fenceId,
    version: 1,
    contentHash: pilotContentHash(detailsCopy) as `sha256:${string}`,
  };
  const candidate = createProjectActionCandidate({
    ...input,
    kind: "PILOT_FENCE_PUBLISH",
    targetRef,
    prerequisiteRefs: [details.fence.deploymentRef],
    pilotFence: detailsCopy,
  } as Omit<ProjectActionCandidate, "contentHash">);
  return candidate as PilotFenceAction;
}

/** A caller cannot substitute rules after the distinct approver signs the candidate hash. */
export function assertPilotFenceActionDetails(candidate: PilotFenceAction): void {
  if (
    candidate.kind !== "PILOT_FENCE_PUBLISH" ||
    candidate.targetRef.id !== candidate.pilotFence.fenceId ||
    candidate.targetRef.contentHash !== pilotContentHash(candidate.pilotFence)
  )
    throw new Error("PILOT_FENCE_ACTION_INVALID");
  const { contentHash, ...body } = candidate;
  if (pilotContentHash(body as unknown as JsonValue) !== contentHash)
    throw new Error("PILOT_FENCE_ACTION_INVALID");
  const rebuilt = createPilotFenceAction(
    {
      actionId: candidate.actionId,
      workspaceId: candidate.workspaceId,
      projectId: candidate.projectId,
      expectedOnboardingVersion: candidate.expectedOnboardingVersion,
      initiator: candidate.initiator,
      reason: candidate.reason,
      createdAt: candidate.createdAt,
      expiresAt: candidate.expiresAt,
    },
    candidate.pilotFence,
  );
  if (rebuilt.contentHash !== contentHash) throw new Error("PILOT_FENCE_ACTION_INVALID");
}
