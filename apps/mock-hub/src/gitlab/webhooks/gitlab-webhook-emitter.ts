import { createHash, createHmac, randomUUID } from "node:crypto";

import type { DataSource } from "typeorm";

import { type GitLabMockFault, TypeOrmGitLabRepository } from "../state/gitlab.repository.ts";

export type GitLabMockWebhookEventKind = "PIPELINE_HOOK" | "JOB_HOOK";

export interface GitLabMockWebhookEmissionInput {
  readonly projectId: number;
  readonly eventKind?: GitLabMockWebhookEventKind;
  readonly pipelineId?: number;
  readonly jobId?: number;
  readonly deliveryId?: string;
  readonly emittedAt?: string;
}

export interface GitLabMockWebhookPacket {
  readonly deliveryId: string;
  readonly eventKind: GitLabMockWebhookEventKind;
  readonly rawBody: Uint8Array;
  readonly contentType: "application/json";
  readonly headers: Readonly<{
    webhookId: string;
    webhookTimestamp: string;
    webhookSignature: string;
  }>;
  readonly deliveryAttempt: number;
  readonly duplicate: boolean;
}

export interface GitLabMockWebhookEmissionResult {
  readonly fault: Extract<
    GitLabMockFault,
    "NORMAL" | "WEBHOOK_DROP" | "WEBHOOK_DUPLICATE" | "WEBHOOK_OUT_OF_ORDER"
  >;
  readonly queued: number;
  readonly deliveryIds: readonly string[];
}

const signingSecret = "mock-gitlab-webhook";
const signingKeyVersionRef = "key-version:gitlab-webhook:project-5001:v1";

function records(value: unknown): readonly Readonly<Record<string, unknown>>[] {
  return Array.isArray(value)
    ? value.filter(
        (row): row is Readonly<Record<string, unknown>> =>
          row !== null && typeof row === "object" && !Array.isArray(row),
      )
    : [];
}

function bodyHash(body: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(body).digest("hex")}`;
}

function validDate(value: string | undefined, fallback: string): string {
  const candidate = value ?? fallback;
  if (!Number.isFinite(Date.parse(candidate)))
    throw new Error("GITLAB_MOCK_WEBHOOK_TIMESTAMP_INVALID");
  return new Date(candidate).toISOString();
}

function unixSeconds(value: string): string {
  return String(Math.floor(Date.parse(value) / 1_000));
}

function signature(deliveryId: string, timestamp: string, body: Uint8Array): string {
  const message = Buffer.concat([Buffer.from(`${deliveryId}.${timestamp}.`), Buffer.from(body)]);
  return `v1,${createHmac("sha256", signingSecret).update(message).digest("base64")}`;
}

export class GitLabWebhookEmitter {
  readonly #repository: TypeOrmGitLabRepository;

  constructor(private readonly source: DataSource) {
    this.#repository = new TypeOrmGitLabRepository(source);
  }

  async emit(input: GitLabMockWebhookEmissionInput): Promise<GitLabMockWebhookEmissionResult> {
    const selected = await this.#select(input);
    const baseDeliveryId =
      input.deliveryId ?? `mock-gitlab-${input.projectId}-${selected.pipelineId}-${randomUUID()}`;
    if (baseDeliveryId.length > 110) throw new Error("GITLAB_MOCK_WEBHOOK_DELIVERY_ID_INVALID");
    const fault = await this.#repository.consumeWebhookDeliveryFault(
      input.projectId,
      baseDeliveryId,
    );

    if (fault === "WEBHOOK_OUT_OF_ORDER") {
      const emittedAt = validDate(input.emittedAt, selected.providerUpdatedAt);
      const newer = await this.#materialize({
        ...selected,
        eventKind: selected.jobId === undefined ? "PIPELINE_HOOK" : "JOB_HOOK",
        deliveryId: `${baseDeliveryId}-01-newer`,
        emittedAt,
      });
      const olderAt = new Date(Date.parse(selected.providerUpdatedAt) - 60_000).toISOString();
      const older = await this.#materialize({
        ...selected,
        eventKind: "PIPELINE_HOOK",
        status: ["success", "failed", "canceled"].includes(selected.status) ? "running" : "pending",
        providerUpdatedAt: olderAt,
        deliveryId: `${baseDeliveryId}-02-older`,
        emittedAt,
      });
      await this.#insert(newer, "PENDING");
      await this.#insert(older, "PENDING");
      return Object.freeze({
        fault,
        queued: 2,
        deliveryIds: Object.freeze([newer.deliveryId, older.deliveryId]),
      });
    }

    const delivery = await this.#materialize({
      ...selected,
      eventKind: input.eventKind ?? "PIPELINE_HOOK",
      deliveryId: baseDeliveryId,
      emittedAt: validDate(input.emittedAt, selected.providerUpdatedAt),
    });
    const state =
      fault === "WEBHOOK_DROP"
        ? "DROPPED"
        : fault === "WEBHOOK_DUPLICATE"
          ? "DUPLICATE"
          : "PENDING";
    await this.#insert(delivery, state);
    return Object.freeze({
      fault,
      queued: state === "DROPPED" ? 0 : 1,
      deliveryIds: Object.freeze([delivery.deliveryId]),
    });
  }

  async next(projectId: number): Promise<GitLabMockWebhookPacket | undefined> {
    const rows = records(
      await this.source.query(
        `
