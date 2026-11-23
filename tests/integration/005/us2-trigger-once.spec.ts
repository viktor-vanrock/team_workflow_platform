import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  qaAggregateSnapshotHash,
  TypeOrmAutomationExecutionRepository,
} from "../../../packages/competency-qa/src/node.ts";
import type {
  PipelineLookupRequest,
  PipelineLookupResult,
  PipelineTriggerReceipt,
  PipelineTriggerRequest,
  TrustedConnectorOperationContext,
} from "../../../packages/connector-sdk/src/index.ts";
import { type JsonValue, sha256 } from "../../../packages/platform-contracts/src/index.ts";
import {
  buildQaJiraGitLabLocalSeedConfiguration,
  type GitLabAutomationWorkerAuthority,
  loadEnvironment,
  qaJiraGitLabLocalEntities,
  qaJiraGitLabLocalMigrations,
  qaJiraGitLabLocalSeedIds,
  runQaJiraGitLabLocalSeed,
  TypeOrmGitLabAutomationLaunchService,
  TypeOrmGitLabAutomationWorker,
  TypeOrmGitLabReconciliationPollScheduler,
} from "../../../packages/runtime-composition/src/index.ts";
import { localPersonaIds } from "../../../packages/runtime-composition/src/seed/local-seed.ts";
import {
  startUs3DatabaseFixture,
  stopUs3DatabaseFixture,
  us3Actor,
  type Us3DatabaseFixture,
} from "../../support/002-us3-database.ts";
import {
  type PreparedUs2AutomationSession,
  prepareUs2AutomationSession,
  us2AutomationAuthorizationBasis,
  us2AutomationSessionId,
} from "../../support/005-us2-automation.ts";

let fixture: Us3DatabaseFixture | undefined;
let prepared: PreparedUs2AutomationSession;

function receipt(request: PipelineTriggerRequest): PipelineTriggerReceipt {
  const body = Object.freeze({
    schemaVersion: "test-executor.trigger-status@1.0.0" as const,
    messageType: "RESULT" as const,
    operation: "pipeline.trigger" as const,
    externalPipelineId: "201",
    externalPipelineDisplayRef: "http://mock-gitlab.local/pipelines/201",
    sourceCommitSha: "a".repeat(40),
    observedState: "QUEUED" as const,
    providerCreatedAt: "2026-09-01T08:00:05.000Z",
    observedAt: "2026-09-01T08:00:06.000Z",
    triggerRequestHash: request.triggerRequestHash,
    effectMarkerHash: request.effectMarkerHash,
  });
  return Object.freeze({ ...body, observationHash: sha256(body as unknown as JsonValue) });
}

function authority(calls: {
  trigger: number;
  lookup: number;
  pipelines: number;
}): GitLabAutomationWorkerAuthority {
  return Object.freeze({
    async materialize(command: Parameters<GitLabAutomationWorkerAuthority["materialize"]>[0]) {
      const request = command.payload as PipelineTriggerRequest;
      const pipelineReceipt = receipt(request);
      const port = Object.freeze({
        async trigger(
          _context: TrustedConnectorOperationContext,
          invoked: PipelineTriggerRequest,
        ): Promise<PipelineTriggerReceipt> {
          calls.trigger += 1;
          if (calls.pipelines === 0) calls.pipelines += 1;
          expect(invoked.effectMarkerHash).toBe(request.effectMarkerHash);
          throw new Error("GITLAB_MOCK_TIMEOUT_AFTER_POSSIBLE_EFFECT");
        },
        async lookup(
          _context: TrustedConnectorOperationContext,
          invoked: PipelineLookupRequest,
        ): Promise<PipelineLookupResult> {
          calls.lookup += 1;
          return Object.freeze({
            schemaVersion: "test-executor.trigger-status@1.0.0",
            messageType: "RESULT",
            operation: "pipeline.lookup",
            outcome: "EXACT_ONE",
            observedWindow: Object.freeze({ start: invoked.windowStart, end: invoked.windowEnd }),
            receipt: pipelineReceipt,
            consistencyEvidenceHash: sha256({
              marker: invoked.effectMarkerHash,
              pipeline: pipelineReceipt.externalPipelineId,
            } as JsonValue),
          });
        },
      });
      const pin = prepared.testExecutionPin;
      const trustedPin = Object.freeze({
        logicalRole: pin.logicalRole,
        capabilityKey: pin.capabilityKey,
        exactContractVersion: pin.exactContractVersion,
        bindingRef: pin.projectIntegrationBindingRef,
        profileRef: pin.profileRef,
        connectionRef: pin.connectionRef,
        validationReportRef: pin.validationReportRef,
        operationSetHash: pin.operationSetHash,
      });
      const context: TrustedConnectorOperationContext = Object.freeze({
        scope: Object.freeze({
          kind: "PROJECT",
          workspaceId: command.workspaceId,
          projectId: command.projectId,
        }),
        actor: Object.freeze({
          kind: "SERVICE",
          principalId: localPersonaIds["worker.local"],
          serviceKey: "gitlab-automation",
        }),
        authorizationBasisHash: command.initialAuthorizationBasisHash as `sha256:${string}`,
        correlationId: command.correlationId,
        causationId: command.causationId,
        effectIdempotencyKey: command.effectIdempotencyKey,
        profileRef: command.profileRef,
        classification: Object.freeze({ key: "INTERNAL", rank: 10 }),
        signal: new AbortController().signal,
        configurationPins: Object.freeze([trustedPin]),
        deadlineAt: "2026-09-01T08:10:00.000Z",
        telemetry: Object.freeze({
          correlationId: command.correlationId,
          causationId: command.causationId,
          operation: "pipeline.trigger",
        }),
      });
      return Object.freeze({
        port,
        context,
        connectionHeaderId: pin.connectionRef.id,
        connectionRef: pin.connectionRef,
        profileRef: pin.profileRef,
        numericProjectId: 5001,
        exactRef: "refs/heads/qa/smoke",
        expectedCommitSha: "a".repeat(40),
        lookupConsistencyWindowMs: 120_000,
        lookupIntervalMs: 10_000,
      });
    },
  });
}

