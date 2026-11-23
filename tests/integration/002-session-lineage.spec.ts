import assert from "node:assert/strict";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { QaSessionsController } from "../../apps/api/src/extensions/qa-sessions.controller.ts";
import { createLocalQaSessionRuntime } from "../../apps/api/src/local/local-qa-session-runtime.ts";
import { createPlannedTestSession } from "../../packages/competency-qa/src/domain/test-session.ts";
import {
  type QaRequestExtension,
  type QaRequestInputRevision,
  QaTypeOrmIntakeConfirmationWriter,
} from "../../packages/competency-qa/src/node.ts";
import {
  InMemoryManualSessionRepository,
  TypeOrmManualSessionRepository,
} from "../../packages/competency-qa/src/persistence/manual-session.repository.ts";
import { createPlatformDataSource } from "../../packages/platform-persistence-typeorm/src/index.ts";
import {
  type RunningPostgres,
  startPostgres,
} from "../../packages/platform-testkit/src/postgres.ts";
import {
  qaLocalEntities,
  qaLocalMigrations,
} from "../../packages/runtime-composition/src/qa/composition.ts";
import {
  localPersonaIds,
  localSeedIds,
} from "../../packages/runtime-composition/src/seed/local-seed.ts";
import {
  qaLocalSeedIds,
  runQaLocalSeed,
} from "../../packages/runtime-composition/src/seed/qa-local-seed.ts";
import { createSessionFixture } from "../support/002-session-fixture.ts";
import { currentManualSessionEtag, localQaTestRequest } from "../support/008-qa-request.ts";
import { requiredFixture } from "../support/fixture-value.ts";
import { POSTGRES_TEST_IMAGES } from "../testcontainers.config.ts";

const digest = (value: string) => `sha256:${value.padEnd(64, "0").slice(0, 64)}` as const;
const inputId = "a2100000-0000-4000-8000-000000000001";
const extensionId = "a3100000-0000-4000-8000-000000000001";
const assessmentId = "a4100000-0000-4000-8000-000000000001";
const planId = "a5100000-0000-4000-8000-000000000001";
const planVersionId = "a6100000-0000-4000-8000-000000000001";
const requirementId = "a7100000-0000-4000-8000-000000000001";
const actor = {
  kind: "HUMAN" as const,
  principalId: localPersonaIds["executor.alpha"],
  issuer: "https://fake-idp:4443/oidc",
  subject: "executor.alpha",
};

let postgres: RunningPostgres | undefined;
let source: ReturnType<typeof createPlatformDataSource> | undefined;

function databaseSession(
  input: Readonly<{
    id: string;
    ordinal: number;
    workItemId?: string;
    projectId?: string;
    parentSessionId?: string;
  }>,
) {
  const projectId = input.projectId ?? localSeedIds.alpha;
  const workItemId = input.workItemId ?? localSeedIds.workItem;
  const fixture = createSessionFixture({
    id: input.id,
    ordinal: input.ordinal,
    workspaceId: localSeedIds.workspaceFunctional,
    projectId,
    workItemId,
  });
  return createPlannedTestSession({
    id: input.id,
    workspaceId: localSeedIds.workspaceFunctional,
    projectId,
    workItemId,
    ordinal: input.ordinal,
    ...(input.parentSessionId ? { parentSessionId: input.parentSessionId } : {}),
    planRevisionRef: { id: planVersionId, version: 1, contentHash: digest("plan") },
    requirementRef: {
      id: requirementId,
      version: 1,
      contentHash: digest("requirement"),
      requirementKey: "primary",
      ordinal: 1,
    },
    ownerId: actor.principalId,
    requiredCapabilities: ["manual"],
    targetSnapshot: fixture.targetSnapshot,
    scopeSnapshot: fixture.scopeSnapshot,
    createdBy: actor,
    createdAt: "2026-08-30T10:00:00.000Z",
  });
}

