import {
  makeScopeSnapshot,
  makeTargetSnapshot,
} from "../../packages/competency-qa/src/domain/snapshots.ts";
import {
  createPlannedTestSession,
  type QaTestSession,
} from "../../packages/competency-qa/src/domain/test-session.ts";

const hash = (value: string) => `sha256:${value.padEnd(64, "0").slice(0, 64)}` as const;
const actor = {
  kind: "HUMAN" as const,
  principalId: "executor",
  issuer: "fake-idp",
  subject: "executor",
};
export function createSessionFixture(
  overrides: Readonly<{
    id: string;
    ordinal: number;
    workspaceId?: string;
    projectId?: string;
    workItemId?: string;
    parentSessionId?: string;
  }>,
): QaTestSession {
  const workspaceId = overrides.workspaceId ?? "workspace-a",
    projectId = overrides.projectId ?? "project-a",
    workItemId = overrides.workItemId ?? "work-item-a";
  return createPlannedTestSession({
    id: overrides.id,
    workspaceId,
    projectId,
    workItemId,
    ordinal: overrides.ordinal,
    ...(overrides.parentSessionId ? { parentSessionId: overrides.parentSessionId } : {}),
    planRevisionRef: { id: "plan", version: 1, contentHash: hash("plan") },
    requirementRef: {
      id: "requirement",
      version: 1,
      contentHash: hash("requirement"),
      requirementKey: "primary",
    },
    ownerId: actor.principalId,
    requiredCapabilities: ["manual"],
    targetSnapshot: makeTargetSnapshot({
      workspaceId,
      projectId,
      buildRef: { kind: "build", id: "build", version: "1", contentHash: hash("build") },
      environmentRef: { id: "env", revision: 1, scope: "NON_PROD" },
      testDataRef: { kind: "data", id: "data", version: "1", contentHash: hash("data") },
      checklistRefs: [{ kind: "checklist", id: "check", version: "1", contentHash: hash("check") }],
      bindingRef: { id: "binding", version: 2 },
      profileRefs: [{ id: "profile", version: 2 }],
    }),
    scopeSnapshot: makeScopeSnapshot({
      purpose: "feature-validation",
      agreedScope: "Scope",
      acceptanceOutcome: "Outcome",
      inclusions: ["included"],
      exclusions: [],
      checklistDefinition: {
        kind: "definition",
        id: "definition",
        version: "1",
        contentHash: hash("definition"),
      },
    }),
    createdBy: actor,
    createdAt: "2026-08-30T10:00:00.000Z",
  });
}
