import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DenyByDefaultAuthorizationPolicy,
  pilotContentHash,
} from "../../../packages/platform-core/src/index.ts";
import { TypeOrmCorporateScopedAccessRepository } from "../../../packages/platform-persistence-typeorm/src/index.ts";
import { createInitialPilotCohort } from "../../../packages/runtime-composition/src/pilot/cohort-service.ts";
import { createPilotFenceAction } from "../../../packages/runtime-composition/src/pilot/fence-action.ts";
import { PublishedPilotFence } from "../../../packages/runtime-composition/src/pilot/published-fence.ts";

const workspaceId = "10000000-0000-4000-8000-000000000001";
const projectId = "20000000-0000-4000-8000-000000000001";
const humanId = "30000000-0000-4000-8000-000000000001";
const workerId = "40000000-0000-4000-8000-000000000001";
const cohortId = "50000000-0000-4000-8000-000000000001";
const fenceId = "60000000-0000-4000-8000-000000000001";
const actionId = "70000000-0000-4000-8000-000000000001";
const hash = `sha256:${"a".repeat(64)}` as const;
const ref = { id: "deployment", version: 1, contentHash: hash };
const scope = { workspaceId, projectId };
function row(id: string, kind: string, body: unknown) {
  const semantic_body = {
    id,
    kind,
    schemaVersion: 1,
    version: 1,
    ...scope,
    actorRef: humanId,
    correlationId: actionId,
    createdAt: "2026-01-01T00:00:00.000Z",
    body,
  };
  return {
    record_id: id,
    current_version: 1,
    semantic_body,
    content_hash: pilotContentHash(semantic_body),
  };
}
function fixture() {
  const onboardingBody = {
    ...scope,
    onboardingId: "onboarding",
    revisionId: "revision",
    version: 1,
    stage: "PILOT_ACTIVE",
    operationalState: "ACTIVE",
  };
  const onboardingHash = pilotContentHash(onboardingBody) as `sha256:${string}`;
  const onboardingRef = { id: "revision", version: 1, contentHash: onboardingHash };
  const cohort = createInitialPilotCohort({
    cohortId,
    projects: [{ ...scope, onboardingRef }],
    userIds: [humanId],
    channelRefs: ["web"],
    environmentRefs: ["dev"],
    suiteRefs: ["suite"],
    gateRefs: (["L0", "C1", "N2", "P3"] as const).map((kind) => ({
      kind,
      id: kind,
      contentHash: hash,
    })),
    startAt: "2026-01-01T00:00:00.000Z",
    endAt: "2099-01-01T00:00:00.000Z",
    sponsorRef: "sponsor",
    qaLeadRef: "lead",
    onCallRef: "oncall",
    rollbackRunbookRef: "runbook",
    comparisonProtocolRef: { id: "protocol", contentHash: hash },
  });
  const cohortRow = row(cohortId, "COHORT", cohort);
  const cohortRef = {
    id: cohortId,
    version: 1,
    contentHash: cohortRow.content_hash as `sha256:${string}`,
  };
  const body = {
    schemaVersion: 1 as const,
    mode: "COHORT_WRITES" as const,
    environment: "NON_PROD" as const,
    deploymentRef: ref,
    cohortRef,
    runtimeInstanceId: workerId,
    startsAt: cohort.startAt,
    expiresAt: cohort.endAt,
    revoked: false,
  };
  const candidate = createPilotFenceAction(
    {
      ...scope,
      actionId,
      expectedOnboardingVersion: 1,
      initiator: {
        kind: "HUMAN",
        principalId: humanId,
        roleKey: "system-administrator",
        authorizationBasisRef: ref,
        authenticationContextRef: ref,
      },
      reason: "fixture",
      createdAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2026-01-01T00:05:00.000Z",
    },
    { schemaVersion: 1, fenceId, cohortId, fence: body, cohort },
  );
  const proof = {
    candidate_ref: candidate,
    content_hash: candidate.contentHash,
    subject_hash: candidate.contentHash,
    decision_state: "APPROVED",
    effect_authorization_state: "CONSUMED",
    subject: {
      actionKind: "PILOT_FENCE_PUBLISH",
      actionId: candidate.actionId,
      targetHash: candidate.contentHash,
      initiatorPrincipalId: humanId,
      approver: { principalId: "another" },
      stepUpAt: "2026-01-01T00:00:00.000Z",
    },
  };
  let fenceRow = row(fenceId, "FENCE", body);
  let activeCohort = cohortRow;
  let onboardingRow = {
    onboarding_id: onboardingBody.onboardingId,
    current_version: 1,
    revision_id: onboardingBody.revisionId,
    content_hash: onboardingHash,
    semantic_body: { ...onboardingBody, contentHash: onboardingHash },
  };
  const query = vi.fn(async (sql: string) =>
    sql.includes("h.kind='FENCE'")
      ? [fenceRow]
      : sql.includes("h.kind='COHORT'")
        ? [activeCohort]
        : sql.includes("FROM platform_actions")
          ? [proof]
          : [onboardingRow],
  );
  const port = new PublishedPilotFence({ isInitialized: true, query } as never, workspaceId, [
    projectId,
  ]);
  return {
    port,
    body,
    cohort,
    cohortRow,
    setFence: (value: typeof fenceRow) => {
      fenceRow = value;
    },
    setCohort: (value: typeof cohortRow) => {
      activeCohort = value;
    },
    tamperOnboarding: () => {
      onboardingRow = {
        ...onboardingRow,
        semantic_body: { ...onboardingRow.semantic_body, stage: "DRAFT" },
      };
    },
  };
}
afterEach(() => vi.restoreAllMocks());