beforeAll(async () => {
  fixture = await startUs3DatabaseFixture({
    entities: qaJiraGitLabLocalEntities,
    migrations: qaJiraGitLabLocalMigrations,
  });
  const mockHubUrl = "http://127.0.0.1:4010";
  const configuration = buildQaJiraGitLabLocalSeedConfiguration(mockHubUrl);
  await runQaJiraGitLabLocalSeed(
    fixture.source,
    loadEnvironment({
      AWP_ENVIRONMENT: "LOCAL",
      AWP_COMPOSITION: "qa-jira-gitlab-local",
      AWP_EXTERNAL_NETWORK_MODE: "deny",
      AWP_DATABASE_URL: fixture.postgres.url,
      AWP_MOCK_HUB_URL: mockHubUrl,
      AWP_IDENTITY_ISSUER: "https://fake-idp:4443/oidc",
    }),
  );
  prepared = await prepareUs2AutomationSession(fixture, {
    bindingRef: Object.freeze({
      id: qaJiraGitLabLocalSeedIds.binding,
      version: 1,
      contentHash: configuration.bindingHash,
    }),
    profileRef: Object.freeze({
      id: qaJiraGitLabLocalSeedIds.profile,
      version: 1,
      contentHash: configuration.profileHash,
    }),
    connectionRef: Object.freeze({
      id: qaJiraGitLabLocalSeedIds.connection,
      version: 1,
      contentHash: configuration.connectionHash,
    }),
  });
}, 120_000);

afterAll(async () => {
  await stopUs3DatabaseFixture(fixture);
}, 120_000);

