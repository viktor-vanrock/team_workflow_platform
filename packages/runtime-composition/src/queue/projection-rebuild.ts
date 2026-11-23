import type { DataSource, EntityManager } from "typeorm";

import { type JsonValue, sha256 } from "@awp/platform-contracts";
import { createQueueStageTransition, type QueueStage } from "@awp/platform-core";

import {
  type QueueProjectionCoordinator,
  queueProjectionSourceEventTypes,
} from "./projection-worker.ts";

export interface QueueProjectionRebuildSubject {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly subjectId: string;
}

export interface QueueProjectionRebuildValidation {
  readonly valid: boolean;
  readonly subjectCount: number;
  readonly stageCounts: Readonly<Record<string, number>>;
  readonly outputSetHash: `sha256:${string}`;
  readonly failureCode?: string;
}

export interface QueueProjectionRebuildStore {
  begin(workspaceId: string): Promise<
    Readonly<{
      generationId: string;
      highWatermarks: Readonly<Record<string, string>>;
      cursor?: string;
      projectedCount?: number;
    }>
  >;
  page(
    workspaceId: string,
    generationId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<Readonly<{ subjects: readonly QueueProjectionRebuildSubject[]; nextCursor?: string }>>;
  checkpoint(generationId: string, cursor: string, projectedCount: number): Promise<void>;
  catchUp(
    workspaceId: string,
    highWatermarks: Readonly<Record<string, string>>,
  ): Promise<readonly QueueProjectionRebuildSubject[]>;
  validate(workspaceId: string, generationId: string): Promise<QueueProjectionRebuildValidation>;
  activate(
    workspaceId: string,
    generationId: string,
    validation: QueueProjectionRebuildValidation,
  ): Promise<Readonly<{ corrections: number }>>;
  fail(generationId: string, failureCode: string): Promise<void>;
}

export function queueProjectionReadState(
  generations: readonly Readonly<{ state: string }>[],
): "CURRENT" | "REBUILDING" | "ERROR" {
  if (generations.some(({ state }) => state === "BUILDING" || state === "VALIDATING"))
    return "REBUILDING";
  if (
    generations.some(({ state }) => state === "FAILED") &&
    !generations.some(({ state }) => state === "ACTIVE")
  )
    return "ERROR";
  return "CURRENT";
}

export class QueueProjectionRebuildCoordinator {
  constructor(
    private readonly store: QueueProjectionRebuildStore,
    private readonly projector: Pick<QueueProjectionCoordinator, "rebuild">,
  ) {}

