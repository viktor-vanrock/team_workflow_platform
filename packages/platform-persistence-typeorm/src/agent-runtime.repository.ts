import type { DataSource } from "typeorm";

import type { AgentRunSnapshot } from "@awp/platform-core";

export class InMemoryAgentRuntimeRepository {
  readonly #values = new Map<string, AgentRunSnapshot>();
  readonly #requests = new Map<string, string>();
  create(value: AgentRunSnapshot): Readonly<{ value: AgentRunSnapshot; replayed: boolean }> {
    const key = `${value.workspaceId}:${value.projectId}:${value.humanPrincipalId}:${value.requestKey}`;
    const id = this.#requests.get(key);
    if (id) {
      const existing = this.#values.get(id)!;
      if (existing.requestHash !== value.requestHash)
        throw new Error("AGENT_RUN_IDEMPOTENCY_CONFLICT");
      return Object.freeze({ value: structuredClone(existing), replayed: true });
    }
    this.#requests.set(key, value.id);
    this.#values.set(value.id, structuredClone(value));
    return Object.freeze({ value: structuredClone(value), replayed: false });
  }
}
const json = <T>(value: unknown): T =>
  typeof value === "string" ? (JSON.parse(value) as T) : (value as T);
export class TypeOrmAgentRuntimeRepository {
  constructor(private readonly source: DataSource) {}
  async create(value: AgentRunSnapshot, promptManifest: unknown) {
    return await this.source.transaction("SERIALIZABLE", async (manager) => {
      const existing = (await manager.query(
        "SELECT * FROM agent_runs WHERE workspace_id=$1 AND project_id=$2 AND human_principal_id=$3 AND request_key=$4 FOR UPDATE",
        [value.workspaceId, value.projectId, value.humanPrincipalId, value.requestKey],
      )) as readonly Readonly<Record<string, unknown>>[];
      if (existing[0]) {
        if (existing[0].request_hash !== value.requestHash)
          throw new Error("AGENT_RUN_IDEMPOTENCY_CONFLICT");
        return Object.freeze({ value: await this.map(manager, existing[0]), replayed: true });
      }
      await manager.query(
        "INSERT INTO agent_runs(id,workspace_id,project_id,request_key,request_hash,subject,human_principal_id,service_principal_id,prompt_manifest,grant_set_hash,state,result,row_version,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NULL,$12,clock_timestamp())",
        [
          value.id,
          value.workspaceId,
          value.projectId,
          value.requestKey,
          value.requestHash,
          JSON.stringify(value.subject),
          value.humanPrincipalId,
          value.servicePrincipalId,
          JSON.stringify(promptManifest),
          value.grantSetHash,
          value.status,
          value.rowVersion,
        ],
      );
      for (const [ordinal, grant] of value.grants.entries())
        await manager.query(
          "INSERT INTO agent_run_grants(run_id,ordinal,grant_payload,grant_hash) VALUES($1,$2,$3,$4)",
          [value.id, ordinal, JSON.stringify(grant), value.grantSetHash],
        );
      await manager.query(
        "INSERT INTO agent_run_steps(run_id,ordinal,state,input_hash) VALUES($1,0,'QUEUED',$2)",
        [value.id, value.requestHash],
      );
      return Object.freeze({ value, replayed: false });
    });
  }
  async get(workspaceId: string, projectId: string, id: string) {
    const rows = (await this.source.query(
      "SELECT * FROM agent_runs WHERE workspace_id=$1 AND project_id=$2 AND id=$3",
      [workspaceId, projectId, id],
    )) as readonly Readonly<Record<string, unknown>>[];
    if (!rows[0]) return undefined;
    return await this.map(this.source, rows[0]);
  }
  private async map(
    query: { query(sql: string, parameters?: unknown[]): Promise<unknown> },
    row: Readonly<Record<string, unknown>>,
  ) {
    const grants = (await query.query(
      "SELECT grant_payload FROM agent_run_grants WHERE run_id=$1 ORDER BY ordinal",
      [row.id],
    )) as readonly Readonly<{ grant_payload: unknown }>[];
    return Object.freeze({
      id: String(row.id),
      workspaceId: String(row.workspace_id),
      projectId: String(row.project_id),
      requestKey: String(row.request_key),
      requestHash: String(row.request_hash),
      subject: json(row.subject),
      humanPrincipalId: String(row.human_principal_id),
      servicePrincipalId: String(row.service_principal_id),
      grants: grants.map(({ grant_payload }) => json(grant_payload)),
      grantSetHash: String(row.grant_set_hash),
      status: String(row.state),
      ...(row.result ? { result: json(row.result) } : {}),
      rowVersion: Number(row.row_version),
    }) as AgentRunSnapshot;
  }
}
