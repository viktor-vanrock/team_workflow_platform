import { describe, expect, it } from "vitest";

import { type JsonValue, sha256 } from "../../../packages/platform-contracts/src/index.ts";
import {
  authorizePilotDispatch,
  createInitialPilotCohort,
  expandPilotCohort,
} from "../../../packages/runtime-composition/src/pilot/cohort-service.ts";

const hash = (value: unknown) => sha256(value as JsonValue);
const project = (projectId: string) => ({
  workspaceId: "workspace",
  projectId,
  onboardingRef: { id: `onboarding:${projectId}`, version: 3, contentHash: hash(projectId) },
});
const cohortInput = (projects = [project("project-a")]) => ({
  cohortId: "cohort",
  userIds: ["user-a"],
  channelRefs: ["channel-a"],
  environmentRefs: ["pilot-env"],
  suiteRefs: ["full-qa"],
  gateRefs: (["L0", "C1", "N2", "P3"] as const).map((kind) => ({
    kind,
    id: `gate:${kind}`,
    contentHash: hash(kind),
  })),
  startAt: "2026-09-03T10:00:00.000Z",
  endAt: "2026-09-03T12:00:00.000Z",
  sponsorRef: "human:sponsor",
  qaLeadRef: "human:qa",
  onCallRef: "on-call:1",
  rollbackRunbookRef: "runbook:rollback",
  comparisonProtocolRef: { id: "comparison:1", contentHash: hash("comparison") },
  projects,
});
const cohort = () => createInitialPilotCohort(cohortInput());

describe("Feature 008 pilot cohort", () => {
  it("starts with one project, expands one project per immutable revision and grants no entitlements", () => {
    const initial = cohort();
    expect(initial.projects).toHaveLength(1);
    const expanded = expandPilotCohort(initial, project("project-b"));
    expect(expanded).toMatchObject({ version: 2, predecessorHash: initial.contentHash });
    expect(expanded.projects.map((value) => value.projectId)).toEqual(["project-a", "project-b"]);
    expect(expanded).not.toHaveProperty("entitlements");
    expect(() => createInitialPilotCohort(cohortInput([project("a"), project("b")]))).toThrow(
      "PILOT_INITIAL_COHORT_ONE_PROJECT_REQUIRED",
    );
  });

  it("rechecks window, revocation, suspension and exact cohort at dispatch", () => {
    const current = cohort();
    const input = {
      cohort: current,
      pinnedCohortHash: current.contentHash,
      workspaceId: "workspace",
      projectId: "project-a",
      userId: "user-a",
      channelRef: "channel-a",
      environmentRef: "pilot-env",
      onboardingStage: "PILOT_ACTIVE",
      operationalState: "ACTIVE",
      now: "2026-09-03T11:00:00.000Z",
    };
    expect(authorizePilotDispatch(input)).toMatchObject({ allowed: true });
    expect(authorizePilotDispatch({ ...input, now: current.endAt })).toEqual({
      allowed: false,
      reason: "WINDOW_CLOSED",
    });
    expect(authorizePilotDispatch({ ...input, operationalState: "SUSPENDED" })).toEqual({
      allowed: false,
      reason: "PROJECT_SUSPENDED",
    });
    expect(authorizePilotDispatch({ ...input, cohort: { ...current, state: "REVOKED" } })).toEqual({
      allowed: false,
      reason: "COHORT_REVOKED",
    });
    expect(authorizePilotDispatch({ ...input, pinnedCohortHash: hash("drift") })).toEqual({
      allowed: false,
      reason: "COHORT_DRIFT",
    });
  });
});
