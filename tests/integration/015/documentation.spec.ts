import { randomUUID } from "node:crypto";

import type { DataSource } from "typeorm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { LocalPersonaSessionService } from "../../../apps/api/src/local/local-persona.controller.ts";
import { TechWritingService } from "../../../apps/api/src/local/tech-writing.service.ts";
import { createPlatformDataSource } from "../../../packages/platform-persistence-typeorm/src/index.ts";
import {
  type RunningPostgres,
  startPostgres,
} from "../../../packages/platform-testkit/src/postgres.ts";
import { localMigrations } from "../../../packages/runtime-composition/src/migrations/composition.ts";
import { runLocalSeed } from "../../../packages/runtime-composition/src/seed/local-seed.ts";
import {
  runTechWritingLocalSeed,
  techWritingIds as ids,
} from "../../../packages/runtime-composition/src/seed/tech-writing-local-seed.ts";

const enabled = process.env.AWP_RUN_CONTAINER_TESTS === "true";
const scope = { workspaceId: ids.workspace, projectId: ids.project };
const writer = { headers: {}, localPersonaKey: "writer.docs" };
const lead = { headers: {}, localPersonaKey: "lead.docs" };
const match = (version: number) => `"${version}"`;

describe.runIf(enabled)("015 — настоящий PostgreSQL, роли и документы", () => {
  let postgres: RunningPostgres;
  let source: DataSource;
  let service: TechWritingService;
  beforeAll(async () => {
    postgres = await startPostgres();
    vi.stubEnv("AWP_RUNTIME_PROFILE", "local");
    vi.stubEnv("AWP_ENVIRONMENT", "LOCAL");
    vi.stubEnv("AWP_DATABASE_URL", postgres.url);
    vi.stubEnv("AWP_IDENTITY_ISSUER", "https://fake-idp:4443/oidc");
    vi.stubEnv("AWP_IDENTITY_AUDIENCE", "awp-local");
    vi.stubEnv("AWP_EXTERNAL_NETWORK_MODE", "deny");
    source = createPlatformDataSource({
      url: postgres.url,
      entities: [],
      migrations: localMigrations,
    });
    await source.initialize();
    await source.runMigrations();
    await runLocalSeed(source);
    expect(await runTechWritingLocalSeed(source)).toBe("applied");
    service = new TechWritingService(source);
  }, 120000);
  afterAll(async () => {
    await source?.destroy();
    await postgres?.stop();
    vi.unstubAllEnvs();
  });
  const create = () =>
    service.create(
      writer,
      scope,
      { title: "Проверка цикла ALPHA", goal: "Первый запрос", audience: "Интеграторы" },
      randomUUID(),
    );
  it("добавляет ровно три примера, повторный seed и старый seed сохраняют QA и текст", async () => {
    expect((await service.list(writer, scope)).documents).toHaveLength(3);
    const before = await source.query("SELECT snapshot FROM tech_writing_documents ORDER BY id");
    const qa = await source.query("SELECT * FROM work_items ORDER BY id");
    expect(await runTechWritingLocalSeed(source)).toBe("unchanged");
    expect(await runLocalSeed(source)).toBe("unchanged");
    expect(await source.query("SELECT snapshot FROM tech_writing_documents ORDER BY id")).toEqual(
      before,
    );
    expect(await source.query("SELECT * FROM work_items ORDER BY id")).toEqual(qa);
  });
  it("выбирает workspace persona при нескольких membership", async () => {
    await source.query(
      "INSERT INTO workspace_memberships(id,workspace_id,principal_id,state,valid_from) VALUES($1,'10000000-0000-4000-8000-000000000001',$2,'ACTIVE','2026-01-01')",
      [randomUUID(), ids.writer],
    );
    const sessions = new LocalPersonaSessionService(source, {
      issue: async () => ({ access_token: "test-token", token_type: "Bearer", expires_in: 900 }),
    } as never);
    const session = await sessions.exchange("writer.docs");
    expect(session.context.workspaceId).toBe(ids.workspace);
    expect(session.grants.permissions).not.toContain("docs.review");
  });
  it("проходит возврат и повторное ревью; утверждение относится к точному тексту и снимается после правки", async () => {
    let result = await create();
    const id = result.document.id;
    result = await service.act(
      writer,
      scope,
      id,
      "save",
      { body: "Исходный текст" },
      randomUUID(),
      match(result.document.resourceVersion),
    );
    expect((await service.get(writer, scope, id)).document.body).toBe("Исходный текст");
    result = await service.act(
      writer,
      scope,
      id,
      "submit",
      {},
      randomUUID(),
      match(result.document.resourceVersion),
    );
    await expect(
      service.act(
        writer,
        scope,
        id,
        "approve",
        {},
        randomUUID(),
        match(result.document.resourceVersion),
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service.act(
        lead,
        scope,
        id,
        "return",
        { feedback: "" },
        randomUUID(),
        match(result.document.resourceVersion),
      ),
    ).rejects.toMatchObject({ status: 400 });
    result = await service.act(
      lead,
      scope,
      id,
      "return",
      { feedback: "Опишите 401" },
      randomUUID(),
      match(result.document.resourceVersion),
    );
    result = await service.act(
      writer,
      scope,
      id,
      "save",
      { body: "Исправлено: 401 означает отсутствие токена" },
      randomUUID(),
      match(result.document.resourceVersion),
    );
    result = await service.act(
      writer,
      scope,
      id,
      "submit",
      {},
      randomUUID(),
      match(result.document.resourceVersion),
    );
    result = await service.act(
      lead,
      scope,
      id,
      "approve",
      {},
      randomUUID(),
      match(result.document.resourceVersion),
    );
    expect(result.document.approval).toMatchObject({
      revision: result.document.revision,
      contentHash: result.document.contentHash,
      actor: { id: ids.lead },
    });
    const approved = result.document;
    result = await service.act(
      writer,
      scope,
      id,
      "save",
      { body: "Другая редакция" },
      randomUUID(),
      match(result.document.resourceVersion),
    );
    expect(result.document.approval).toBeNull();
    expect(result.document.state).toBe("DRAFT");
    expect(result.history.find((e) => e.action === "approve")?.document).toEqual(approved);
    const audit = await source.query(
      "SELECT * FROM audit_events WHERE attributes->>'documentId'=$1",
      [id],
    );
    expect(audit).toHaveLength(result.history.length);
    await expect(
      source.query("UPDATE tech_writing_history SET entry='{}' WHERE document_id=$1", [id]),
    ).rejects.toThrow("TECH_WRITING_HISTORY_IMMUTABLE");
    const persisted = await source.query(
      "SELECT snapshot FROM tech_writing_documents WHERE id=$1",
      [id],
    );
    expect(await runTechWritingLocalSeed(source)).toBe("unchanged");
    expect(
      await source.query("SELECT snapshot FROM tech_writing_documents WHERE id=$1", [id]),
    ).toEqual(persisted);
  });
  it("не выдаёт чужой scope/документ, не принимает подмену authority", async () => {
    await expect(
      service.list(writer, { ...scope, workspaceId: "10000000-0000-4000-8000-000000000001" }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service.list(writer, { ...scope, projectId: "20000000-0000-4000-8000-000000000001" }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service.list({ headers: {}, localPersonaKey: "executor.alpha" }, scope),
    ).rejects.toMatchObject({ status: 403 });
    await expect(service.list({ headers: {} }, scope)).rejects.toMatchObject({ status: 401 });
    await expect(
      service.get(writer, scope, "80000000-0000-4000-8000-000000000001"),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      service.create(
        writer,
        scope,
        { title: "X", goal: "Y", audience: "Z", actorId: ids.lead },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
  it.each(["workspace_memberships", "project_entitlements", "role_assignments"] as const)(
    "отзыв %s немедленно блокирует чтение и запись",
    async (table) => {
      const doc = await create();
      await source.query(`UPDATE ${table} SET revoked_at=clock_timestamp() WHERE principal_id=$1`, [
        ids.writer,
      ]);
      try {
        await expect(service.list(writer, scope)).rejects.toMatchObject({ status: 403 });
        await expect(
          service.act(
            writer,
            scope,
            doc.document.id,
            "save",
            { body: "Недопустимый текст" },
            randomUUID(),
            '"1"',
          ),
        ).rejects.toMatchObject({ status: 403 });
      } finally {
        await source.query(`UPDATE ${table} SET revoked_at=NULL WHERE principal_id=$1`, [
          ids.writer,
        ]);
      }
    },
  );
  it("классификация и отзыв конкретного разрешения работают отдельно", async () => {
    await source.query(
      "UPDATE project_entitlements SET classification_ceiling_key='PUBLIC' WHERE principal_id=$1",
      [ids.writer],
    );
    try {
      await expect(service.list(writer, scope)).rejects.toMatchObject({ status: 403 });
    } finally {
      await source.query(
        "UPDATE project_entitlements SET classification_ceiling_key='INTERNAL' WHERE principal_id=$1",
        [ids.writer],
      );
    }
    await source.query(
      "UPDATE role_assignments SET permissions='[\"docs.read\"]' WHERE principal_id=$1",
      [ids.lead],
    );
    try {
      expect((await service.list(lead, scope)).permissions).not.toContain("docs.review");
      await expect(
        service.act(lead, scope, ids.review, "approve", {}, randomUUID(), '"3"'),
      ).rejects.toMatchObject({ status: 403 });
    } finally {
      await source.query(
        'UPDATE role_assignments SET permissions=\'["docs.read","docs.review"]\' WHERE principal_id=$1',
        [ids.lead],
      );
    }
  });
  it("повторы идемпотентны, разные payload и конкурентные сохранения не теряют версии", async () => {
    const result = await create();
    const id = result.document.id,
      key = randomUUID();
    const first = await service.act(
      writer,
      scope,
      id,
      "save",
      { body: "Сохранённый текст" },
      key,
      '"1"',
    );
    expect(
      await service.act(writer, scope, id, "save", { body: "Сохранённый текст" }, key, '"1"'),
    ).toEqual(first);
    await expect(
      service.act(writer, scope, id, "save", { body: "Иной текст" }, key, '"1"'),
    ).rejects.toMatchObject({ status: 409 });
    const concurrent = await Promise.allSettled(
      ["Версия A", "Версия B"].map((body) =>
        service.act(writer, scope, id, "save", { body }, randomUUID(), '"2"'),
      ),
    );
    expect(concurrent.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(concurrent.filter((r) => r.status === "rejected")).toHaveLength(1);
    const final = await service.get(writer, scope, id);
    expect(final.document.resourceVersion).toBe(3);
    expect(final.history).toHaveLength(3);
  });
});
