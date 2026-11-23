import type { DataSource } from "typeorm";

import { type ActionProvenance, createActionProvenance } from "@awp/platform-core";

export class InMemoryActionProvenanceRepository {
  readonly #values = new Map<string, ActionProvenance>();
  async append(input: ActionProvenance): Promise<ActionProvenance> {
    const value = createActionProvenance(input);
    const existing = this.#values.get(value.id);
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(value))
        throw new Error("ACTION_PROVENANCE_COLLISION");
      return existing;
    }
    this.#values.set(value.id, value);
    return value;
  }
  async get(
    workspaceId: string,
    projectId: string,
    id: string,
  ): Promise<ActionProvenance | undefined> {
    const value = this.#values.get(id);
    return value?.workspaceId === workspaceId && value.projectId === projectId
      ? structuredClone(value)
      : undefined;
  }
}
export class TypeOrmActionProvenanceRepository {
  constructor(private readonly source: DataSource) {}
  async append(input: ActionProvenance): Promise<ActionProvenance> {
    const value = createActionProvenance(input);
    await this.source.query(
      "INSERT INTO action_provenance_records(id,workspace_id,project_id,actor,subject,action,effect_class,configuration,request_hash,authorization_basis_hash,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(id) DO NOTHING",
      [
        value.id,
        value.workspaceId,
        value.projectId,
        JSON.stringify(value.actor),
        JSON.stringify(value.subject),
        value.action,
        value.effectClass,
        JSON.stringify(value.configuration),
        value.requestHash ?? null,
        value.authorizationBasisHash ?? null,
        value.occurredAt,
      ],
    );
    const rows = (await this.source.query(
      "SELECT workspace_id,project_id FROM action_provenance_records WHERE id=$1",
      [value.id],
    )) as readonly Record<string, unknown>[];
    if (rows[0]?.workspace_id !== value.workspaceId || rows[0]?.project_id !== value.projectId)
      throw new Error("ACTION_PROVENANCE_COLLISION");
    return value;
  }
}