WITH candidate AS (
  SELECT delivery_id,state,delivery_attempt
  FROM mock_gitlab_webhook_deliveries
  WHERE project_id=$1 AND (state='PENDING' OR (state='DUPLICATE' AND delivery_attempt<2))
  ORDER BY created_at,delivery_id
  FOR UPDATE SKIP LOCKED LIMIT 1
), claimed AS (
  UPDATE mock_gitlab_webhook_deliveries target
  SET delivery_attempt=candidate.delivery_attempt+1,
      state=CASE
        WHEN candidate.state='DUPLICATE' AND candidate.delivery_attempt=0 THEN 'DUPLICATE'
        ELSE 'DELIVERED'
      END,
      updated_at=clock_timestamp()
  FROM candidate WHERE target.delivery_id=candidate.delivery_id
  RETURNING target.*,(candidate.state='DUPLICATE' AND candidate.delivery_attempt>0) AS duplicate_delivery
)
SELECT * FROM claimed`,
        [projectId],
      ),
    );
    const row = rows[0];
    if (!row) return undefined;
    const rawBody = Buffer.isBuffer(row.body_bytes)
      ? new Uint8Array(row.body_bytes)
      : new Uint8Array(row.body_bytes as Uint8Array);
    const deliveryId = String(row.delivery_id);
    const timestamp = unixSeconds(new Date(String(row.delivery_timestamp)).toISOString());
    return Object.freeze({
      deliveryId,
      eventKind: String(row.event_kind) as GitLabMockWebhookEventKind,
      rawBody,
      contentType: "application/json",
      headers: Object.freeze({
        webhookId: deliveryId,
        webhookTimestamp: timestamp,
        webhookSignature: String(row.signature),
      }),
      deliveryAttempt: Number(row.delivery_attempt),
      duplicate: row.duplicate_delivery === true,
    });
  }

  async pending(projectId: number): Promise<readonly Readonly<Record<string, unknown>>[]> {
    const rows = (await this.source.query(
      "SELECT * FROM mock_gitlab_webhook_deliveries WHERE project_id=$1 AND state IN ('PENDING','DUPLICATE') ORDER BY created_at,delivery_id",
      [projectId],
    )) as readonly Readonly<Record<string, unknown>>[];
    return Object.freeze(
      rows.map((row) =>
        Object.freeze({ ...row, body_bytes: "[RAW_BYTES]", signature: "[REDACTED]" }),
      ),
    );
  }

  async #select(input: GitLabMockWebhookEmissionInput): Promise<
    Readonly<{
      projectId: number;
      pipelineId: number;
      jobId?: number;
      status: string;
      commitSha: string;
      providerUpdatedAt: string;
    }>
  > {
    const pipelineRows = records(
      await this.source.query(
        `