beforeAll(async () => {
  postgres = await startPostgres(POSTGRES_TEST_IMAGES[0]!);
  source = createPlatformDataSource({
    url: postgres.url,
    entities: qaLocalEntities,
    migrations: qaLocalMigrations,
  });
  await source.initialize();
  await source.runMigrations({ transaction: "all" });
  await runQaLocalSeed(source);
  Object.assign(process.env, {
    AWP_RUNTIME_PROFILE: "test",
    AWP_COMPOSITION: "qa-local",
    AWP_EXTERNAL_NETWORK_MODE: "deny",
    AWP_IDENTITY_ISSUER: "https://fake-idp:4443/oidc",
    AWP_MOCK_HUB_URL: "http://127.0.0.1:1",
  });
  const input: QaRequestInputRevision = {
    schemaVersion: 1,
    inputRevisionId: inputId,
    version: 1,
    previousRevisionRef: null,
    workspaceId: localSeedIds.workspaceFunctional,
    projectId: localSeedIds.alpha,
    workItemId: localSeedIds.workItem,
    definitionRef: { key: "qa.validation", version: "1.0.0" },
    acceptedDraftRef: {
      kind: "intake-draft",
      id: "draft",
      version: "1",
      contentHash: digest("draft"),
    },
    externalRequestRef: {
      kind: "request",
      id: "REQ-session",
      version: "2",
      contentHash: digest("external"),
    },
    operationalBindingRef: { id: qaLocalSeedIds.alphaBinding, version: 2 },
    originalRequesterRef: actor,
    title: "Session lineage",
    requestKind: "feature-validation",
    goal: "Validate",
    scope: "Manual scope",
    acceptanceOutcome: "Outcome",
    blockersDeclared: true,
    blockers: [],
    dependenciesDeclared: true,
    dependencies: [],
    requestedTarget: {
      environmentId: qaLocalSeedIds.environment,
      environmentRevision: 1,
      buildRef: { kind: "build", id: "build", version: "1", contentHash: digest("build") },
      testDataRef: { kind: "test-data", id: "data", version: "1", contentHash: digest("data") },
    },
    dataClassificationKey: "INTERNAL",
    responseChannelResolution: {
      state: "MISSING",
      requesterPrincipal: actor,
      resolutionPolicyRef: { key: "response", version: "1", contentHash: digest("response") },
      evaluatedAt: "2026-08-30T10:00:00.000Z",
      missingReasonCode: "NOT_NEEDED_FOR_LINEAGE",
    },
    readyEffectGuard: { observedState: "NONE", expectedAggregateVersion: 1 },
    invalidatedState: { readinessAssessmentRefs: [], waiverRefs: [], pendingReadyCommandRefs: [] },
    changeReasonCode: "INITIAL_CONFIRMED_DRAFT",
    contentHash: digest("input"),
    recordedBy: actor,
    authorizationBasisHash: digest("auth"),
    recordedAt: "2026-08-30T10:00:00.000Z",
    correlationId: "a8100000-0000-4000-8000-000000000001",
  };
  const extension: QaRequestExtension = {
    schemaVersion: 1,
    extensionId,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    workItemId: input.workItemId,
    definitionRef: input.definitionRef,
    currentRequestInputRevisionRef: { id: inputId, version: 1, contentHash: input.contentHash },
    projectContextRef: { id: qaLocalSeedIds.context, version: 1, contentHash: digest("context") },
    dorRuleSetRef: { key: "qa.dor", version: "1", contentHash: digest("dor") },
    dodRuleSetRef: { key: "qa.dod", version: "1", contentHash: digest("dod") },
    evidencePolicyRef: { key: "qa.evidence", version: "1", contentHash: digest("evidence") },
    riskReviewPolicyRef: { id: qaLocalSeedIds.riskPolicy, version: 1, contentHash: digest("risk") },
    adjudicativeAggregateHash: digest("aggregate"),
    completionDispatchGuard: { state: "OPEN" },
    resourceVersion: 1,
    contentHash: digest("extension"),
    createdBy: actor,
    createdAt: input.recordedAt,
    updatedAt: input.recordedAt,
    correlationId: input.correlationId,
  };
  await source.transaction(
    async (manager) =>
      await new QaTypeOrmIntakeConfirmationWriter().persist(
        {
          transactionId: "session-lineage",
          native: manager,
          contributionKey: "qa.request-create.confirmation",
          idempotencyKey: "session-lineage",
        },
        { extension, initialInput: input },
      ),
  );
  const plan = {
    id: planVersionId,
    version: 1,
    previousRevisionRef: null,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    workItemId: input.workItemId,
    readinessProofRef: { id: assessmentId, version: 1, contentHash: digest("ready") },
    requirements: [
      {
        id: requirementId,
        ordinal: 1,
        requirementKey: "primary",
        mode: "MANUAL",
        purpose: "feature-validation",
        minimumSessionCount: 1,
        requiredCapabilities: ["manual"],
        targetPolicyRef: {
          kind: "target-policy",
          id: "target",
          version: "1",
          contentHash: digest("target"),
        },
        scopePolicyRef: {
          kind: "scope-policy",
          id: "scope",
          version: "1",
          contentHash: digest("scope"),
        },
        checklistPolicyRefs: [
          { kind: "checklist", id: "check", version: "1", contentHash: digest("check") },
        ],
        resolution: "REQUIRED",
        contentHash: digest("requirement"),
        carriedForwardFromRequirementRef: null,
      },
    ],
    reason: "Initial plan",
    publishedBy: actor,
    publishedAt: input.recordedAt,
    contentHash: digest("plan"),
  };
  await source.transaction(async (manager) => {
    await manager.query(
      "INSERT INTO qa_readiness_assessments(assessment_id,workspace_id,project_id,work_item_id,input_revision_id,input_revision_version,input_content_hash,extension_resource_version,assessment_version,state,input_fingerprint,content_hash,content,evaluated_at) VALUES($1,$2,$3,$4,$5,1,$6,1,1,'READY',$7,$8,$9,$10)",
      [
        assessmentId,
        input.workspaceId,
        input.projectId,
        input.workItemId,
        inputId,
        input.contentHash,
        digest("fingerprint"),
        digest("ready"),
        JSON.stringify({ state: "READY" }),
        input.recordedAt,
      ],
    );
    await manager.query(
      "INSERT INTO qa_required_session_plans(plan_id,workspace_id,project_id,work_item_id,extension_id,resource_version,created_at,updated_at) VALUES($1,$2,$3,$4,$5,1,$6,$6)",
      [planId, input.workspaceId, input.projectId, input.workItemId, extensionId, input.recordedAt],
    );
    await manager.query(
      "INSERT INTO qa_required_session_plan_versions(plan_version_id,workspace_id,project_id,work_item_id,plan_id,version,readiness_assessment_id,content_hash,content,published_at) VALUES($1,$2,$3,$4,$5,1,$6,$7,$8,$9)",
      [
        planVersionId,
        input.workspaceId,
        input.projectId,
        input.workItemId,
        planId,
        assessmentId,
        plan.contentHash,
        JSON.stringify(plan),
        input.recordedAt,
      ],
    );
    await manager.query(
      "INSERT INTO qa_required_session_plan_requirements(requirement_id,workspace_id,project_id,work_item_id,plan_version_id,requirement_key,ordinal,mode,minimum_session_count,resolution,content_hash,content) VALUES($1,$2,$3,$4,$5,'primary',1,'MANUAL',1,'REQUIRED',$6,$7)",
      [
        requirementId,
        input.workspaceId,
        input.projectId,
        input.workItemId,
        planVersionId,
        plan.requirements[0]!.contentHash,
        JSON.stringify(plan.requirements[0]),
      ],
    );
    await manager.query(
      "UPDATE qa_required_session_plans SET current_version_id=$1,current_version=1,current_content_hash=$2,resource_version=2 WHERE plan_id=$3",
      [planVersionId, plan.contentHash, planId],
    );
    await manager.query(
      "UPDATE work_items SET state='READY' WHERE workspace_id=$1 AND project_id=$2 AND id=$3",
      [input.workspaceId, input.projectId, input.workItemId],
    );
  });
}, 120_000);

