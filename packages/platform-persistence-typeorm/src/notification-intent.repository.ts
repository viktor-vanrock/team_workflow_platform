import type { DataSource, EntityManager } from "typeorm";

import type { NotificationIntentSnapshot } from "@awp/platform-core";

export class InMemoryNotificationIntentRepository {
  readonly #values = new Map<string, NotificationIntentSnapshot>();
  readonly #dedupe = new Map<string, string>();
  create(
    value: NotificationIntentSnapshot,
  ): Readonly<{ value: NotificationIntentSnapshot; replayed: boolean }> {
    const key = `${value.workspaceId}:${value.projectId}:${value.dedupeKey}`;
    const id = this.#dedupe.get(key);
    if (id) return Object.freeze({ value: structuredClone(this.#values.get(id)!), replayed: true });
    this.#dedupe.set(key, value.id);
    this.#values.set(value.id, structuredClone(value));
    return Object.freeze({ value: structuredClone(value), replayed: false });
  }
}

const rows = (value: unknown): readonly Readonly<Record<string, unknown>>[] =>
  Array.isArray(value) ? (value as readonly Readonly<Record<string, unknown>>[]) : [];
export class TypeOrmNotificationIntentRepository {
  constructor(private readonly source: DataSource) {}
  async create(
    value: NotificationIntentSnapshot,
    manager: Pick<EntityManager, "query"> = this.source.manager,
  ) {
    const inserted = rows(
      await manager.query(
        "INSERT INTO notification_intents(id,workspace_id,project_id,dedupe_key,source_event_ref,target,target_hash,payload_hash,render_hash,command_id,state,expires_at,row_version,template_evidence,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,clock_timestamp()) ON CONFLICT(workspace_id,project_id,dedupe_key) DO NOTHING RETURNING id",
        [
          value.id,
          value.workspaceId,
          value.projectId,
          value.dedupeKey,
          value.sourceEventRef,
          JSON.stringify(value.target),
          value.targetHash,
          value.payloadHash,
          value.renderHash,
          value.commandId,
          value.state,
          value.expiresAt,
          value.rowVersion,
          value.templateEvidence ? JSON.stringify(value.templateEvidence) : null,
        ],
      ),
    );
    const current = await this.get(
      value.workspaceId,
      value.projectId,
      inserted[0] ? value.id : undefined,
      value.dedupeKey,
      manager,
    );
    if (!current) throw new Error("NOTIFICATION_INTENT_CREATE_CONFLICT");
    return Object.freeze({ value: current, replayed: inserted.length === 0 });
  }
  async get(
    workspaceId: string,
    projectId: string,
    id?: string,
    dedupeKey?: string,
    manager: Pick<EntityManager, "query"> = this.source.manager,
  ): Promise<NotificationIntentSnapshot | undefined> {
    const found = rows(
      await manager.query(
        "SELECT * FROM notification_intents WHERE workspace_id=$1 AND project_id=$2 AND (($3::text IS NOT NULL AND id=$3) OR ($4::text IS NOT NULL AND dedupe_key=$4)) LIMIT 1",
        [workspaceId, projectId, id ?? null, dedupeKey ?? null],
      ),
    );
    if (!found[0]) return undefined;
    const attemptRows = rows(
      await manager.query(
        "SELECT * FROM notification_delivery_attempts WHERE notification_intent_id=$1 ORDER BY attempt",
        [found[0].id],
      ),
    );
    return this.map(found[0], attemptRows);
  }
  async recordInvocation(
    input: Readonly<{
      workspaceId: string;
      projectId: string;
      id: string;
      expectedVersion: number;
      startedAt: Date;
      invokedAt: Date;
      selectorHash?: string;
    }>,
  ) {
    return await this.source.transaction("SERIALIZABLE", async (manager) => {
      const current = await this.get(
        input.workspaceId,
        input.projectId,
        input.id,
        undefined,
        manager,
      );
      if (!current || current.rowVersion !== input.expectedVersion || current.state !== "QUEUED")
        throw new Error("NOTIFICATION_INTENT_CAS_CONFLICT");
      const attempt = current.attempts.length + 1,
        fence = current.rowVersion + 1;
      await manager.query(
        "INSERT INTO notification_delivery_attempts(notification_intent_id,attempt,fence,started_at,effect_invocation_started_at,outcome,selector_hash) VALUES($1,$2,$3,$4,$5,'INVOKED',$6)",
        [input.id, attempt, fence, input.startedAt, input.invokedAt, input.selectorHash ?? null],
      );
      await manager.query(
        "UPDATE notification_intents SET state='LOOKUP_REQUIRED',row_version=row_version+2 WHERE workspace_id=$1 AND project_id=$2 AND id=$3 AND row_version=$4",
        [input.workspaceId, input.projectId, input.id, input.expectedVersion],
      );
      return await this.get(input.workspaceId, input.projectId, input.id, undefined, manager);
    });
  }
  async settle(
    input: Readonly<{
      workspaceId: string;
      projectId: string;
      id: string;
      state: "DELIVERED" | "FAILED_FINAL" | "AMBIGUOUS" | "EXPIRED";
      outcome: string;
    }>,
  ) {
    return await this.source.transaction("SERIALIZABLE", async (manager) => {
      const current = await this.get(
        input.workspaceId,
        input.projectId,
        input.id,
        undefined,
        manager,
      );
      if (!current) throw new Error("NOTIFICATION_INTENT_NOT_FOUND");
      if (new Set(["DELIVERED", "FAILED_FINAL", "AMBIGUOUS", "EXPIRED"]).has(current.state))
        return current;
      await manager.query(
        "UPDATE notification_delivery_attempts SET outcome=$2 WHERE notification_intent_id=$1 AND attempt=(SELECT max(attempt) FROM notification_delivery_attempts WHERE notification_intent_id=$1)",
        [input.id, input.outcome],
      );
      const changed = rows(
        await manager.query(
          "UPDATE notification_intents SET state=$4,row_version=row_version+1 WHERE workspace_id=$1 AND project_id=$2 AND id=$3 AND state IN ('QUEUED','DELIVERING','LOOKUP_REQUIRED') RETURNING id",
          [input.workspaceId, input.projectId, input.id, input.state],
        ),
      );
      if (changed.length !== 1) throw new Error("NOTIFICATION_INTENT_CAS_CONFLICT");
      return await this.get(input.workspaceId, input.projectId, input.id, undefined, manager);
    });
  }
  private map(
    row: Readonly<Record<string, unknown>>,
    attempts: readonly Readonly<Record<string, unknown>>[],
  ): NotificationIntentSnapshot {
    const target: unknown =
      typeof row.target === "string" ? (JSON.parse(row.target) as unknown) : row.target;
    return Object.freeze({
      id: String(row.id),
      workspaceId: String(row.workspace_id),
      projectId: String(row.project_id),
      dedupeKey: String(row.dedupe_key),
      sourceEventRef: String(row.source_event_ref),
      target: target as NotificationIntentSnapshot["target"],
      targetHash: String(row.target_hash),
      payloadHash: String(row.payload_hash),
      renderHash: String(row.render_hash),
      ...(row.template_evidence
        ? {
            templateEvidence: (typeof row.template_evidence === "string"
              ? JSON.parse(row.template_evidence)
              : row.template_evidence) as NonNullable<
              NotificationIntentSnapshot["templateEvidence"]
            >,
          }
        : {}),
      commandId: String(row.command_id),
      state: String(row.state) as NotificationIntentSnapshot["state"],
      attempts: Object.freeze(
        attempts.map((value) =>
          Object.freeze({
            attempt: Number(value.attempt),
            fence: Number(value.fence),
            startedAt: new Date(String(value.started_at)),
            ...(value.effect_invocation_started_at
              ? { effectInvocationStartedAt: new Date(String(value.effect_invocation_started_at)) }
              : {}),
            ...(value.outcome ? { outcome: String(value.outcome) } : {}),
          }),
        ),
      ),
      expiresAt: new Date(String(row.expires_at)),
      rowVersion: Number(row.row_version),
    });
  }
}
