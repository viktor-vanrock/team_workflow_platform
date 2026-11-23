import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import {
  type GitLabPipelineProviderCandidate,
  GitLabPipelineTriggerHandler,
  GitLabTriggerReconciliationHandler,
} from "../../packages/connector-gitlab/src/index.ts";
import type {
  PipelineTriggerReceipt,
  TrustedConnectorOperationContext,
} from "../../packages/connector-sdk/src/index.ts";
import { type JsonValue, sha256 } from "../../packages/platform-contracts/src/index.ts";
import { TypeOrmCommandDeliveryStore } from "../../packages/platform-persistence-typeorm/src/index.ts";
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
} from "../../packages/runtime-composition/src/index.ts";
import { localPersonaIds } from "../../packages/runtime-composition/src/seed/local-seed.ts";
import { startUs3DatabaseFixture, stopUs3DatabaseFixture, us3Actor } from "./002-us3-database.ts";
import {
  prepareUs2AutomationSession,
  us2AutomationAuthorizationBasis,
  us2AutomationSessionId,
} from "./005-us2-automation.ts";

export async function uncertainGitLabFixture(image: string) {
  const state = {
    now: new Date("2026-09-01T08:00:10Z"),
    lost: true,
    visible: 0,
    copies: 1,
    sha: "a".repeat(40),
    reads: 0,
    readStatus: 200,
    forgedReceipt: false,
    pipelines: [] as Array<
      GitLabPipelineProviderCandidate & { inputs: Record<string, string | number | boolean> }
    >,
  };
  const server = createServer((request, response) => {
    void (async () => {
      const reply = (body: unknown, status = 200) => {
        response.writeHead(status, { "content-type": "application/json" });
        response.end(JSON.stringify(body));
      };
      if (request.method === "POST" && request.url?.endsWith("/trigger/pipeline")) {
        let raw = "";
        for await (const chunk of request) raw += String(chunk);
        const body = JSON.parse(raw) as {
          ref: string;
          name: string;
          inputs: Record<string, string | number | boolean>;
        };
        const candidate = {
          id: String(201 + state.pipelines.length),
          name: body.name,
          ref: body.ref,
          sha: state.sha,
          inputs: body.inputs,
          status: "pending",
          createdAt: state.now.toISOString(),
        };
        state.pipelines.push(candidate); // No deduplication in this provider.
        if (state.lost) {
          response.destroy();
          return;
        }
        reply({ ...candidate, created_at: candidate.createdAt });
        return;
      }
      state.reads++;
      if (state.readStatus !== 200) {
        reply({ error: "unavailable" }, state.readStatus);
        return;
      }
      if (request.url?.endsWith("/variables")) {
        reply(state.pipelines[0]?.inputs ?? {});
        return;
      }
      reply(
        state.pipelines.slice(0, state.visible).flatMap((candidate) =>
          Array.from({ length: state.copies }, (_, i) => ({
            ...candidate,
            id: String(Number(candidate.id) + i),
          })),
        ),
      );
    })().catch(() => response.destroy());
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const fixture = await startUs3DatabaseFixture({
    postgresImage: image,
    entities: qaJiraGitLabLocalEntities,
    migrations: qaJiraGitLabLocalMigrations,
  });
  const config = buildQaJiraGitLabLocalSeedConfiguration(origin);
  await runQaJiraGitLabLocalSeed(
    fixture.source,
    loadEnvironment({
      AWP_ENVIRONMENT: "LOCAL",
      AWP_COMPOSITION: "qa-jira-gitlab-local",
      AWP_EXTERNAL_NETWORK_MODE: "deny",
      AWP_DATABASE_URL: fixture.postgres.url,
      AWP_MOCK_HUB_URL: origin,
      AWP_IDENTITY_ISSUER: "https://fake-idp:4443/oidc",
    }),
  );
  const prepared = await prepareUs2AutomationSession(fixture, {
    bindingRef: {
      id: qaJiraGitLabLocalSeedIds.binding,
      version: 1,
      contentHash: config.bindingHash,
    },
    profileRef: {
      id: qaJiraGitLabLocalSeedIds.profile,
      version: 1,
      contentHash: config.profileHash,
    },
    connectionRef: {
      id: qaJiraGitLabLocalSeedIds.connection,
      version: 1,
      contentHash: config.connectionHash,
    },
  });
  const service = new TypeOrmGitLabAutomationLaunchService(fixture.source, {
    executingService: {
      kind: "SERVICE",
      principalId: localPersonaIds["worker.local"],
      serviceKey: "gitlab-automation",
    },
    async authorize() {},
  });
  const scope = { workspaceId: fixture.workspaceId, projectId: fixture.projectId };
  const confirmation = await service.currentConfirmation(scope, us2AutomationSessionId);
  const launched = await service.launch({
    scope,
    sessionId: us2AutomationSessionId,
    idempotencyKey: randomUUID(),
    ifMatch: 1,
    confirmation,
    authorizationBasis: us2AutomationAuthorizationBasis,
    authorizationBasisHash: sha256(us2AutomationAuthorizationBasis as unknown as JsonValue),
    launchedAt: "2026-09-01T08:00:03Z",
    actor: us3Actor,
    correlationId: randomUUID(),
    causationId: randomUUID(),
  });
  const commandScope = { ...scope, commandId: launched.attempt.connectorCommandId };
  const read = async <T>(path: string) => {
    const response = await fetch(`${origin}${path}`);
    if (!response.ok) throw new Error(`FIXTURE_READ_${response.status}`);
    return (await response.json()) as T;
  };
  const selectedAuthority = {
    suiteKey: "smoke",
    environmentRef: "environment:test:qa-1@17",
    sourceCommitSha: "a".repeat(40),
  };
  const clock = { now: () => state.now };
  const trigger = new GitLabPipelineTriggerHandler({
    profile: config.profile,
    authority: () => selectedAuthority,
    clock,
    transport: {
      trigger: async (invocation) => {
        const response = await fetch(`${origin}${invocation.path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(invocation.body),
          ...(invocation.signal ? { signal: invocation.signal } : {}),
        });
        return (await response.json()) as unknown;
      },
    },
  });
  const lookup = new GitLabTriggerReconciliationHandler({
    profile: config.profile,
    authority: () => selectedAuthority,
    clock,
    transport: {
      list: async (input) => await read<readonly GitLabPipelineProviderCandidate[]>(input.path),
      readInputs: async (input) =>
        await read<Record<string, string | number | boolean>>(input.path),
    },
  });
  const authority: GitLabAutomationWorkerAuthority = {
    materialize: async (command) => {
      const pin = prepared.testExecutionPin;
      const context: TrustedConnectorOperationContext = {
        scope: { kind: "PROJECT", ...scope },
        actor: {
          kind: "SERVICE",
          principalId: localPersonaIds["worker.local"],
          serviceKey: "gitlab-automation",
        },
        authorizationBasisHash: command.initialAuthorizationBasisHash as `sha256:${string}`,
        correlationId: command.correlationId,
        causationId: command.causationId,
        effectIdempotencyKey: command.effectIdempotencyKey,
        profileRef: command.profileRef,
        classification: { key: "INTERNAL", rank: 10 },
        signal: new AbortController().signal,
        configurationPins: [
          {
            logicalRole: pin.logicalRole,
            capabilityKey: pin.capabilityKey,
            exactContractVersion: pin.exactContractVersion,
            bindingRef: pin.projectIntegrationBindingRef,
            profileRef: pin.profileRef,
            connectionRef: pin.connectionRef,
            validationReportRef: pin.validationReportRef,
            operationSetHash: pin.operationSetHash,
          },
        ],
        deadlineAt: "2026-09-01T08:10:00Z",
        telemetry: {
          correlationId: command.correlationId,
          causationId: command.causationId,
          operation: "pipeline.trigger",
        },
      };
      return {
        context,
        port: {
          trigger: (ctx, request) => trigger.trigger(ctx, request),
          lookup: async (ctx, request) => {
            const result = await lookup.lookup(ctx, request);
            if (!state.forgedReceipt || result.outcome !== "EXACT_ONE") return result;
            const { observationHash: _hash, ...original } = result.receipt;
            void _hash;
            const body = { ...original, sourceCommitSha: "b".repeat(40) };
            const receipt: PipelineTriggerReceipt = {
              ...body,
              observationHash: sha256(body as unknown as JsonValue),
            };
            return { ...result, receipt };
          },
        },
        connectionHeaderId: pin.connectionRef.id,
        connectionRef: pin.connectionRef,
        profileRef: pin.profileRef,
        numericProjectId: 5001,
        exactRef: config.profile.trigger.ref,
        expectedCommitSha: selectedAuthority.sourceCommitSha,
        lookupConsistencyWindowMs: 120_000,
        lookupIntervalMs: 10_000,
      };
    },
  };
  return {
    state,
    source: fixture.source,
    scope: commandScope,
    worker: () => new TypeOrmGitLabAutomationWorker(fixture.source, authority),
    command: () => new TypeOrmCommandDeliveryStore(fixture.source).load(commandScope),
    effect: async () =>
      (
        (await fixture.source.query(
          "SELECT * FROM gitlab_effect_reconciliations WHERE command_id=$1",
          [commandScope.commandId],
        )) as Record<string, unknown>[]
      )[0]!,
    restart: async () => {
      await fixture.source.destroy();
      await fixture.source.initialize();
      state.now = new Date(state.now.getTime() + 31_000);
    },
    stop: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
      await stopUs3DatabaseFixture(fixture);
    },
  };
}
