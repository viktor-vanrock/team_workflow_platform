import { createServer, type Server } from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { QaPackController } from "../../apps/api/src/extensions/qa-pack.controller.ts";
import { createLocalQaIntakeConfiguration } from "../../apps/api/src/local/local-qa-intake-configuration.ts";
import { createPlatformDataSource } from "../../packages/platform-persistence-typeorm/src/index.ts";
import {
  type RunningPostgres,
  startPostgres,
} from "../../packages/platform-testkit/src/postgres.ts";
import { loadEnvironment } from "../../packages/runtime-composition/src/config/environment.ts";
import {
  createQaLocalOperationalBrokerMap,
  qaLocalEntities,
  qaLocalMigrations,
} from "../../packages/runtime-composition/src/qa/composition.ts";
import { localSeedIds } from "../../packages/runtime-composition/src/seed/local-seed.ts";
import { runQaLocalSeed } from "../../packages/runtime-composition/src/seed/qa-local-seed.ts";
import { localQaTestRequest } from "../support/008-qa-request.ts";
import { requiredFixture } from "../support/fixture-value.ts";
import { POSTGRES_TEST_IMAGES } from "../testcontainers.config.ts";

interface MockEffect {
  readonly result: Record<string, unknown>;
}

let postgres: RunningPostgres | undefined;
let source: ReturnType<typeof createPlatformDataSource> | undefined;
let mockServer: Server | undefined;
let controller: QaPackController;
const effects = new Map<string, MockEffect>();

async function body(
  request: import("node:http").IncomingMessage,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

beforeAll(async () => {
  mockServer = createServer((request, response) => {
    void (async () => {
      if (request.method !== "POST" || request.url !== "/operational/requests") {
        response.writeHead(404).end();
        return;
      }
      const envelope = await body(request);
      const effectKey = String(envelope.effectIdempotencyKey);
      const scope = envelope.scope as Record<string, unknown>;
      const profileRef = envelope.profileRef as Record<string, unknown>;
      const target = envelope.target as Record<string, unknown>;
      const existing = effects.get(effectKey);
      const result = existing?.result ?? {
        operation: "request.create",
        entityKind: "REQUEST",
        externalEntityId: `REQ-${effects.size + 1}`,
        externalDisplayKey: `QA-${effects.size + 1}`,
        externalVersion: "1",
        rawExternalState: "OPEN",
        normalizedStatus: "NEW",
        naturalKey: target.naturalKey,
        effectId: effectKey,
        observedAt: "2026-08-30T08:00:00.000Z",
        scope,
        profileRef,
      };
      effects.set(effectKey, { result });
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(result));
    })().catch((error: unknown) => response.writeHead(500).end(String(error)));
  });
  await new Promise<void>((resolve) => {
    mockServer!.listen(0, "127.0.0.1", resolve);
  });
  const address = mockServer.address();
  if (!address || typeof address === "string") throw new Error("MOCK_SERVER_ADDRESS_MISSING");

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
    AWP_MOCK_HUB_URL: `http://127.0.0.1:${address.port}`,
    AWP_IDENTITY_ISSUER: "https://fake-idp:4443/oidc",
  });
  controller = new QaPackController(
    source,
    createQaLocalOperationalBrokerMap(loadEnvironment()),
    "INLINE_LOCAL",
    createLocalQaIntakeConfiguration(source, "INLINE_LOCAL"),
  );
}, 120_000);

afterAll(async () => {
  if (source?.isInitialized) await source.destroy();
  await new Promise<void>((resolve, reject) => {
    mockServer?.close((error) => (error ? reject(error) : resolve()));
  });
  await postgres?.stop();
});

describe("qa-local US1 public controller", () => {
  it("keeps Draft side-effect-free and converges concurrent confirmation to one effect and aggregate", async () => {
    const headers = new Map<string, string>();
    const response = {
      setHeader: (name: string, value: string) => {
        headers.set(name, value);
      },
    };
    const request = await localQaTestRequest(source!, "requester.alpha");
    const payload = {
      schemaVersion: 1 as const,
      title: "Sparse API confirmation",
      requestKind: "feature-validation" as const,
      requestedClassificationKey: "INTERNAL",
      blockers: [],
      dependencies: [],
    };
    const draft = await controller.createDraft(
      request,
      localSeedIds.workspaceFunctional,
      localSeedIds.alpha,
      payload,
      response,
    );
    expect(effects).toHaveProperty("size", 0);
    expect(headers.get("Location")).toContain(`/intake-drafts/${draft.draftId}/qa-status`);

    const confirmations = await Promise.all(
      Array.from(
        { length: 4 },
        async () =>
          await controller.confirmDraft(
            request,
            localSeedIds.workspaceFunctional,
            localSeedIds.alpha,
            draft.draftId,
            "qa-api-concurrent-1",
            response,
          ),
      ),
    );
    expect(effects).toHaveProperty("size", 1);
    expect(new Set(confirmations.map(({ workItemId }) => workItemId))).toHaveProperty("size", 1);
    expect(confirmations.filter(({ replayed }) => !replayed)).toHaveLength(1);

    const counts = (await source!.query(`
      SELECT
        (SELECT count(*)::int FROM connector_commands WHERE capability_key='operational-work-item') AS commands,
        (SELECT count(*)::int FROM work_items w JOIN work_type_definitions d ON d.id=w.work_type_definition_id WHERE d.work_type_key='qa.validation') AS work_items,
        (SELECT count(*)::int FROM qa_request_extensions) AS extensions,
        (SELECT count(*)::int FROM qa_request_input_revisions) AS inputs
    `)) as readonly Record<string, unknown>[];
    expect(counts).toEqual([{ commands: 1, work_items: 1, extensions: 1, inputs: 1 }]);

    const backlog = await controller.backlog(
      request,
      localSeedIds.workspaceFunctional,
      localSeedIds.alpha,
    );
    expect(backlog.items).toHaveLength(1);
    expect(backlog.items[0]?.currentRequestInputRevision).toMatchObject({
      title: payload.title,
      blockersDeclared: true,
      dependenciesDeclared: true,
      responseChannelResolution: { state: "CONFIRMED" },
    });
    const detail = await controller.detail(
      request,
      localSeedIds.workspaceFunctional,
      localSeedIds.alpha,
      requiredFixture(confirmations[0]!.workItemId),
      response,
    );
    expect(detail).toMatchObject({
      sessions: [],
      findings: [],
      defectLinks: [],
      verdicts: [],
      finalCloseConfirmations: [],
    });
  });
});