SELECT project_id,pipeline_id,status,commit_sha,updated_at
FROM mock_gitlab_pipelines
WHERE project_id=$1 AND ($2::bigint IS NULL OR pipeline_id=$2)
ORDER BY pipeline_id DESC LIMIT 1`,
        [input.projectId, input.pipelineId ?? null],
      ),
    );
    const pipeline = pipelineRows[0];
    if (!pipeline) throw new Error("GITLAB_MOCK_PIPELINE_NOT_FOUND");
    let jobId = input.jobId;
    if (jobId === undefined) {
      const jobs = records(
        await this.source.query(
          "SELECT job_id FROM mock_gitlab_jobs WHERE project_id=$1 AND pipeline_id=$2 ORDER BY job_id DESC LIMIT 1",
          [input.projectId, Number(pipeline.pipeline_id)],
        ),
      );
      if (jobs[0]) jobId = Number(jobs[0].job_id);
    }
    return Object.freeze({
      projectId: input.projectId,
      pipelineId: Number(pipeline.pipeline_id),
      ...(jobId === undefined ? {} : { jobId }),
      status: String(pipeline.status),
      commitSha: String(pipeline.commit_sha),
      providerUpdatedAt: new Date(String(pipeline.updated_at)).toISOString(),
    });
  }

  async #materialize(
    input: Readonly<{
      projectId: number;
      pipelineId: number;
      jobId?: number;
      status: string;
      commitSha: string;
      providerUpdatedAt: string;
      eventKind: GitLabMockWebhookEventKind;
      deliveryId: string;
      emittedAt: string;
    }>,
  ): Promise<
    Readonly<{
      deliveryId: string;
      projectId: number;
      eventKind: GitLabMockWebhookEventKind;
      body: Uint8Array;
      hash: string;
      signature: string;
      emittedAt: string;
    }>
  > {
    let payload: Readonly<Record<string, unknown>>;
    if (input.eventKind === "JOB_HOOK") {
      if (input.jobId === undefined) throw new Error("GITLAB_MOCK_WEBHOOK_JOB_REQUIRED");
      const rows = records(
        await this.source.query(
          "SELECT status,started_at,finished_at FROM mock_gitlab_jobs WHERE project_id=$1 AND pipeline_id=$2 AND job_id=$3",
          [input.projectId, input.pipelineId, input.jobId],
        ),
      );
      const job = rows[0];
      if (!job) throw new Error("GITLAB_MOCK_JOB_NOT_FOUND");
      payload = Object.freeze({
        object_kind: "build",
        project_id: input.projectId,
        pipeline_id: input.pipelineId,
        build_id: input.jobId,
        build_status: String(job.status),
        build_started_at:
          job.started_at === null ? null : new Date(String(job.started_at)).toISOString(),
        build_finished_at:
          job.finished_at === null ? null : new Date(String(job.finished_at)).toISOString(),
        commit: Object.freeze({ sha: input.commitSha }),
      });
    } else {
      payload = Object.freeze({
        object_kind: "pipeline",
        project: Object.freeze({ id: input.projectId }),
        object_attributes: Object.freeze({
          id: input.pipelineId,
          status: input.status,
          sha: input.commitSha,
          updated_at: input.providerUpdatedAt,
        }),
      });
    }
    const body = new TextEncoder().encode(JSON.stringify(payload));
    const timestamp = unixSeconds(input.emittedAt);
    return Object.freeze({
      deliveryId: input.deliveryId,
      projectId: input.projectId,
      eventKind: input.eventKind,
      body,
      hash: bodyHash(body),
      signature: signature(input.deliveryId, timestamp, body),
      emittedAt: input.emittedAt,
    });
  }

  async #insert(
    delivery: Readonly<{
      deliveryId: string;
      projectId: number;
      eventKind: GitLabMockWebhookEventKind;
      body: Uint8Array;
      hash: string;
      signature: string;
      emittedAt: string;
    }>,
    state: "PENDING" | "DROPPED" | "DUPLICATE",
  ): Promise<void> {
    await this.source.query(
      `
INSERT INTO mock_gitlab_webhook_deliveries(
  delivery_id,project_id,event_kind,body_bytes,body_hash,signature,key_version_ref,delivery_timestamp,delivery_attempt,state
) VALUES($1,$2,$3,$4,$5,$6,$7,$8,0,$9)`,
      [
        delivery.deliveryId,
        delivery.projectId,
        delivery.eventKind,
        Buffer.from(delivery.body),
        delivery.hash,
        delivery.signature,
        signingKeyVersionRef,
        delivery.emittedAt,
        state,
      ],
    );
  }
}
