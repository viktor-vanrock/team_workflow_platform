import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { QaAutomationAttemptsController } from "../../../../apps/api/src/extensions/gitlab-automation/qa-automation-attempts.controller.ts";
import {
  createAutomationLaunchConfirmation,
  qaAggregateSnapshotHash,
} from "../../../../packages/competency-qa/src/node.ts";
import {
  qaJiraGitLabLocalEntities,
  qaJiraGitLabLocalMigrations,
  TypeOrmGitLabAutomationAttemptQuery,
} from "../../../../packages/runtime-composition/src/index.ts";
import { localPersonaIds } from "../../../../packages/runtime-composition/src/seed/local-seed.ts";
import {
  startUs3DatabaseFixture,
  stopUs3DatabaseFixture,
  us3Actor,
  type Us3DatabaseFixture,
} from "../../../support/002-us3-database.ts";
import {
  type PreparedUs2AutomationSession,
  prepareUs2AutomationSession,
  us2AutomationAuthorizationBasis,
  us2AutomationSessionId,
} from "../../../support/005-us2-automation.ts";
import { localQaTestRequest } from "../../../support/008-qa-request.ts";

let fixture: Us3DatabaseFixture | undefined;
let prepared: PreparedUs2AutomationSession;
let configurationRevoked = false;
let query: TypeOrmGitLabAutomationAttemptQuery;

const response = () => ({
  statusCode: 201,
  headers: new Map<string, string>(),
  status(code: number) {
    this.statusCode = code;
    return this;
  },
  setHeader(name: string, value: string) {
    this.headers.set(name, value);
  },
});

beforeAll(async () => {
  fixture = await startUs3DatabaseFixture({
    entities: qaJiraGitLabLocalEntities,
    migrations: qaJiraGitLabLocalMigrations,
  });
  prepared = await prepareUs2AutomationSession(fixture);
  query = new TypeOrmGitLabAutomationAttemptQuery(fixture.source, {
    executingService: Object.freeze({
      kind: "SERVICE",
      principalId: localPersonaIds["worker.local"],
      serviceKey: "gitlab-automation",
    }),
    async authorize() {
      if (configurationRevoked) throw new Error("QA_AUTOMATION_CONFIGURATION_REVOKED");
    },
  });
}, 120_000);

afterAll(async () => {
  await stopUs3DatabaseFixture(fixture);
}, 120_000);

