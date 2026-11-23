import { createHash, randomUUID } from "node:crypto";

import type { DataSource, EntityManager } from "typeorm";

import { type JsonValue, sha256 } from "@awp/platform-contracts";

export interface QaDraftScope {
  readonly workspaceId: string;
  readonly projectId: string;
}
export interface CreateQaDraftRequest extends QaDraftScope {
  readonly principalId: string;
  readonly requestKey: string;
  readonly content?: Readonly<Record<string, JsonValue>>;
  readonly originCandidateId?: string;
  readonly sourceKind?: "HUMAN_FORM" | "MATTERMOST_DIALOG";
}
export interface ReviseQaDraftRequest extends QaDraftScope {
  readonly draftId: string;
  readonly principalId: string;
  readonly expectedRevision: number;
  readonly expectedContentHash: string;
  readonly content: Readonly<Record<string, JsonValue>>;
  readonly sourceKind: "HUMAN_FORM" | "MATTERMOST_DIALOG" | "AGENT_PATCH";
}

const deterministicUuid = (namespace: string): string => {
  const hex = createHash("sha256").update(namespace).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
};
const json = <T>(value: unknown): T =>
  typeof value === "string" ? (JSON.parse(value) as T) : (value as T);

export class QaIntakeDraftService {
  constructor(private readonly source: DataSource) {}

  async create(request: CreateQaDraftRequest) {
    return await this.source.transaction(
      "SERIALIZABLE",
      async (manager) => await this.createInTransaction(manager, request),
    );
  }

  async createInTransaction(manager: EntityManager, request: CreateQaDraftRequest) {
    const draftId = deterministicUuid(
      `${request.workspaceId}:${request.projectId}:${request.principalId}:${request.requestKey}:draft`,
    );
    const revisionId = deterministicUuid(`${draftId}:revision:1`);
    const content = Object.freeze({ schemaVersion: 1, ...(request.content ?? {}) }) as Readonly<
      Record<string, JsonValue>
    >;
    const contentHash = sha256(content);
    const existing = (await manager.query(
      "SELECT d.*,r.content FROM intake_drafts d JOIN intake_draft_revisions r ON r.id=d.current_revision_id WHERE d.workspace_id=$1 AND d.project_id=$2 AND d.id=$3",
      [request.workspaceId, request.projectId, draftId],
    )) as readonly Record<string, unknown>[];
    if (existing[0]) return Object.freeze({ draft: mapDraft(existing[0]), replayed: true });
    const definitions = (await manager.query(
      "SELECT d.id,d.intake_schema,d.definition_version,d.definition_hash FROM workspace_work_types e JOIN work_type_definitions d ON d.id=e.active_definition_id WHERE e.workspace_id=$1 AND e.work_type_key='qa.validation' AND e.intake_state='ENABLED'",
      [request.workspaceId],
    )) as readonly Record<string, unknown>[];
    const definition = definitions[0];
    if (!definition) throw new Error("QA_INTAKE_DEFINITION_UNAVAILABLE");
    const createdAt = new Date();
    await manager.query(
      "INSERT INTO intake_drafts(id,workspace_id,project_id,work_type_definition_id,created_by,state,intake_payload,intake_schema_ref,row_version,created_at,origin_candidate_id,current_revision,current_revision_id,current_content_hash,confirmation_state,conversation_state,updated_at) VALUES($1,$2,$3,$4,$5,'DRAFT',$6,$7,1,$8,$9,1,$10,$11,'UNCONFIRMED','DRAFT',$8)",
      [
        draftId,
        request.workspaceId,
        request.projectId,
        String(definition.id),
        request.principalId,
        JSON.stringify(content),
        JSON.stringify(json(definition.intake_schema)),
        createdAt,
        request.originCandidateId ?? null,
        revisionId,
        contentHash,
      ],
    );
    await manager.query(
      "INSERT INTO intake_draft_revisions(id,workspace_id,project_id,draft_id,revision,previous_revision_id,previous_content_hash,intake_schema_ref,work_type_definition_ref,content,content_hash,source_kind,action_provenance_ref,created_by,created_at) VALUES($1,$2,$3,$4,1,NULL,NULL,$5,$6,$7,$8,$12,$9,$10,$11)",
      [
        revisionId,
        request.workspaceId,
        request.projectId,
        draftId,
        JSON.stringify(json(definition.intake_schema)),
        JSON.stringify({
          key: "qa.validation",
          version: String(definition.definition_version),
          hash: String(definition.definition_hash),
        }),
        JSON.stringify(content),
        contentHash,
        `draft-create:${draftId}`,
        request.principalId,
        createdAt,
        request.sourceKind ?? "HUMAN_FORM",
      ],
    );
    return Object.freeze({
      draft: Object.freeze({
        id: draftId,
        workspaceId: request.workspaceId,
        projectId: request.projectId,
        revision: 1,
        revisionId,
        content,
        contentHash,
        state: "DRAFT",
        rowVersion: 1,
      }),
      replayed: false,
    });
  }