  async run(
    workspaceId: string,
    pageSize = 250,
  ): Promise<Readonly<{ generationId: string; subjectCount: number; corrections: number }>> {
    if (!workspaceId || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 1_000)
      throw new Error("QUEUE_REBUILD_INPUT_INVALID");
    const started = await this.store.begin(workspaceId);
    let cursor = started.cursor;
    let projectedCount = started.projectedCount ?? 0;
    try {
      while (true) {
        const page = await this.store.page(workspaceId, started.generationId, cursor, pageSize);
        if (page.subjects.length === 0) break;
        await this.projector.rebuild(page.subjects, started.generationId);
        projectedCount += page.subjects.length;
        if (!page.nextCursor) throw new Error("QUEUE_REBUILD_CURSOR_MISSING");
        cursor = page.nextCursor;
        await this.store.checkpoint(started.generationId, cursor, projectedCount);
      }
      const catchUp = await this.store.catchUp(workspaceId, started.highWatermarks);
      if (catchUp.length > 0) await this.projector.rebuild(catchUp, started.generationId);
      const validation = await this.store.validate(workspaceId, started.generationId);
      if (!validation.valid)
        throw new Error(validation.failureCode ?? "QUEUE_REBUILD_VALIDATION_FAILED");
      const activated = await this.store.activate(workspaceId, started.generationId, validation);
      return Object.freeze({
        generationId: started.generationId,
        subjectCount: validation.subjectCount,
        corrections: activated.corrections,
      });
    } catch (error) {
      const code =
        error instanceof Error && /^[A-Z][A-Z0-9_]{0,127}$/u.test(error.message)
          ? error.message
          : "QUEUE_REBUILD_FAILED";
      await this.store.fail(started.generationId, code);
      throw error;
    }
  }
}

type Row = Record<string, unknown>;
const resultRows = (value: unknown): readonly Row[] => {
  const raw = value as readonly unknown[];
  return (Array.isArray(raw?.[0]) ? raw[0] : raw) as readonly Row[];
};
const parse = <T>(value: unknown): T =>
  typeof value === "string" ? (JSON.parse(value) as T) : (value as T);
const deterministicUuid = (namespace: string): string => {
  const hex = sha256(namespace).slice(7);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

function cursorValue(projectId: string, subjectId: string): string {
  return Buffer.from(`${projectId}\0${subjectId}`, "utf8").toString("base64url");
}

function parseCursor(cursor: string | undefined): readonly [string, string] {
  if (!cursor) return Object.freeze(["", ""]);
  const decoded = Buffer.from(cursor, "base64url").toString("utf8");
  const separator = decoded.indexOf("\0");
  if (separator < 1 || separator === decoded.length - 1)
    throw new Error("QUEUE_REBUILD_CURSOR_INVALID");
  return Object.freeze([decoded.slice(0, separator), decoded.slice(separator + 1)]);
}

function revisionDocument(row: Row): Readonly<Record<string, unknown>> {
  return Object.freeze({
    schemaVersion: "queue-entry@1.0.0",
    queueEntryId: String(row.queue_entry_id),
    revision: Number(row.revision_number),
    workspaceId: String(row.workspace_id),
    projectId: String(row.project_id),
    subject: parse(row.subject_ref),
    stage: row.stage,
    stageDetails: parse(row.stage_details),
    stageReasonCodes: parse(row.stage_reason_codes),
    operational: parse(row.operational_facet),
    qa: parse(row.qa_facet),
    control: parse(row.control_facet),
    capacity: parse(row.capacity_facet),
    sla: parse(row.sla_facet),
    ordering: parse(row.ordering_facet),
    consistencyWarnings: parse(row.consistency_warnings),
    freshness: parse(row.freshness),
    sourceRefs: parse(row.source_refs),
    sourceSetHash: row.source_set_hash,
    policyFacetRef: parse(row.policy_facet_ref),
    derivationRuleRef: parse(row.derivation_rule_ref),
    inputFingerprint: row.input_fingerprint,
    calculatedAt: new Date(String(row.calculated_at)).toISOString(),
    ...(row.reconciled_at
      ? { reconciledAt: new Date(String(row.reconciled_at)).toISOString() }
      : {}),
    semanticHash: row.semantic_hash,
  });
}

async function appendCorrectionEvent(
  manager: EntityManager,
  input: Readonly<{
    workspaceId: string;
    projectId: string;
    queueEntryId: string;
    revision: number;
    semanticHash: string;
    document: Readonly<Record<string, unknown>>;
    activatedAt: string;
    previous?: Readonly<{
      revisionId: string;
      revision: number;
      semanticHash: string;
      stage: QueueStage;
    }>;
  }>,
): Promise<void> {
  const eventId = deterministicUuid(
    `queue-rebuild-correction:${input.queueEntryId}:${input.revision}:${input.semanticHash}`,
  );
  const envelope = Object.freeze({
    envelopeVersion: 1,
    eventId,
    eventType: "queue.projection.updated",
    occurredAt: String(input.document.calculatedAt),
    recordedAt: input.activatedAt,
    producer: "worker.queue-rebuild",
    producerVersion: "1.0.0",
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    entityType: "queue-entry",
    entityId: input.queueEntryId,
    entityVersion: input.revision,
    correlationId: deterministicUuid(
      `queue-rebuild-correlation:${input.workspaceId}:${input.activatedAt}`,
    ),
    causationId: deterministicUuid(
      `queue-rebuild-causation:${input.workspaceId}:${input.semanticHash}`,
    ),
    actor: Object.freeze({
      kind: "SERVICE",
      principalId: deterministicUuid("worker.queue-rebuild"),
      serviceKey: "worker.queue-rebuild",
    }),
    dataClassificationKey: "INTERNAL",
    payloadVersion: 1,
    payloadSchemaRef: Object.freeze({
      id: "urn:awp:schemas:006:queue-entry:v1",
      version: 1,
      digest: sha256(input.document as JsonValue),
    }),
    payload: input.document,
  });
  await manager.query(
    "INSERT INTO event_outbox(id,workspace_id,project_id,event_type,envelope,envelope_hash,state,created_at) VALUES($1,$2,$3,'queue.projection.updated',$4,$5,'READY',$6) ON CONFLICT(id) DO NOTHING",
    [
      eventId,
      input.workspaceId,
      input.projectId,
      JSON.stringify(envelope),
      sha256(envelope as unknown as JsonValue),
      input.activatedAt,
    ],
  );
  if (input.previous && input.previous.stage !== input.document.stage) {
    const transitionId = deterministicUuid(
      `queue-rebuild-stage:${input.previous.revisionId}:${input.document.queueEntryId}:${input.revision}`,
    );
    const payload = createQueueStageTransition({
      transitionId,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      previousQueueEntryRef: {
        schemaVersion: "queue-entry@1.0.0",
        queueEntryId: input.queueEntryId,
        revision: input.previous.revision,
        semanticHash: input.previous.semanticHash as `sha256:${string}`,
      },
      currentQueueEntryRef: {
        schemaVersion: "queue-entry@1.0.0",
        queueEntryId: input.queueEntryId,
        revision: input.revision,
        semanticHash: input.semanticHash as `sha256:${string}`,
      },
      previousStage: input.previous.stage,
      currentStage: input.document.stage as QueueStage,
      reasonCodes: input.document.stageReasonCodes as readonly string[],
      occurredAt: input.activatedAt,
    });
    const stageEventId = deterministicUuid(`queue-rebuild-stage-event:${transitionId}`);
    const stageEnvelope = Object.freeze({
      ...envelope,
      eventId: stageEventId,
      eventType: "queue.stage.changed",
      occurredAt: input.activatedAt,
      recordedAt: input.activatedAt,
      entityType: "queue-stage-transition",
      entityId: transitionId,
      entityVersion: 1,
      payloadSchemaRef: Object.freeze({
        id: "urn:awp:schemas:006:queue-stage-transition:v1",
        version: 1,
        digest: sha256(payload as unknown as JsonValue),
      }),
      payload,
    });
    await manager.query(
      "INSERT INTO event_outbox(id,workspace_id,project_id,event_type,envelope,envelope_hash,state,created_at) VALUES($1,$2,$3,'queue.stage.changed',$4,$5,'READY',$6) ON CONFLICT(id) DO NOTHING",
      [
        stageEventId,
        input.workspaceId,
        input.projectId,
        JSON.stringify(stageEnvelope),
        sha256(stageEnvelope as unknown as JsonValue),
        input.activatedAt,
      ],
    );
  }
}

export class PostgresQueueProjectionRebuildStore implements QueueProjectionRebuildStore {
  constructor(private readonly source: DataSource) {}

  async begin(workspaceId: string): Promise<
    Readonly<{
      generationId: string;
      highWatermarks: Readonly<Record<string, string>>;
      cursor?: string;
      projectedCount?: number;
    }>
  > {
    return await this.source.transaction("REPEATABLE READ", async (manager) => {
      const existing = resultRows(
        await manager.query(
          "SELECT * FROM queue_projection_generations WHERE workspace_id=$1 AND state IN('BUILDING','VALIDATING') ORDER BY started_at LIMIT 1 FOR UPDATE",
          [workspaceId],
        ),
      )[0];
      if (existing) {
        const watermarks = parse<Record<string, string>>(existing.source_high_watermarks);
        return Object.freeze({
          generationId: String(existing.generation_id),
          highWatermarks: Object.freeze({ ...watermarks }),
          ...(watermarks.buildCursor ? { cursor: watermarks.buildCursor } : {}),
          projectedCount: Number(existing.subject_count),
        });
      }
      const watermarkRows = resultRows(
        await manager.query(
          `SELECT COALESCE(max(created_at),'-infinity'::timestamptz) AS event_at,
                COALESCE(max(id::text),'') AS event_id FROM event_outbox WHERE workspace_id=$1`,
          [workspaceId],
        ),
      );
      const eventAt = new Date(String(watermarkRows[0]?.event_at ?? new Date(0))).toISOString();
      const startedAt = new Date().toISOString();
      const highWatermarks = Object.freeze({
        eventOutboxAt: eventAt,
        eventOutboxId: String(watermarkRows[0]?.event_id ?? ""),
        snapshotAt: startedAt,
      });
      const generationId = deterministicUuid(`queue-shadow-generation:${workspaceId}:${startedAt}`);
      await manager.query(
        `INSERT INTO queue_projection_generations(generation_id,workspace_id,state,source_high_watermarks,input_set_hash,subject_count,stage_counts,started_at)
         VALUES($1,$2,'BUILDING',$3,$4,0,'{}'::jsonb,$5)`,
        [
          generationId,
          workspaceId,
          JSON.stringify(highWatermarks),
          sha256(highWatermarks as JsonValue),
          startedAt,
        ],
      );
      return Object.freeze({ generationId, highWatermarks });
    });
  }

  async page(
    workspaceId: string,
    generationId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<
    Readonly<{ subjects: readonly QueueProjectionRebuildSubject[]; nextCursor?: string }>
  > {
    const [afterProjectId, afterSubjectId] = parseCursor(cursor);
    const pageRows = resultRows(
      await this.source.query(
        `WITH subjects AS (
         SELECT workspace_id,project_id,id AS subject_id FROM work_items WHERE workspace_id=$1
         UNION ALL
         SELECT workspace_id,project_id,id FROM intake_candidates
          WHERE workspace_id=$1 AND state IN('PENDING_CONFIRMATION','SNOOZED')
            AND expires_at>(SELECT started_at FROM queue_projection_generations WHERE workspace_id=$1 AND generation_id=$5)
         UNION ALL
         SELECT workspace_id,project_id,id FROM intake_drafts
          WHERE workspace_id=$1 AND linked_work_item_id IS NULL AND conversation_state NOT IN('CANCELLED','LINKED')
       ) SELECT workspace_id,project_id,subject_id FROM subjects
        WHERE (project_id::text,subject_id::text)>($2,$3)
        ORDER BY project_id::text,subject_id::text LIMIT $4`,
        [workspaceId, afterProjectId, afterSubjectId, limit, generationId],
      ),
    );
    const subjects = Object.freeze(
      pageRows.map((row) =>
        Object.freeze({
          workspaceId: String(row.workspace_id),
          projectId: String(row.project_id),
          subjectId: String(row.subject_id),
        }),
      ),
    );
    const last = subjects.at(-1);
    return Object.freeze({
      subjects,
      ...(last ? { nextCursor: cursorValue(last.projectId, last.subjectId) } : {}),
    });
  }

  async checkpoint(generationId: string, cursor: string, projectedCount: number): Promise<void> {
    const updated = resultRows(
      await this.source.query(
        `UPDATE queue_projection_generations
          SET source_high_watermarks=jsonb_set(source_high_watermarks,'{buildCursor}',to_jsonb($2::text),true),subject_count=$3
        WHERE generation_id=$1 AND state='BUILDING' RETURNING generation_id`,
        [generationId, cursor, projectedCount],
      ),
    );
    if (updated.length !== 1) throw new Error("QUEUE_REBUILD_CHECKPOINT_CONFLICT");
  }

  async catchUp(
    workspaceId: string,
    highWatermarks: Readonly<Record<string, string>>,
  ): Promise<readonly QueueProjectionRebuildSubject[]> {
    const catchUpRows = resultRows(
      await this.source.query(
        `SELECT DISTINCT outbox.workspace_id,outbox.project_id,
              COALESCE(outbox.envelope->>'entityId',outbox.envelope->'payload'->>'workItemId') AS subject_id
         FROM event_outbox outbox
        WHERE outbox.workspace_id=$1 AND outbox.created_at>$2
          AND outbox.event_type=ANY($3::text[])
          AND COALESCE(outbox.envelope->>'entityId',outbox.envelope->'payload'->>'workItemId') IS NOT NULL
        ORDER BY outbox.project_id,subject_id`,
        [workspaceId, highWatermarks.eventOutboxAt, queueProjectionSourceEventTypes],
      ),
    );
    return Object.freeze(
      catchUpRows.map((row) =>
        Object.freeze({
          workspaceId: String(row.workspace_id),
          projectId: String(row.project_id),
          subjectId: String(row.subject_id),
        }),
      ),
    );
  }

  async validate(
    workspaceId: string,
    generationId: string,
  ): Promise<QueueProjectionRebuildValidation> {
    const revisionRows = resultRows(
      await this.source.query(
        `SELECT DISTINCT ON(queue_entry_id) * FROM queue_entry_revisions
        WHERE workspace_id=$1 AND generation_id=$2
        ORDER BY queue_entry_id,revision_number DESC`,
        [workspaceId, generationId],
      ),
    );
    const sourceCount = Number(
      resultRows(
        await this.source.query(
          `SELECT (SELECT count(*) FROM work_items WHERE workspace_id=$1)
            +(SELECT count(*) FROM intake_candidates WHERE workspace_id=$1 AND state IN('PENDING_CONFIRMATION','SNOOZED') AND expires_at>(SELECT started_at FROM queue_projection_generations WHERE workspace_id=$1 AND generation_id=$2))
            +(SELECT count(*) FROM intake_drafts WHERE workspace_id=$1 AND linked_work_item_id IS NULL AND conversation_state NOT IN('CANCELLED','LINKED')) AS count`,
          [workspaceId, generationId],
        ),
      )[0]?.count ?? 0,
    );
    const identities = new Set<string>();
    const stageCounts: Record<string, number> = {};
    let failureCode: string | undefined;
    for (const row of revisionRows) {
      const identity = `${row.workspace_id}\0${row.project_id}\0${row.queue_entry_id}`;
      if (String(row.workspace_id) !== workspaceId) failureCode = "QUEUE_REBUILD_SCOPE_MISMATCH";
      if (identities.has(identity)) failureCode = "QUEUE_REBUILD_SUBJECT_DUPLICATE";
      identities.add(identity);
      if (
        ![row.semantic_hash, row.source_set_hash, row.input_fingerprint].every((value) =>
          /^sha256:[a-f0-9]{64}$/u.test(String(value)),
        )
      )
        failureCode = "QUEUE_REBUILD_HASH_INVALID";
      const stage = String(row.stage);
      stageCounts[stage] = (stageCounts[stage] ?? 0) + 1;
    }
    if (revisionRows.length !== sourceCount) failureCode = "QUEUE_REBUILD_SUBJECT_COUNT_MISMATCH";
    const outputSetHash = sha256(
      revisionRows.map((row) => [
        row.project_id,
        row.queue_entry_id,
        row.revision_number,
        row.semantic_hash,
      ]) as JsonValue,
    );
    const validation = Object.freeze({
      valid: failureCode === undefined,
      subjectCount: revisionRows.length,
      stageCounts: Object.freeze(stageCounts),
      outputSetHash,
      ...(failureCode ? { failureCode } : {}),
    });
    await this.source.query(
      `UPDATE queue_projection_generations SET state='VALIDATING',output_set_hash=$3,subject_count=$4,stage_counts=$5,validated_at=clock_timestamp(),failure_code=$6
        WHERE workspace_id=$1 AND generation_id=$2 AND state IN('BUILDING','VALIDATING')`,
      [
        workspaceId,
        generationId,
        outputSetHash,
        revisionRows.length,
        JSON.stringify(stageCounts),
        failureCode ?? null,
      ],
    );
    return validation;
  }

  async activate(
    workspaceId: string,
    generationId: string,
    validation: QueueProjectionRebuildValidation,
  ): Promise<Readonly<{ corrections: number }>> {
    if (!validation.valid) throw new Error("QUEUE_REBUILD_VALIDATION_REQUIRED");
    return await this.source.transaction("SERIALIZABLE", async (manager) => {
      const generation = resultRows(
        await manager.query(
          "SELECT state FROM queue_projection_generations WHERE workspace_id=$1 AND generation_id=$2 FOR UPDATE",
          [workspaceId, generationId],
        ),
      )[0];
      if (generation?.state !== "VALIDATING")
        throw new Error("QUEUE_REBUILD_ACTIVATION_STATE_INVALID");
      await manager.query(
        "SELECT queue_entry_id FROM queue_entry_heads WHERE workspace_id=$1 FOR UPDATE",
        [workspaceId],
      );
      const shadow = resultRows(
        await manager.query(
          `SELECT DISTINCT ON(revision.queue_entry_id) revision.*,
                head.current_revision_id AS old_revision_id,old.revision_number AS old_revision_number,old.semantic_hash AS old_semantic_hash,old.stage AS old_stage
           FROM queue_entry_revisions revision
           JOIN queue_entry_heads head ON head.workspace_id=revision.workspace_id AND head.project_id=revision.project_id AND head.queue_entry_id=revision.queue_entry_id
           LEFT JOIN queue_entry_revisions old ON old.queue_entry_revision_id=head.current_revision_id
          WHERE revision.workspace_id=$1 AND revision.generation_id=$2
          ORDER BY revision.queue_entry_id,revision.revision_number DESC`,
          [workspaceId, generationId],
        ),
      );
      if (shadow.length !== validation.subjectCount)
        throw new Error("QUEUE_REBUILD_ACTIVATION_COUNT_MISMATCH");
      const activatedAt = new Date().toISOString();
      await manager.query(
        "UPDATE queue_projection_generations SET state='SUPERSEDED' WHERE workspace_id=$1 AND state='ACTIVE'",
        [workspaceId],
      );
      await manager.query(
        "UPDATE queue_projection_generations SET state='ACTIVE',activated_at=$3,failure_code=NULL WHERE workspace_id=$1 AND generation_id=$2 AND state='VALIDATING'",
        [workspaceId, generationId, activatedAt],
      );
      let corrections = 0;
      for (const row of shadow) {
        if (String(row.old_semantic_hash ?? "") === String(row.semantic_hash)) continue;
        const updated = resultRows(
          await manager.query(
            `UPDATE queue_entry_heads SET current_revision_id=$4,resource_version=resource_version+1,updated_at=$5
            WHERE workspace_id=$1 AND project_id=$2 AND queue_entry_id=$3 RETURNING queue_entry_id`,
            [
              workspaceId,
              row.project_id,
              row.queue_entry_id,
              row.queue_entry_revision_id,
              activatedAt,
            ],
          ),
        );
        if (updated.length !== 1) throw new Error("QUEUE_REBUILD_HEAD_ACTIVATION_CONFLICT");
        corrections += 1;
        await appendCorrectionEvent(manager, {
          workspaceId,
          projectId: String(row.project_id),
          queueEntryId: String(row.queue_entry_id),
          revision: Number(row.revision_number),
          semanticHash: String(row.semantic_hash),
          document: revisionDocument(row),
          activatedAt,
          ...(row.old_revision_id
            ? {
                previous: {
                  revisionId: String(row.old_revision_id),
                  revision: Number(row.old_revision_number),
                  semanticHash: String(row.old_semantic_hash),
                  stage: String(row.old_stage) as QueueStage,
                },
              }
            : {}),
        });
      }
      return Object.freeze({ corrections });
    });
  }

  async fail(generationId: string, failureCode: string): Promise<void> {
    await this.source.query(
      "UPDATE queue_projection_generations SET state='FAILED',failed_at=clock_timestamp(),failure_code=$2 WHERE generation_id=$1 AND state IN('BUILDING','VALIDATING')",
      [generationId, failureCode],
    );
  }
}