describe("published pilot fence", () => {
  it("derives scope and principal membership from the exact current cohort", async () => {
    const f = fixture();
    expect(await f.port.current(scope)).toMatchObject({
      ...scope,
      mode: "COHORT_WRITES",
      revoked: false,
      runtimeInstanceId: workerId,
      projectIds: [projectId],
      principalIds: [humanId],
    });
    expect(await f.port.current({ ...scope, projectId: "other" })).toBeUndefined();
  });
  it("rejects changed cohort heads and tampered fence records", async () => {
    const f = fixture();
    f.setCohort({ ...f.cohortRow, current_version: 2 });
    await expect(f.port.current(scope)).rejects.toThrow("PILOT_FENCE_UNAVAILABLE");
    f.setCohort(f.cohortRow);
    f.setFence({ ...row(fenceId, "FENCE", f.body), content_hash: hash });
    await expect(f.port.current(scope)).rejects.toThrow("PILOT_FENCE_UNAVAILABLE");
  });
  it("closes a revoked fence and rejects a fence outside the cohort window", async () => {
    const f = fixture();
    f.setFence(row(fenceId, "FENCE", { ...f.body, revoked: true }));
    expect(await f.port.current(scope)).toBeUndefined();
    f.setFence(
      row(fenceId, "FENCE", {
        ...f.body,
        startsAt: "2100-01-01T00:00:00.000Z",
        expiresAt: "2101-01-01T00:00:00.000Z",
      }),
    );
    expect(await f.port.current(scope)).toBeUndefined();
  });
  it("rejects an onboarding body that no longer matches its approved hash", async () => {
    const f = fixture();
    f.tamperOnboarding();
    expect(await f.port.current(scope)).toBeUndefined();
  });
  it("rechecks current human rights and pilot activation", async () => {
    const f = fixture();
    const query = vi.fn(async (sql: string) =>
      sql.includes("FROM identities")
        ? [{ issuer: "issuer", subject: "human", kind: "HUMAN" }]
        : [{ current_stage: "PILOT_ACTIVE", current_operational_state: "ACTIVE" }],
    );
    const port = new PublishedPilotFence({ isInitialized: true, query } as never, workspaceId, [
      projectId,
    ]);
    vi.spyOn(TypeOrmCorporateScopedAccessRepository.prototype, "getWorkspace").mockResolvedValue({
      state: "ACTIVE",
    } as never);
    vi.spyOn(TypeOrmCorporateScopedAccessRepository.prototype, "getProject").mockResolvedValue({
      state: "ACTIVE",
      classification: { key: "INTERNAL", rank: 10 },
    } as never);
    vi.spyOn(
      TypeOrmCorporateScopedAccessRepository.prototype,
      "authorizationFacts",
    ).mockResolvedValue({} as never);
    const decide = vi
      .spyOn(DenyByDefaultAuthorizationPolicy.prototype, "decide")
      .mockReturnValue({ allowed: true } as never);
    const context = {
      principalId: humanId,
      purpose: "BUSINESS" as const,
      deploymentRef: ref,
      cohortRef: ref,
      fenceRef: ref,
    };
    expect(await port.authorize(scope, context)).toBe(true);
    decide.mockReturnValue({ allowed: false } as never);
    expect(await port.authorize(scope, context)).toBe(false);
    expect(f.cohort.state).toBe("CURRENT");
  });
});
