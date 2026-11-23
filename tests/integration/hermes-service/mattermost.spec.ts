import "../../../apps/api/node_modules/reflect-metadata/Reflect.js";

import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, expect, it, vi } from "vitest";

import { Module } from "../../../apps/api/node_modules/@nestjs/common/index.js";
import { NestFactory } from "../../../apps/api/node_modules/@nestjs/core/index.js";
import { HermesMattermostController } from "../../../apps/api/src/extensions/hermes/mattermost.controller.ts";
import { QA_DATA_SOURCE } from "../../../apps/api/src/extensions/qa-api-authorization.ts";
import { QA_INTAKE_CONFIGURATION } from "../../../apps/api/src/extensions/qa-intake-configuration.ts";
import { createLocalQaIntakeConfiguration } from "../../../apps/api/src/local/local-qa-intake-configuration.ts";
import { createHermesServer } from "../../../apps/hermes/src/server.ts";
import { loadEnvironment } from "../../../packages/runtime-composition/src/config/environment.ts";
import { localPersonaIds } from "../../../packages/runtime-composition/src/seed/local-seed.ts";
import { runQaJiraLocalSeed } from "../../../packages/runtime-composition/src/seed/qa-jira-local-seed.ts";
import { startBindingHttpFixture } from "../../support/007-binding-http-fixture.ts";
import { POSTGRES_TEST_IMAGES } from "../../testcontainers.config.ts";

@Module({})
class MmModule {}
let f: Awaited<ReturnType<typeof startBindingHttpFixture>>,
  app: Awaited<ReturnType<typeof NestFactory.create>>,
  directory: string,
  origin: string;
const connectionId = randomUUID(),
  mmToken = "mm-command-test-token-26-characters",
  serviceToken = "hermes-service-test-token-32-characters";