describe("US2 launch trust boundary", () => {
  it("rejects stale, mismatched, non-human, revoked, cross-project, and provider-shaped input before any durable effect", async () => {
    const scope = Object.freeze({
      workspaceId: fixture!.workspaceId,
      projectId: fixture!.projectId,
    });
    const current = (await query.launchConfirmation(scope, us2AutomationSessionId)).confirmation;
    const base = Object.freeze({
      scope,
      sessionId: us2AutomationSessionId,
      idempotencyKey: "us2-boundary-launch",
      confirmation: current,
      actor: us3Actor,
      authorizationBasis: us2AutomationAuthorizationBasis,
      authorizationBasisHash: qaAggregateSnapshotHash(us2AutomationAuthorizationBasis as never),
      correlationId: "e6800000-0000-4000-8000-000000000001",
      causationId: "e6800000-0000-4000-8000-000000000002",
      launchedAt: "2026-09-01T08:00:03.000Z",
    });
    await expect(query.launch(Object.freeze({ ...base, ifMatch: 2 }))).rejects.toThrow(
      "QA_AUTOMATION_LAUNCH_STALE_VERSION",
    );
    const mismatched = createAutomationLaunchConfirmation({
      ...current,
      targetSnapshotHash: qaAggregateSnapshotHash("foreign-target" as never),
    });
    await expect(
      query.launch(Object.freeze({ ...base, ifMatch: 1, confirmation: mismatched })),
    ).rejects.toThrow("QA_AUTOMATION_LAUNCH_CONFIRMATION_MISMATCH");
    await expect(
      query.launch(
        Object.freeze({
          ...base,
          ifMatch: 1,
          actor: Object.freeze({
            kind: "SERVICE",
            principalId: "service",
            serviceKey: "forged",
          }) as never,
        }),
      ),
    ).rejects.toThrow("QA_VERIFIED_HUMAN_REQUIRED");
    await expect(
      query.launch(
        Object.freeze({
          ...base,
          scope: Object.freeze({
            workspaceId: fixture!.workspaceId,
            projectId: "00000000-0000-4000-8000-000000000099",
          }),
          ifMatch: 1,
        }),
      ),
    ).rejects.toThrow("QA_AUTOMATED_SESSION_NOT_FOUND");

    configurationRevoked = true;
    await expect(query.launch(Object.freeze({ ...base, ifMatch: 1 }))).rejects.toThrow(
      "QA_AUTOMATION_CONFIGURATION_REVOKED",
    );
    configurationRevoked = false;

    const controller = new QaAutomationAttemptsController(fixture!.source, query);
    await expect(
      controller.launch(
        await localQaTestRequest(fixture!.source, "executor.alpha"),
        scope.workspaceId,
        scope.projectId,
        us2AutomationSessionId,
        "us2-provider-input-forbidden",
        'W/"1"',
        Object.freeze({
          confirmation: current,
          providerInputs: Object.freeze({ ref: "refs/heads/forged", token: "forged" }),
        }),
        response(),
      ),
    ).rejects.toThrow("QA_AUTOMATION_LAUNCH_FIELD_FORBIDDEN:providerInputs");

    const [counts] = (await fixture!.source.query(
      `SELECT
      (SELECT count(*)::int FROM qa_automation_launch_requests WHERE session_id=$1) AS claims,
      (SELECT count(*)::int FROM qa_automation_attempts WHERE session_id=$1) AS attempts,
      (SELECT count(*)::int FROM connector_commands WHERE operation='pipeline.trigger') AS commands,
      (SELECT count(*)::int FROM gitlab_effect_reconciliations) AS effects`,
      [us2AutomationSessionId],
    )) as readonly Record<string, number>[];
    expect(counts).toEqual({ claims: 0, attempts: 0, commands: 0, effects: 0 });
    expect(prepared.planned.session.id).toBe(us2AutomationSessionId);
  }, 120_000);

  it("exposes exact confirmation, 201/200 replay, and closed attempt queries", async () => {
    const scope = Object.freeze({
      workspaceId: fixture!.workspaceId,
      projectId: fixture!.projectId,
    });
    const controller = new QaAutomationAttemptsController(fixture!.source, query);
    const request = await localQaTestRequest(fixture!.source, "executor.alpha");
    const confirmationResponse = response();
    const current = await controller.launchConfirmation(
      request,
      scope.workspaceId,
      scope.projectId,
      us2AutomationSessionId,
      confirmationResponse,
    );
    expect(confirmationResponse.headers.get("ETag")).toBe('W/"1"');

    const createdResponse = response();
    const created = await controller.launch(
      request,
      scope.workspaceId,
      scope.projectId,
      us2AutomationSessionId,
      "us2-controller-launch",
      'W/"1"',
      Object.freeze({ confirmation: current }),
      createdResponse,
    );
    expect(createdResponse.statusCode).toBe(201);
    expect(createdResponse.headers.get("ETag")).toBe('W/"2"');
    expect(created).toMatchObject({
      attemptNo: 1,
      currentStatus: "TRIGGER_PENDING",
      execution: { state: "QUEUED" },
    });

    const replayResponse = response();
    const replay = await controller.launch(
      request,
      scope.workspaceId,
      scope.projectId,
      us2AutomationSessionId,
      "us2-controller-launch",
      'W/"1"',
      Object.freeze({ confirmation: current }),
      replayResponse,
    );
    expect(replayResponse.statusCode).toBe(200);
    expect(replay).toEqual(created);

    const listed = await controller.list(
      request,
      scope.workspaceId,
      scope.projectId,
      us2AutomationSessionId,
    );
    expect(listed).toEqual([created]);
    const detailResponse = response();
    const detail = await controller.detail(
      request,
      scope.workspaceId,
      scope.projectId,
      us2AutomationSessionId,
      created.automationAttemptId,
      detailResponse,
    );
    const { execution, ...createdAttemptIdentity } = created;
    expect(execution).toBeDefined();
    expect(detail).toMatchObject(createdAttemptIdentity);
    expect(detail).not.toHaveProperty("execution");
    expect(detail.configurationPins).toHaveLength(3);
    expect(detailResponse.headers.get("ETag")).toBe('W/"2"');
    const history = await controller.statusHistory(
      request,
      scope.workspaceId,
      scope.projectId,
      us2AutomationSessionId,
      created.automationAttemptId,
    );
    expect(history).toHaveLength(2);
    expect(
      history.every(({ externalAuthorityHash }) =>
        /^sha256:[a-f0-9]{64}$/u.test(externalAuthorityHash),
      ),
    ).toBe(true);
    expect(JSON.stringify({ created, history })).not.toMatch(
      /effectIdempotency|connectionRef|profileRef/u,
    );
  }, 120_000);
});