  async get(scope: QaDraftScope, draftId: string) {
    const rows = (await this.source.query(
      "SELECT d.*,r.content FROM intake_drafts d JOIN intake_draft_revisions r ON r.id=d.current_revision_id WHERE d.workspace_id=$1 AND d.project_id=$2 AND d.id=$3",
      [scope.workspaceId, scope.projectId, draftId],
    )) as readonly Record<string, unknown>[];
    if (!rows[0]) throw new Error("QA_DRAFT_NOT_FOUND");
    return mapDraft(rows[0]);
  }

  async revise(request: ReviseQaDraftRequest) {
    const contentHash = sha256(request.content);
    const revisionId = randomUUID();
    return await this.source.transaction("SERIALIZABLE", async (manager) => {
      const rows = (await manager.query(
        "SELECT d.*,r.content FROM intake_drafts d JOIN intake_draft_revisions r ON r.id=d.current_revision_id WHERE d.workspace_id=$1 AND d.project_id=$2 AND d.id=$3 FOR UPDATE OF d",
        [request.workspaceId, request.projectId, request.draftId],
      )) as readonly Record<string, unknown>[];
      const current = rows[0];
      if (!current) throw new Error("QA_DRAFT_NOT_FOUND");
      if (current.created_by !== request.principalId) throw new Error("QA_DRAFT_ACTOR_DENIED");
      if (
        Number(current.current_revision) !== request.expectedRevision ||
        current.current_content_hash !== request.expectedContentHash
      )
        throw new Error("DRAFT_REVISION_CAS_CONFLICT");
      if (current.current_content_hash === contentHash)
        return Object.freeze({ draft: mapDraft(current), replayed: true });
      const revision = request.expectedRevision + 1;
      const createdAt = new Date();
      await manager.query(
        "INSERT INTO intake_draft_revisions(id,workspace_id,project_id,draft_id,revision,previous_revision_id,previous_content_hash,intake_schema_ref,work_type_definition_ref,content,content_hash,source_kind,action_provenance_ref,created_by,created_at) SELECT $1,$2,$3,$4,$5,d.current_revision_id,d.current_content_hash,d.intake_schema_ref,r.work_type_definition_ref,$6,$7,$8,$9,$10,$11 FROM intake_drafts d JOIN intake_draft_revisions r ON r.id=d.current_revision_id AND r.draft_id=d.id AND r.workspace_id=d.workspace_id AND r.project_id=d.project_id WHERE d.workspace_id=$2 AND d.project_id=$3 AND d.id=$4",
        [
          revisionId,
          request.workspaceId,
          request.projectId,
          request.draftId,
          revision,
          JSON.stringify(request.content),
          contentHash,
          request.sourceKind,
          `draft-revise:${revisionId}`,
          request.principalId,
          createdAt,
        ],
      );
      await manager.query(
        "UPDATE intake_drafts SET current_revision=$4,current_revision_id=$5,current_content_hash=$6,intake_payload=$7,conversation_state='DRAFT',updated_at=$8,row_version=row_version+1 WHERE workspace_id=$1 AND project_id=$2 AND id=$3",
        [
          request.workspaceId,
          request.projectId,
          request.draftId,
          revision,
          revisionId,
          contentHash,
          JSON.stringify(request.content),
          createdAt,
        ],
      );
      return Object.freeze({
        draft: Object.freeze({
          id: request.draftId,
          workspaceId: request.workspaceId,
          projectId: request.projectId,
          revision,
          revisionId,
          content: structuredClone(request.content),
          contentHash,
          state: "DRAFT",
          rowVersion: Number(current.row_version) + 1,
        }),
        replayed: false,
      });
    });
  }
}

function mapDraft(row: Readonly<Record<string, unknown>>) {
  return Object.freeze({
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    projectId: String(row.project_id),
    revision: Number(row.current_revision),
    revisionId: String(row.current_revision_id),
    content: json<Readonly<Record<string, JsonValue>>>(row.content),
    contentHash: String(row.current_content_hash),
    state: String(row.conversation_state),
    rowVersion: Number(row.row_version),
  });
}
