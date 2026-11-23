import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createAutomationSuiteDraft,
  ManageAutomationSuiteService,
  qaAggregateSnapshotHash,
  type QaAutomationSuiteContent,
  qaAutomationSuiteValidationCheckOrder,
  type QaAutomationSuiteVersion,
  recordAutomationSuiteValidation,
  TypeOrmAutomationSuiteRepository,
} from "../../../packages/competency-qa/src/node.ts";
import { createPlatformDataSource } from "../../../packages/platform-persistence-typeorm/src/index.ts";
import {
  type RunningPostgres,
  startPostgres,
} from "../../../packages/platform-testkit/src/postgres.ts";
import {
  GitLabSourceContextWorker,
  type GitLabSuiteValidationExecution,
  GitLabSuiteValidationWorker,
  TypeOrmAutomationSuiteValidationCommandQueue,
  TypeOrmGitLabSourceRefreshQueue,
} from "../../../packages/runtime-composition/src/index.ts";
import {
  qaLocalEntities,
  qaLocalMigrations,
} from "../../../packages/runtime-composition/src/qa/composition.ts";
import {
  localPersonaIds,
  localSeedIds,
} from "../../../packages/runtime-composition/src/seed/local-seed.ts";
import {
  qaLocalSeedIds,
  runQaLocalSeed,
} from "../../../packages/runtime-composition/src/seed/qa-local-seed.ts";
import { POSTGRES_TEST_IMAGES } from "../../testcontainers.config.ts";

const digest = (value: string) => qaAggregateSnapshotHash(value as never);
const actor = Object.freeze({
  kind: "HUMAN" as const,
  principalId: localPersonaIds["executor.alpha"],
  issuer: "https://fake-idp:4443/oidc",
  subject: "executor.alpha",
} as const);
const scope = Object.freeze({
  workspaceId: localSeedIds.workspaceFunctional,
  projectId: localSeedIds.alpha,
} as const);
const suiteId = "a5100000-0000-4000-8000-000000000001";
const at = "2026-09-01T09:00:00.000Z";

function exact(id: string, version: number, seed: string) {
  return Object.freeze({ id, version, contentHash: digest(seed) } as const);
}

function content(resultJobKey: string): QaAutomationSuiteContent {
  return Object.freeze({
    ownerPrincipalId: actor.principalId,
    suiteDefinitionRef: exact("suite-definition", 1, `definition-${resultJobKey}`),
    logicalExecutionContract: Object.freeze({
      pipelineKey: "qa-validation",
      sourceRefPolicyRef: "qa-source-ref-policy@1",
      resultJobKey,
      contractHash: digest(`contract-${resultJobKey}`),
    } as const),
    allowedTargetTypes: Object.freeze(["MERGE_REQUEST", "COMMIT", "BUILD"] as const),
    allowedEnvironmentRefs: Object.freeze(["environment:local"] as const),
    parameterSchemaRef: exact("parameter-schema", 1, "parameters"),
    resultSchemaRef: exact("result-schema", 1, "result"),
    artifactPolicyRef: exact("artifact-policy", 1, "artifact"),
    retryPolicyRef: exact("retry-policy", 1, "retry"),
    quarantinePolicyRef: exact("quarantine-policy", 1, "quarantine"),
    capabilityRequirements: Object.freeze([
      "source-context.read@1.0.0",
      "test-executor.trigger-status@1.0.0",
      "artifact.ci-read@1.0.0",
    ] as const),
  } as const);
}