describe("US2 trigger-once delivery", () => {
  it("converges concurrent launches, duplicate delivery, and a lost process hint to one provider pipeline", async () => {
    const service = new TypeOrmGitLabAutomationLaunchService(fixture!.source, {
      executingService: Object.freeze({
        kind: "SERVICE",
        principalId: localPersonaIds["worker.local"],
        serviceKey: "gitlab-automation",
      }),
      async authorize() {},
    });
    const scope = Object.freeze({
      workspaceId: fixture!.workspaceId,
      projectId: fixture!.projectId,
    });
    const confirmation = await service.currentConfirmation(scope, us2AutomationSessionId);
    const common = Object.freeze({
      scope,
      sessionId: us2AutomationSessionId,
      idempotencyKey: "us2-concurrent-trigger-once",
      ifMatch: 1,
      confirmation,
      authorizationBasis: us2AutomationAuthorizationBasis,
      authorizationBasisHash: qaAggregateSnapshotHash(us2AutomationAuthorizationBasis as never),
      launchedAt: "2026-09-01T08:00:03.000Z",
    });
    const secondHuman = Object.freeze({
      kind: "HUMAN" as const,
      principalId: localPersonaIds["owner.local"],
      issuer: "https://fake-idp:4443/oidc",
      subject: "owner.local",
    });
    const results = await Promise.all([
      service.launch(
        Object.freeze({
          ...common,
          actor: us3Actor,
          correlationId: "d6800000-0000-4000-8000-000000000001",
          causationId: "d6800000-0000-4000-8000-000000000011",
        }),
      ),
      service.launch(
        Object.freeze({
          ...common,
          actor: secondHuman,
          correlationId: "d6800000-0000-4000-8000-000000000002",
          causationId: "d6800000-0000-4000-8000-000000000012",
        }),
      ),
      service.launch(
        Object.freeze({
          ...common,
          actor: us3Actor,
          correlationId: "d6800000-0000-4000-8000-000000000003",
          causationId: "d6800000-0000-4000-8000-000000000013",
        }),
      ),
    ]);
    expect(results.filter(({ replayed }) => !replayed)).toHaveLength(1);
    expect(new Set(results.map(({ attempt }) => attempt.automationAttemptId)).size).toBe(1);

    const calls = { trigger: 0, lookup: 0, pipelines: 0 };
    const lostHintWorker = new TypeOrmGitLabAutomationWorker(fixture!.source, authority(calls));
    expect(await lostHintWorker.dispatch(new Date("2026-09-01T08:00:04.000Z"))).toBe(1);

    const recoveredWorker = new TypeOrmGitLabAutomationWorker(fixture!.source, authority(calls));
    expect(await recoveredWorker.dispatch(new Date("2026-09-01T08:00:20.000Z"))).toBe(1);
    expect(await recoveredWorker.work(new Date("2026-09-01T08:00:21.000Z"))).toBe("CONFIRMED");
    const commandScope = Object.freeze({
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      commandId: results[0]!.attempt.connectorCommandId,
    });
    expect(await recoveredWorker.execute(commandScope, new Date("2026-09-01T08:00:22.000Z"))).toBe(
      "CONFIRMED",
    );
    expect(calls).toEqual({ trigger: 1, lookup: 1, pipelines: 1 });

    const [counts] = (await fixture!.source.query(
      `SELECT
      (SELECT count(*)::int FROM qa_automation_launch_requests WHERE session_id=$1) AS claims,
      (SELECT count(*)::int FROM qa_automation_attempts WHERE session_id=$1) AS attempts,
      (SELECT count(*)::int FROM connector_commands WHERE operation='pipeline.trigger') AS commands,
      (SELECT count(*)::int FROM gitlab_effect_reconciliations) AS effects`,
      [us2AutomationSessionId],
    )) as readonly Record<string, number>[];
    expect(counts).toEqual({ claims: 1, attempts: 1, commands: 1, effects: 1 });
    const repository = new TypeOrmAutomationExecutionRepository(fixture!.source);
    const attempt = await repository.automationAttempt(
      scope,
      results[0]!.attempt.automationAttemptId,
    );
    expect(attempt).toMatchObject({ currentStatus: "RUNNING", currentStatusRevisionNo: 3 });
    expect(
      await repository.automationStatusHistory(scope, results[0]!.attempt.automationAttemptId),
    ).toHaveLength(3);
    const [effect] = (await fixture!.source.query(
      "SELECT state,external_pipeline_id,match_count FROM gitlab_effect_reconciliations",
    )) as readonly Record<string, unknown>[];
    expect(effect).toEqual(
      expect.objectContaining({ state: "CONFIRMED", external_pipeline_id: "201", match_count: 1 }),
    );

    const scheduler = new TypeOrmGitLabReconciliationPollScheduler(
      fixture!.source,
      { now: () => new Date("2026-09-01T08:00:30.000Z") },
      "worker-us4-first",
    );
    await expect(scheduler.runOne()).resolves.toBe("SCHEDULED");
    const [repair] = (await fixture!.source.query(`
SELECT cursor.lane,cursor.lease_token,cursor.lease_owner,cursor.next_eligible_at,
       count(outbox.id)::int AS pending_reads
FROM gitlab_reconciliation_cursors cursor
LEFT JOIN event_outbox outbox ON outbox.event_type='gitlab.authoritative-read.requested.v1' AND outbox.state='READY'
WHERE cursor.lane='ACTIVE_PIPELINES'
GROUP BY cursor.lane,cursor.lease_token,cursor.lease_owner,cursor.next_eligible_at`)) as readonly Readonly<
      Record<string, unknown>
    >[];
    expect(repair).toMatchObject({
      lane: "ACTIVE_PIPELINES",
      lease_token: "1",
      lease_owner: null,
      pending_reads: 1,
    });

    const restarted = new TypeOrmGitLabReconciliationPollScheduler(
      fixture!.source,
      { now: () => new Date("2026-09-01T08:01:00.000Z") },
      "worker-us4-restarted",
    );
    await expect(restarted.runOne()).resolves.toBe("IDLE");
    const [restartState] = (await fixture!.source.query(`
SELECT cursor.lease_token,count(outbox.id)::int AS pending_reads
FROM gitlab_reconciliation_cursors cursor
LEFT JOIN event_outbox outbox ON outbox.event_type='gitlab.authoritative-read.requested.v1' AND outbox.state='READY'
WHERE cursor.lane='ACTIVE_PIPELINES' GROUP BY cursor.lease_token`)) as readonly Readonly<
      Record<string, unknown>
    >[];
    expect(restartState).toMatchObject({ lease_token: "2", pending_reads: 1 });
  }, 120_000);
});