const server = createHermesServer({
  token: serviceToken,
  port: 3020,
  mode: "deterministic",
  ready: () => true,
});
const slash = (text: string, extra: Record<string, string> = {}, suffix = "") =>
  fetch(`${origin}/api/v1/hermes/mattermost${suffix}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      token: mmToken,
      command: "/hermes",
      team_id: "mm-alpha",
      channel_id: "mm-alpha-qa",
      user_id: "mm-requester",
      trigger_id: randomUUID(),
      text,
      ...extra,
    }),
  });
beforeAll(async () => {
  f = await startBindingHttpFixture(POSTGRES_TEST_IMAGES[0]!);
  vi.stubEnv("AWP_ENVIRONMENT", "LOCAL");
  vi.stubEnv("AWP_RUNTIME_PROFILE", "local");
  vi.stubEnv("AWP_COMPOSITION", "qa-jira-local");
  vi.stubEnv("AWP_MOCK_HUB_URL", "http://mock-hub:4010");
  await runQaJiraLocalSeed(f.source, loadEnvironment());
  await f.source.query(
    "INSERT INTO connection_headers(id,workspace_id,key,current_published_version) VALUES($1,$2,'hermes-mm-test',1)",
    [connectionId, f.scope.workspaceId],
  );
  await f.source.query(
    "INSERT INTO connection_revisions(id,workspace_id,header_id,version,status,content,content_hash,created_at) VALUES($1,$2,$3,1,'PUBLISHED',$4,$5,clock_timestamp())",
    [
      randomUUID(),
      f.scope.workspaceId,
      connectionId,
      { connectorKey: "mattermost.hermes-intake", projectId: f.scope.projectId },
      `sha256:${"a".repeat(64)}`,
    ],
  );
  await f.source.query(
    "INSERT INTO external_principal_bindings(id,workspace_id,connection_header_id,provider_namespace,external_principal_kind,external_principal_id,principal_id,state,verification_method,verification_evidence_hash,verified_by,verified_at,created_at,updated_at) VALUES($1,$2,$3,'mattermost.test','EXTERNAL_HUMAN','mm-requester',$4,'VERIFIED','ADMIN_REVIEW',$5,$6,clock_timestamp(),clock_timestamp(),clock_timestamp())",
    [
      randomUUID(),
      f.scope.workspaceId,
      connectionId,
      localPersonaIds["requester.alpha"],
      `sha256:${"b".repeat(64)}`,
      localPersonaIds["owner.local"],
    ],
  );
  directory = await mkdtemp(join(tmpdir(), "hermes-mm-"));
  await writeFile(join(directory, "token"), mmToken, { mode: 0o600 });
  await writeFile(
    join(directory, "config.json"),
    JSON.stringify({
      schemaVersion: 1,
      bindings: [
        {
          key: "alpha",
          workspaceId: f.scope.workspaceId,
          projectId: f.scope.projectId,
          connectionHeaderId: connectionId,
          providerNamespace: "mattermost.test",
          teamId: "mm-alpha",
          channelId: "mm-alpha-qa",
          tokenFile: join(directory, "token"),
          validUntil: new Date(Date.now() + 3600000).toISOString(),
          version: 1,
          webOrigin: "http://localhost:5173",
        },
        {
          key: "beta",
          workspaceId: f.scope.workspaceId,
          projectId: "20000000-0000-4000-8000-000000000002",
          connectionHeaderId: connectionId,
          providerNamespace: "mattermost.test",
          teamId: "mm-alpha",
          channelId: "mm-beta",
          tokenFile: join(directory, "token"),
          validUntil: new Date(Date.now() + 3600000).toISOString(),
          version: 1,
          webOrigin: "http://localhost:5173",
        },
      ],
    }),
  );
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  vi.stubEnv("AWP_HERMES_MATTERMOST_CONFIG_PATH", join(directory, "config.json"));
  vi.stubEnv("AWP_HERMES_URL", `http://127.0.0.1:${(server.address() as { port: number }).port}`);
  vi.stubEnv("AWP_HERMES_LOCAL_TOKEN", serviceToken);
  app = await NestFactory.create(
    {
      module: MmModule,
      controllers: [HermesMattermostController],
      providers: [
        { provide: QA_DATA_SOURCE, useValue: f.source },
        {
          provide: QA_INTAKE_CONFIGURATION,
          useValue: createLocalQaIntakeConfiguration(f.source, "DURABLE_WORKER"),
        },
      ],
    },
    { logger: false },
  );
  await app.listen(0, "127.0.0.1");
  origin = await app.getUrl();
}, 120000);
afterAll(async () => {
  await app?.close();
  server.closeAllConnections();
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  await f?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
});
it("creates one correctly scoped QA draft from an explicit native command", async () => {
  const trigger = randomUUID(),
    first = await slash("test Проверить оплату и возвраты", { trigger_id: trigger });
  expect(first.status).toBe(200);
  const body = await first.json();
  expect(body).toMatchObject({
    response_type: "ephemeral",
    text: expect.stringContaining("Создан черновик"),
  });
  expect(
    await (await slash("test Проверить оплату и возвраты", { trigger_id: trigger })).json(),
  ).toEqual(body);
  expect((await slash("test Другой запрос", { trigger_id: trigger })).status).toBe(409);
  const rows = await f.source.query(
    "SELECT d.id,d.workspace_id,d.project_id,d.created_by,r.source_kind FROM intake_drafts d JOIN intake_draft_revisions r ON r.id=d.current_revision_id WHERE d.intake_payload->>'title'='Проверить оплату и возвраты'",
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    workspace_id: f.scope.workspaceId,
    project_id: f.scope.projectId,
    created_by: localPersonaIds["requester.alpha"],
    source_kind: "MATTERMOST_DIALOG",
  });
  expect(
    await f.source.query(
      "SELECT id FROM connector_commands WHERE payload #>> '{metadata,source,intakeDraftId}'=$1",
      [rows[0].id],
    ),
  ).toHaveLength(0);
  const preview = await slash(`preview ${rows[0].id}`);
  expect(preview.status).toBe(200);
  const card = (await preview.json()) as { text: string };
  expect(card.text).toContain("Jira:");
  const confirmation = /\/hermes confirm ([A-Za-z0-9_.-]+)/u.exec(card.text)![1]!;
  expect((await slash(`confirm ${confirmation.slice(0, -1)}x`)).status).toBe(403);
  const confirmed = await slash(`confirm ${confirmation}`);
  expect(confirmed.status).toBe(200);
  expect((await confirmed.json()).text).toContain("Подтверждение принято");
  expect((await slash(`confirm ${confirmation}`)).status).toBe(200);
  expect(
    await f.source.query(
      "SELECT id FROM connector_commands WHERE payload #>> '{metadata,source,intakeDraftId}'=$1",
      [rows[0].id],
    ),
  ).toHaveLength(1);
});
it("invalidates confirmation when the exact draft or human binding changes", async () => {
  const created = (await (await slash("test Проверить восстановление пароля")).json()) as {
    text: string;
  };
  const draftId = /preview ([a-f0-9-]{36})/u.exec(created.text)![1]!;
  const preview = (await (await slash(`preview ${draftId}`)).json()) as { text: string };
  const confirmation = /\/hermes confirm ([A-Za-z0-9_.-]+)/u.exec(preview.text)![1]!;
  await f.source.query(
    "UPDATE intake_drafts SET row_version=row_version+1,current_revision=current_revision+1 WHERE id=$1",
    [draftId],
  );
  expect((await slash(`confirm ${confirmation}`)).status).toBe(409);
  expect(
    await f.source.query(
      "SELECT id FROM connector_commands WHERE payload #>> '{metadata,source,intakeDraftId}'=$1",
      [draftId],
    ),
  ).toHaveLength(0);
});