afterAll(async () => {
  if (source?.isInitialized) await source.destroy();
  await postgres?.stop();
});

describe("multiple Session lineage", () => {
  it("allocates a unique work-item ordinal and rejects cross-scope/cycles", async () => {
    const repository = new InMemoryManualSessionRepository();
    const first = createSessionFixture({ id: "s1", ordinal: 1 });
    await repository.insert(first);
    const second = createSessionFixture({ id: "s2", ordinal: 2, parentSessionId: "s1" });
    await repository.insert(second);
    await expect(repository.insert(createSessionFixture({ id: "s3", ordinal: 2 }))).rejects.toThrow(
      "QA_SESSION_ORDINAL_CONFLICT",
    );
    await expect(
      repository.insert(
        createSessionFixture({ id: "s4", ordinal: 3, projectId: "other", parentSessionId: "s1" }),
      ),
    ).rejects.toThrow("QA_SESSION_PARENT_SCOPE_MISMATCH");
    await expect(repository.reparent("s1", "s2")).rejects.toThrow("QA_SESSION_PARENT_CYCLE");
  });

  it("enforces ordinal, work-item/project lineage and cycles in real PostgreSQL", async () => {
    const repository = new TypeOrmManualSessionRepository(source!);
    const first = databaseSession({ id: "b1100000-0000-4000-8000-000000000001", ordinal: 1 });
    await repository.insert(first);
    const second = databaseSession({
      id: "b1100000-0000-4000-8000-000000000002",
      ordinal: 2,
      parentSessionId: first.id,
    });
    await repository.insert(second);
    await expect(
      repository.insert(
        databaseSession({ id: "b1100000-0000-4000-8000-000000000003", ordinal: 2 }),
      ),
    ).rejects.toThrow(/unique|duplicate/iu);
    const otherWorkItem = "b2100000-0000-4000-8000-000000000001";
    await source!.query(
      "INSERT INTO work_items(id,workspace_id,project_id,work_type_definition_id,created_by,state,classification_key,created_at) VALUES($1,$2,$3,$4,$5,'READY','INTERNAL',clock_timestamp())",
      [
        otherWorkItem,
        localSeedIds.workspaceFunctional,
        localSeedIds.alpha,
        qaLocalSeedIds.workType,
        actor.principalId,
      ],
    );
    await expect(
      repository.insert(
        databaseSession({
          id: "b1100000-0000-4000-8000-000000000004",
          ordinal: 1,
          workItemId: otherWorkItem,
          parentSessionId: first.id,
        }),
      ),
    ).rejects.toThrow(/QA_SESSION_PARENT_SCOPE_MISMATCH/iu);
    await expect(
      source!.transaction(async (manager) => {
        await manager.query(
          "UPDATE qa_test_sessions SET parent_session_id=$1 WHERE session_id=$2",
          [second.id, first.id],
        );
      }),
    ).rejects.toThrow(/QA_SESSION_PARENT_CYCLE/iu);
    await expect(
      source!.query(
        "UPDATE qa_test_sessions SET structure_revision=structure_revision+1 WHERE session_id=$1",
        [first.id],
      ),
    ).rejects.toThrow(/QA_SESSION_STRUCTURE_UOW_REQUIRED/iu);
    await expect(
      source!.query(
        "UPDATE qa_test_sessions SET state='READY',ready_against_structure_hash=$1 WHERE session_id=$2",
        [digest("stale"), first.id],
      ),
    ).rejects.toThrow(/QA_SESSION_READY_HASH_STALE|check constraint/iu);
    await expect(
      source!.query(
        "INSERT INTO qa_plan_items(plan_item_id,workspace_id,project_id,work_item_id,session_id,ordinal,state,mode,title,expected_outcome,definition_ref,definition_hash,content_hash,content,resource_version,created_by,created_at,updated_at) VALUES($1,$2,$3,$4,$5,1,'PLANNED','MANUAL','Bypass','Outcome',$6,$7,$8,'{}',1,$9,clock_timestamp(),clock_timestamp())",
        [
          "b3100000-0000-4000-8000-000000000001",
          localSeedIds.workspaceFunctional,
          localSeedIds.alpha,
          localSeedIds.workItem,
          first.id,
          JSON.stringify({
            kind: "session-plan-item-snapshot",
            snapshotHash: digest("definition"),
          }),
          digest("definition"),
          digest("item"),
          JSON.stringify(actor),
        ],
      ),
    ).rejects.toThrow(/QA_PLAN_ITEM_UOW_REQUIRED/iu);
    await source!.query(
      "UPDATE qa_test_sessions SET state='READY',ready_against_structure_hash=structure_hash,ready_at=clock_timestamp() WHERE session_id=$1",
      [second.id],
    );
    await source!.query(
      "UPDATE qa_test_sessions SET state='RUNNING',started_at=clock_timestamp() WHERE session_id=$1",
      [second.id],
    );
    await expect(
      source!.query("UPDATE qa_test_sessions SET target_hash=$1 WHERE session_id=$2", [
        digest("tampered"),
        second.id,
      ]),
    ).rejects.toThrow(/SESSION_SNAPSHOT_LOCKED|QA_SESSION_STRUCTURE_UOW_REQUIRED/iu);
    const betaWorkItem = "b2100000-0000-4000-8000-000000000002";
    await source!.query(
      "INSERT INTO work_items(id,workspace_id,project_id,work_type_definition_id,created_by,state,classification_key,created_at) VALUES($1,$2,$3,$4,$5,'READY','INTERNAL',clock_timestamp())",
      [
        betaWorkItem,
        localSeedIds.workspaceFunctional,
        localSeedIds.beta,
        qaLocalSeedIds.workType,
        actor.principalId,
      ],
    );
    await expect(
      repository.insert(
        databaseSession({
          id: "b1100000-0000-4000-8000-000000000005",
          ordinal: 1,
          projectId: localSeedIds.beta,
          workItemId: betaWorkItem,
          parentSessionId: first.id,
        }),
      ),
    ).rejects.toThrow(/foreign key|scope/iu);
  });

  it("starts an independent MANUAL Session through the closed API transitions", async () => {
    const controller = new QaSessionsController(source!, createLocalQaSessionRuntime());
    const request = await localQaTestRequest(source!, "executor.alpha");
    const headers = new Map<string, string>();
    const response = {
      status(_code: number) {
        void _code;
        return this;
      },
      setHeader: (name: string, value: string) => {
        headers.set(name, value);
      },
    };
    const created = await controller.create(
      request,
      localSeedIds.workspaceFunctional,
      localSeedIds.alpha,
      localSeedIds.workItem,
      'W/"1"',
      {
        requiredSessionRequirementRef: {
          planRef: { id: planVersionId, revision: 1, contentHash: digest("plan") },
          requirementKey: "primary",
          ordinal: 1,
          contentHash: digest("requirement"),
        },
      },
      response,
    );
    expect(created).toMatchObject({ state: "PLANNED", resourceVersion: 1 });
    const sessionId = created.sessionId;
    const mutation = await controller.createPlanItem(
      request,
      localSeedIds.workspaceFunctional,
      localSeedIds.alpha,
      localSeedIds.workItem,
      sessionId,
      'W/"1"',
      {
        title: "Manual acceptance check",
        expectedOutcome: "Outcome observed",
        definition: { kind: "session-plan-item-snapshot", snapshotHash: created.structureHash },
      },
      response,
    );
    expect(mutation.session).toMatchObject({
      state: "PLANNED",
      resourceVersion: 2,
      structureRevision: 2,
    });
    const ready = await controller.transition(
      request,
      localSeedIds.workspaceFunctional,
      localSeedIds.alpha,
      localSeedIds.workItem,
      sessionId,
      'W/"2"',
      { requestedState: "READY" },
      response,
    );
    assert("sessionId" in ready, "Expected a persisted manual session, received admission denial");
    expect(ready).toMatchObject({ state: "READY", resourceVersion: 3 });
    const running = await controller.transition(
      request,
      localSeedIds.workspaceFunctional,
      localSeedIds.alpha,
      localSeedIds.workItem,
      sessionId,
      await currentManualSessionEtag(
        source!,
        { workspaceId: localSeedIds.workspaceFunctional, projectId: localSeedIds.alpha },
        sessionId,
      ),
      {
        requestedState: "RUNNING",
        targetInputFingerprint: requiredFixture(ready.targetSnapshotHash),
        scopeInputFingerprint: requiredFixture(ready.scopeSnapshotHash),
        expectedStructureHash: ready.structureHash,
      },
      response,
    );
    expect(running).toMatchObject({
      state: "RUNNING",
      resourceVersion: 4,
      startedAt: expect.any(String),
    });
    await expect(
      controller.updatePlanItem(
        request,
        localSeedIds.workspaceFunctional,
        localSeedIds.alpha,
        localSeedIds.workItem,
        sessionId,
        mutation.planItem.planItemId,
        'W/"4"',
        { title: "Late edit" },
        response,
      ),
    ).rejects.toThrow(/SESSION_SNAPSHOT_LOCKED/iu);
    expect(
      await source!.query(
        "SELECT state,structure_revision,ready_against_structure_hash=structure_hash AS exact_ready_hash FROM qa_test_sessions WHERE session_id=$1",
        [sessionId],
      ),
    ).toEqual([{ state: "RUNNING", structure_revision: 2, exact_ready_hash: true }]);
    expect(headers.get("ETag")).toBe(
      await currentManualSessionEtag(
        source!,
        { workspaceId: localSeedIds.workspaceFunctional, projectId: localSeedIds.alpha },
        sessionId,
      ),
    );
  });
});
