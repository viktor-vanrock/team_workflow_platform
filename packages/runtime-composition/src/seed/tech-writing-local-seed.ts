import { createHash, randomUUID } from "node:crypto";

import type { DataSource } from "typeorm";

import {
  changeDocument,
  type DocumentHistory,
  newDocument,
  techWritingManifest,
} from "@awp/competency-tech-writing";

import { localPersonaCatalog } from "../security/local-security.ts";

export const TECH_WRITING_SEED_KEY = "015-tech-writing-workspace";
export const TECH_WRITING_SEED_VERSION = 1;
export const techWritingIds = Object.freeze({
  workspace: "15000000-0000-4000-8000-000000000001",
  project: "15000000-0000-4000-8000-000000000002",
  writer: "15000000-0000-4000-8000-000000000003",
  lead: "15000000-0000-4000-8000-000000000004",
  draft: "15000000-0000-4000-8000-000000000101",
  review: "15000000-0000-4000-8000-000000000102",
  returned: "15000000-0000-4000-8000-000000000103",
});
const hash = (body: unknown) =>
  `sha256:${createHash("sha256").update(JSON.stringify(body)).digest("hex")}`;

/** Independent add-only seed. Never reruns or updates existing QA seeds/data. */
export async function runTechWritingLocalSeed(
  source: DataSource,
): Promise<"applied" | "unchanged"> {
  if (process.env.AWP_RUNTIME_PROFILE !== "local" && process.env.AWP_RUNTIME_PROFILE !== "test")
    throw new Error("TECH_WRITING_LOCAL_ONLY");
  return source.transaction(async (manager) => {
    await manager.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      TECH_WRITING_SEED_KEY,
    ]);
    const markers = (await manager.query("SELECT version FROM local_seed_markers WHERE key=$1", [
      TECH_WRITING_SEED_KEY,
    ])) as { version: number }[];
    if (markers[0]?.version === TECH_WRITING_SEED_VERSION) return "unchanged";
    if (markers[0]) throw new Error("TECH_WRITING_SEED_VERSION_AHEAD");
    const ids = techWritingIds;
    await manager.query(
      "INSERT INTO workspaces(id,key,name,state) VALUES($1,'local-tech-writing','Техническая документация','ACTIVE') ON CONFLICT DO NOTHING",
      [ids.workspace],
    );
    await manager.query(
      "INSERT INTO projects(id,workspace_id,key,name,state,classification_key) VALUES($1,$2,'ALPHA-DOCS','Сервис ALPHA — документация','ACTIVE','INTERNAL') ON CONFLICT DO NOTHING",
      [ids.project, ids.workspace],
    );
    for (const [key, id, suffix] of [
      ["writer.docs", ids.writer, "11"],
      ["lead.docs", ids.lead, "12"],
    ] as const) {
      const persona = localPersonaCatalog.resolve(key);
      const membership = `15000000-0000-4000-8000-0000000000${suffix}`;
      const role = `15000000-0000-4000-8000-0000000000${Number(suffix) + 10}`;
      const entitlement = `15000000-0000-4000-8000-0000000000${Number(suffix) + 20}`;
      await manager.query(
        "INSERT INTO identities(id,issuer,subject,kind,display_name) VALUES($1,$2,$3,'HUMAN',$4) ON CONFLICT DO NOTHING",
        [id, "https://fake-idp:4443/oidc", key, persona.label],
      );
      await manager.query(
        "INSERT INTO workspace_memberships(id,workspace_id,principal_id,state,valid_from) VALUES($1,$2,$3,'ACTIVE','2026-01-01') ON CONFLICT DO NOTHING",
        [membership, ids.workspace, id],
      );
      await manager.query(
        "INSERT INTO role_assignments(id,workspace_id,project_id,principal_id,role_key,effect,permissions,valid_from) VALUES($1,$2,$3,$4,$5,'ALLOW',$6,'2026-01-01') ON CONFLICT DO NOTHING",
        [
          role,
          ids.workspace,
          ids.project,
          id,
          persona.roles[0],
          JSON.stringify(persona.permissions),
        ],
      );
      await manager.query(
        "INSERT INTO project_entitlements(id,workspace_id,project_id,principal_id,effect,classification_ceiling_key,permissions,valid_from) VALUES($1,$2,$3,$4,'ALLOW','INTERNAL',$5,'2026-01-01') ON CONFLICT DO NOTHING",
        [entitlement, ids.workspace, ids.project, id, JSON.stringify(persona.permissions)],
      );
      for (const permission of persona.permissions)
        await manager.query(
          "INSERT INTO project_entitlement_permissions(entitlement_id,permission_key) VALUES($1,$2) ON CONFLICT DO NOTHING",
          [entitlement, permission],
        );
    }
    const pack = "15000000-0000-4000-8000-000000000041",
      definition = "15000000-0000-4000-8000-000000000042";
    await manager.query(
      "INSERT INTO competency_pack_registrations(id,pack_key,pack_version,manifest_schema_version,required_core_contract_range,manifest_payload,manifest_hash,registration_status,registered_at) VALUES($1,'tech-writing','1.0.0',1,'>=1.0.0 <2.0.0',$2,$3,'REGISTERED',clock_timestamp()) ON CONFLICT DO NOTHING",
      [pack, JSON.stringify(techWritingManifest), hash(techWritingManifest)],
    );
    const workType = techWritingManifest.workTypes[0];
    await manager.query(
      "INSERT INTO work_type_definitions(id,pack_registration_id,work_type_key,definition_version,intake_schema,intake_schema_hash,required_capabilities,definition_payload,definition_hash,lifecycle_status,registered_at) VALUES($1,$2,$3,'1.0.0',$4,$5,'[]',$6,$7,'ACTIVE',clock_timestamp()) ON CONFLICT DO NOTHING",
      [
        definition,
        pack,
        workType.key,
        JSON.stringify(workType.intakeSchemaRef),
        workType.intakeSchemaRef.digest,
        JSON.stringify(workType),
        hash(workType),
      ],
    );
    await manager.query(
      "INSERT INTO workspace_work_types(id,workspace_id,work_type_key,active_definition_id,intake_state,changed_by,changed_at,reason) VALUES('15000000-0000-4000-8000-000000000043',$1,$2,$3,'ENABLED',$4,clock_timestamp(),'Локальная демонстрация ADR-0010') ON CONFLICT DO NOTHING",
      [ids.workspace, workType.key, definition, ids.lead],
    );
    const writer = { id: ids.writer, label: "Технический писатель" },
      lead = { id: ids.lead, label: "Лид технических писателей" },
      at = "2026-09-09T08:00:00.000Z";
    for (const [id, title, mode] of [
      [ids.draft, "ALPHA: руководство по первому запросу", 0],
      [ids.review, "ALPHA: справочник учебного API", 1],
      [ids.returned, "ALPHA: обработка ошибок интеграции", 2],
    ] as const) {
      let document = newDocument({
        id,
        workspaceId: ids.workspace,
        projectId: ids.project,
        title,
        goal: "Помочь интегратору самостоятельно создать запрос и проверить его состояние.",
        audience: "Разработчики интеграций и инженеры поддержки",
        author: writer,
        at,
        hash: hash(""),
      });
      const history: DocumentHistory[] = [{ action: "create", actor: writer, at, document }];
      if (mode > 0) {
        const body =
          "# " +
          title +
          "\n\nALPHA обрабатывает пользовательские запросы.\n\n1. Передайте учебный Bearer-токен.\n2. Создайте запрос через POST /requests с title и description.\n3. Сохраните id из ответа 201.\n4. Получите состояние через GET /requests/{id}.\n\nСостояния: new → processing → done.\n\nЭто учебный контракт из материалов задания.";
        document = changeDocument(document, {
          action: "save",
          body,
          actor: writer,
          at,
          expectedVersion: document.resourceVersion,
          hash: hash(body),
        });
        history.push({ action: "save", actor: writer, at, document });
        document = changeDocument(document, {
          action: "submit",
          actor: writer,
          at,
          expectedVersion: document.resourceVersion,
          hash: document.contentHash,
        });
        history.push({ action: "submit", actor: writer, at, document });
        if (mode === 2) {
          document = changeDocument(document, {
            action: "return",
            feedback:
              "Добавьте раздел ошибок 400, 401 и 404 и объясните, что делать интегратору в каждом случае.",
            actor: lead,
            at,
            expectedVersion: document.resourceVersion,
            hash: document.contentHash,
          });
          history.push({ action: "return", actor: lead, at, document });
        }
      }
      const inserted = (await manager.query(
        "INSERT INTO tech_writing_documents(id,workspace_id,project_id,author_id,snapshot) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING id",
        [id, ids.workspace, ids.project, ids.writer, JSON.stringify(document)],
      )) as unknown[];
      if (inserted.length)
        for (const entry of history)
          await manager.query(
            "INSERT INTO tech_writing_history(id,workspace_id,project_id,document_id,resource_version,entry,authorization_basis) VALUES($1,$2,$3,$4,$5,$6,$7)",
            [
              randomUUID(),
              ids.workspace,
              ids.project,
              id,
              entry.document.resourceVersion,
              JSON.stringify(entry),
              JSON.stringify({
                kind: "LOCAL_SEED",
                version: 1,
                reason: "Демонстрационная история, не реальное решение пользователя",
              }),
            ],
          );
    }
    await manager.query(
      "INSERT INTO local_seed_markers(key,version,applied_at) VALUES($1,$2,clock_timestamp())",
      [TECH_WRITING_SEED_KEY, TECH_WRITING_SEED_VERSION],
    );
    return "applied";
  });
}