function validation(
  version: QaAutomationSuiteVersion,
  reportId: string,
  status: "VALID" | "INVALID",
): GitLabSuiteValidationExecution {
  const recorded = recordAutomationSuiteValidation(version, {
    id: reportId,
    workspaceId: version.workspaceId,
    projectId: version.projectId,
    suiteBindingRef: Object.freeze({
      id: version.id,
      version: version.version,
      contentHash: version.contentHash,
    } as const),
    status,
    coreBindingRef: exact(qaLocalSeedIds.alphaBinding, 2, "core-binding"),
    profilePinSetHash: digest("profile-pins"),
    discoverySnapshotRef: `discovery:${version.id}`,
    discoverySnapshotHash: digest(`discovery-${version.version}`),
    suiteProbeRef: `probe:${version.id}`,
    suiteProbeHash: digest(`probe-${version.version}`),
    checks: Object.freeze(
      qaAutomationSuiteValidationCheckOrder.map((key, index) =>
        Object.freeze({
          key,
          passed: status === "VALID" || index !== 4,
        } as const),
      ),
    ),
    issues:
      status === "VALID"
        ? Object.freeze([] as const)
        : Object.freeze([
            { code: "CI_LINT_INVALID", path: "/logicalExecutionContract/pipelineKey" },
          ] as const),
    validatedBy: Object.freeze({
      kind: "SERVICE",
      principalId: "gitlab-suite-validation-worker",
      serviceKey: "qa-suite-validation",
    } as const),
    authorizationBasisHash: digest("validation-authorization"),
    createdAt: new Date(Date.parse(at) + version.version * 1_000).toISOString(),
  });
  return Object.freeze({
    previousVersion: version,
    nextVersion: recorded.version,
    report: recorded.report,
  } as const);
}

let postgres: RunningPostgres | undefined;
let source: ReturnType<typeof createPlatformDataSource>;

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
}, 120_000);

afterAll(async () => {
  if (source?.isInitialized) await source.destroy();
  await postgres?.stop();
}, 120_000);