it("does not disclose project context through wrong identity or channel", async () => {
  expect((await slash("ask Какой проект?", { token: "invalid" })).status).toBe(401);
  // A second channel is routed to its binding, then rejects a connection from Alpha.
  expect(
    (await slash("ask Какой проект?", { channel_id: "mm-beta", token: "invalid" })).status,
  ).toBe(401);
  expect((await slash("ask Какой проект?", { channel_id: "mm-beta" })).status).toBe(403);
  expect((await slash("ask Какой проект?", { channel_id: "unknown-channel" })).status).toBe(403);
  expect((await slash("ask Какой проект?", { user_id: "unlinked" })).status).toBe(403);
  const answer = await slash("ask Какой проект?");
  expect(answer.status).toBe(200);
  expect((await answer.json()).response_type).toBe("ephemeral");
  expect((await slash("ask Какой проект?", {}, "/alpha")).status).toBe(200);
  expect((await slash("ask Какой проект?", { channel_id: "mm-beta" }, "/alpha")).status).toBe(403);
  const pending = (await (
    await slash("test Проверить подтверждение после отзыва прав")
  ).json()) as { text: string };
  const draftId = /preview ([a-f0-9-]{36})/u.exec(pending.text)![1]!;
  const card = (await (await slash(`preview ${draftId}`)).json()) as { text: string };
  const confirmation = /\/hermes confirm ([A-Za-z0-9_.-]+)/u.exec(card.text)![1]!;
  await f.source.query(
    "UPDATE external_principal_bindings SET state='REVOKED',revoked_at=clock_timestamp(),resource_version=resource_version+1 WHERE external_principal_id='mm-requester'",
  );
  expect((await slash("test Проверить чужой проект")).status).toBe(403);
  expect((await slash(`confirm ${confirmation}`)).status).toBe(403);
  expect(
    await f.source.query(
      "SELECT id FROM connector_commands WHERE payload #>> '{metadata,source,intakeDraftId}'=$1",
      [draftId],
    ),
  ).toHaveLength(0);
});
