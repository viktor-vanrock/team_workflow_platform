import type { DataSource } from "typeorm";

import { type JsonValue, sha256 } from "@awp/platform-contracts";

interface DraftRow {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly id: string;
  readonly currentRevision: number;
  readonly currentContentHash: string;
  readonly legacyPayload: Readonly<Record<string, JsonValue>>;
  readonly revisions: readonly Readonly<Record<string, JsonValue>>[];
}
export class InMemoryIntakeFoundationRepository {
  readonly #values = new Map<string, DraftRow>();
  async create(
    workspaceId: string,
    projectId: string,
    id: string,
    content: Readonly<Record<string, JsonValue>>,
  ): Promise<DraftRow> {
    const value = {
      workspaceId,
      projectId,
      id,
      currentRevision: 1,
      currentContentHash: sha256(content),
      legacyPayload: structuredClone(content),
      revisions: [structuredClone(content)],
    };
    this.#values.set(`${workspaceId}:${projectId}:${id}`, value);
    return structuredClone(value);
  }
  async append(
    workspaceId: string,
    projectId: string,
    id: string,
    expectedRevision: number,
    content: Readonly<Record<string, JsonValue>>,
  ): Promise<DraftRow> {
    const key = `${workspaceId}:${projectId}:${id}`;
    const current = this.#values.get(key);
    if (!current || current.currentRevision !== expectedRevision)
      throw new Error("DRAFT_REVISION_CAS_CONFLICT");
    const value = {
      ...current,
      currentRevision: expectedRevision + 1,
      currentContentHash: sha256(content),
      legacyPayload: structuredClone(content),
      revisions: [...current.revisions, structuredClone(content)],
    };
    this.#values.set(key, value);
    return structuredClone(value);
  }
  async get(workspaceId: string, projectId: string, id: string): Promise<DraftRow | undefined> {
    const value = this.#values.get(`${workspaceId}:${projectId}:${id}`);
    return value ? structuredClone(value) : undefined;
  }
}
export class TypeOrmIntakeDraftRevisionRepository {
  constructor(private readonly source: DataSource) {}
  async append(input: {
    workspaceId: string;
    projectId: string;
    draftId: string;
    revisionId: string;
    expectedRevision: number;
    content: JsonValue;
    createdBy: string;
    createdAt: Date;
  }): Promise<void> {
    await this.source.transaction("SERIALIZABLE", async (manager) => {
      const rows = (await manager.query(
        "SELECT current_revision,current_content_hash FROM intake_drafts WHERE workspace_id=$1 AND project_id=$2 AND id=$3 FOR UPDATE",
        [input.workspaceId, input.projectId, input.draftId],
      )) as Record<string, unknown>[];
      const row = rows[0];
      if (Number(row?.current_revision) !== input.expectedRevision)
        throw new Error("DRAFT_REVISION_CAS_CONFLICT");
      const hash = sha256(input.content);
      await manager.query(
        "INSERT INTO intake_draft_revisions(id,workspace_id,project_id,draft_id,revision,previous_content_hash,intake_schema_ref,work_type_definition_ref,content,content_hash,source_kind,action_provenance_ref,created_by,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'HUMAN_FORM',$11,$12,$13)",
        [
          input.revisionId,
          input.workspaceId,
          input.projectId,
          input.draftId,
          input.expectedRevision + 1,
          row?.current_content_hash,
          JSON.stringify({
            id: "urn:awp:schemas:004:qa-intake-partial-content:v1",
            version: 1,
            digest: "sha256:runtime",
          }),
          JSON.stringify({ key: "qa.validation", version: "1.1.0", hash: "sha256:runtime" }),
          JSON.stringify(input.content),
          hash,
          `draft-revision:${input.revisionId}`,
          input.createdBy,
          input.createdAt,
        ],
      );
      await manager.query(
        "UPDATE intake_drafts SET current_revision=$4,current_revision_id=$5,current_content_hash=$6,intake_payload=$7,conversation_state='DRAFT',updated_at=$8,row_version=row_version+1 WHERE workspace_id=$1 AND project_id=$2 AND id=$3",
        [
          input.workspaceId,
          input.projectId,
          input.draftId,
          input.expectedRevision + 1,
          input.revisionId,
          hash,
          JSON.stringify(input.content),
          input.createdAt,
        ],
      );
    });
  }
}