describe("US1 automation Suite validation and publication", () => {
  it("validates only through a durable command and publishes with exact retained evidence", async () => {
    const created = await source.transaction(async (manager) => {
      const service = new ManageAutomationSuiteService(
        new TypeOrmAutomationSuiteRepository(manager),
      );
      return await service.create({
        id: suiteId,
        scope,
        suiteKey: "merge-request-smoke",
        content: content("machine-result"),
        actor,
        createdAt: at,
      });
    });
    const queue = new TypeOrmAutomationSuiteValidationCommandQueue(source);
    let executorCalls = 0;
    let nextExecution: GitLabSuiteValidationExecution | undefined;
    const worker = new GitLabSuiteValidationWorker(source, {
      async validate() {
        executorCalls += 1;
        if (!nextExecution) throw new Error("TEST_VALIDATION_EXECUTION_MISSING");
        return nextExecution;
      },
    });
    const authorizationBasis = Object.freeze({
      kind: "PROJECT" as const,
      policyVersion: "qa-policy@1",
      membershipRef: Object.freeze({
        id: "a5200000-0000-4000-8000-000000000001",
        version: 1,
      } as const),
      roleAssignmentRefs: Object.freeze([
        { id: "a5300000-0000-4000-8000-000000000001", version: 1 },
      ] as const),
      entitlementRefs: Object.freeze([
        { id: "a5400000-0000-4000-8000-000000000001", version: 1 },
      ] as const),
      skillContext: "NOT_APPLICABLE" as const,
    } as const);
    const enqueue = async (
      version: QaAutomationSuiteVersion,
      requestKey: string,
      causationId: string,
    ) =>
      await queue.enqueue({
        scope,
        version,
        actor,
        authorizationBasis,
        authorizationBasisHash: qaAggregateSnapshotHash(authorizationBasis as never),
        bindingRef: Object.freeze({ id: localSeedIds.alphaBinding, version: 2 } as const),
        profileRef: Object.freeze({
          id: "a5500000-0000-4000-8000-000000000001",
          version: 1,
        } as const),
        requestKey,
        correlationId: "a5600000-0000-4000-8000-000000000001",
        causationId,
        requestedAt: at,
      });

    nextExecution = validation(created.version, "suite-report-valid-v1", "VALID");
    const queuedV1 = await enqueue(
      created.version,
      "validate-suite-v1",
      "a5700000-0000-4000-8000-000000000001",
    );
    expect(executorCalls).toBe(0);
    expect(queuedV1.replayed).toBe(false);
    expect(await worker.runOne(new Date(at))).toBe("VALID");
    expect(executorCalls).toBe(1);

    const repository = new TypeOrmAutomationSuiteRepository(source);
    expect(await repository.versions(scope, suiteId)).toEqual([
      expect.objectContaining({
        id: created.version.id,
        state: "VALIDATED",
        validationReportId: nextExecution.report.id,
      }),
    ]);
    expect(await repository.validationReports(scope, created.version.id)).toEqual([
      expect.objectContaining({
        id: nextExecution.report.id,
        status: "VALID",
        contentHash: nextExecution.report.contentHash,
      }),
    ]);
    const delivery = (await source.query(
      `
      SELECT command.state AS status,outbox.state
      FROM connector_commands command JOIN command_outbox outbox ON outbox.command_id=command.id
      WHERE command.id=$1
    `,
      [queuedV1.commandId],
    )) as readonly Record<string, unknown>[];
    expect(delivery).toEqual([{ status: "CONFIRMED", state: "ACKNOWLEDGED" }]);

    const validV1 = nextExecution.nextVersion;
    const reportV1 = nextExecution.report;
    const evidenceV1 = Object.freeze({
      coreBindingRef: reportV1.coreBindingRef,
      profilePinSetHash: reportV1.profilePinSetHash,
      discoverySnapshotHash: reportV1.discoverySnapshotHash,
      suiteProbeHash: reportV1.suiteProbeHash,
      discoveryCurrent: true,
      nonProduction: true,
      noDeploySurface: true,
    } as const);
    const publishedV1 = await source.transaction(
      async (manager) =>
        await new ManageAutomationSuiteService(
          new TypeOrmAutomationSuiteRepository(manager),
        ).publish({
          scope,
          header: created.header,
          versions: [validV1],
          reports: [reportV1],
          versionId: validV1.id,
          expectedResourceVersion: created.header.resourceVersion,
          evidence: evidenceV1,
          publishedAt: "2026-09-01T09:01:00.000Z",
        }),
    );
    expect(await repository.header(scope, suiteId)).toEqual(
      expect.objectContaining({
        currentPublishedVersion: 1,
        currentPublishedVersionId: validV1.id,
        resourceVersion: 2,
      }),
    );
    expect(await new ManageAutomationSuiteService(repository).list(scope)).toEqual([
      expect.objectContaining({
        header: expect.objectContaining({ id: suiteId, currentPublishedVersion: 1 }),
        versions: [expect.objectContaining({ id: validV1.id, state: "PUBLISHED" })],
      }),
    ]);

    const draftV2 = createAutomationSuiteDraft({
      header: publishedV1.header,
      previousVersions: publishedV1.versions,
      content: content("machine-result-v2"),
      createdBy: actor,
      createdAt: "2026-09-01T09:02:00.000Z",
    });
    await repository.insertVersion(draftV2);

    nextExecution = validation(draftV2, "suite-report-invalid-v2", "INVALID");
    await enqueue(draftV2, "validate-suite-v2-invalid", "a5700000-0000-4000-8000-000000000002");
    expect(await worker.runOne(new Date(at))).toBe("INVALID");
    expect(await repository.versions(scope, suiteId)).toEqual([
      expect.objectContaining({ state: "PUBLISHED" }),
      expect.objectContaining({ state: "DRAFT", validationReportId: null }),
    ]);
    expect(await repository.validationReports(scope, draftV2.id)).toEqual([
      expect.objectContaining({ id: "suite-report-invalid-v2", status: "INVALID" }),
    ]);

    const validV2Execution = validation(draftV2, "suite-report-valid-v2", "VALID");
    const staleV2 = Object.freeze({
      ...draftV2,
      contentHash: digest("stale-suite-content"),
    } as const);
    await expect(
      source.transaction(
        async (manager) =>
          await new TypeOrmAutomationSuiteRepository(manager).persistValidation({
            scope,
            previousVersion: staleV2,
            nextVersion: validV2Execution.nextVersion,
            report: validV2Execution.report,
          }),
      ),
    ).rejects.toThrow("QA_AUTOMATION_SUITE_VALIDATION_STALE");
    expect(await repository.validationReports(scope, draftV2.id)).toHaveLength(1);

    nextExecution = validV2Execution;
    await enqueue(draftV2, "validate-suite-v2-valid", "a5700000-0000-4000-8000-000000000003");
    expect(await worker.runOne(new Date(at))).toBe("VALID");
    const publishedV2 = await source.transaction(
      async (manager) =>
        await new ManageAutomationSuiteService(
          new TypeOrmAutomationSuiteRepository(manager),
        ).publish({
          scope,
          header: publishedV1.header,
          versions: [publishedV1.versions[0]!, validV2Execution.nextVersion],
          reports: [reportV1, validV2Execution.report],
          versionId: validV2Execution.nextVersion.id,
          expectedResourceVersion: publishedV1.header.resourceVersion,
          evidence: Object.freeze({
            coreBindingRef: validV2Execution.report.coreBindingRef,
            profilePinSetHash: validV2Execution.report.profilePinSetHash,
            discoverySnapshotHash: validV2Execution.report.discoverySnapshotHash,
            suiteProbeHash: validV2Execution.report.suiteProbeHash,
            discoveryCurrent: true,
            nonProduction: true,
            noDeploySurface: true,
          } as const),
          publishedAt: "2026-09-01T09:03:00.000Z",
        }),
    );
    expect(publishedV2.versions.map(({ state }) => state)).toEqual(["RETIRED", "PUBLISHED"]);
    expect((await repository.versions(scope, suiteId)).map(({ state }) => state)).toEqual([
      "RETIRED",
      "PUBLISHED",
    ]);
  });

  it("refreshes source context only after a durable source command is claimed by the worker", async () => {
    let providerCalls = 0;
    const queue = new TypeOrmGitLabSourceRefreshQueue(source);
    const authorizationBasis = Object.freeze({
      kind: "PROJECT" as const,
      policyVersion: "qa-source-refresh@1",
      membershipRef: Object.freeze({
        id: "a5900000-0000-4000-8000-000000000001",
        version: 1,
      } as const),
      roleAssignmentRefs: Object.freeze([] as const),
      entitlementRefs: Object.freeze([] as const),
      skillContext: "NOT_APPLICABLE" as const,
    } as const);
    const queued = await queue.enqueue({
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      actor,
      authorizationBasis,
      authorizationBasisHash: qaAggregateSnapshotHash(authorizationBasis as never),
      bindingRef: Object.freeze({ id: localSeedIds.alphaBinding, version: 2 } as const),
      profileRef: Object.freeze({
        id: "a5900000-0000-4000-8000-000000000002",
        version: 1,
      } as const),
      selector: Object.freeze({
        sourceKind: "MERGE_REQUEST",
        sourceRef: "17",
        expectedRevision: "a".repeat(40),
      } as const),
      requestKey: "refresh-source-context-17",
      correlationId: "a5900000-0000-4000-8000-000000000003",
      causationId: "a5900000-0000-4000-8000-000000000004",
      requestedAt: at,
    });
    expect(providerCalls).toBe(0);
    const worker = new GitLabSourceContextWorker(
      source,
      {
        async materialize(command) {
          return Object.freeze({
            port: Object.freeze({
              async read() {
                providerCalls += 1;
                return Object.freeze({
                  schemaVersion: "source-context.read@1.0.0" as const,
                  messageType: "RESULT" as const,
                  operation: "merge-request.read" as const,
                  observation: Object.freeze({
                    sourceKind: "MERGE_REQUEST" as const,
                    sourceRef: "17",
                    providerRevisionToken: "2026-09-01T09:00:00.000Z",
                    observedAt: "2026-09-01T09:00:00.000Z",
                    state: "OPEN" as const,
                    sourceRevision: "feature/us1",
                    targetRevision: "main",
                    headCommitSha: "a".repeat(40),
                    buildRefs: Object.freeze(["9001"] as const),
                    observationHash: digest("source-observation"),
                  } as const),
                } as const);
              },
            } as const),
            context: Object.freeze({} as const) as never,
            request: command.payload as never,
          } as const);
        },
      },
      {
        async append(manager, command, result) {
          await manager.query(
            `
          INSERT INTO event_outbox(id,workspace_id,project_id,event_type,envelope,envelope_hash,state,created_at)
          VALUES($1,$2,$3,'gitlab.source-context.observed',$4,$5,'READY',$6)
        `,
            [
              "a5900000-0000-4000-8000-000000000005",
              command.workspaceId,
              command.projectId,
              JSON.stringify({ commandId: command.id, result }),
              digest("source-observation-event"),
              at,
            ],
          );
        },
      },
    );
    expect(await worker.runOne(new Date(at))).toBe("CONFIRMED");
    expect(providerCalls).toBe(1);
    const facts = (await source.query(
      `
      SELECT command.state AS command_state,event.state AS event_state
      FROM connector_commands command
      JOIN event_outbox event ON event.envelope->>'commandId'=command.id::text
      WHERE command.id=$1
    `,
      [queued.commandId],
    )) as readonly Record<string, unknown>[];
    expect(facts).toEqual([{ command_state: "CONFIRMED", event_state: "READY" }]);
  });
});
