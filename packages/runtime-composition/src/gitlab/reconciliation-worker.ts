import { createHash, randomUUID } from "node:crypto";

import type { DataSource, EntityManager } from "typeorm";

import {
  createGitLabDialect,
  createGitLabRestPipelineReadTransport,
  GitLabAuth,
  type GitLabConnectionConfiguration,
  GitLabPipelineReader,
  type GitLabProfileConfiguration,
  GitLabRestClient,
  GitLabTransportError,
  GitLabWebhookVerificationError,
  preflightGitLabProfile,
  validateGitLabConnectionConfiguration,
  verifyAndNormalizeGitLabWebhook,
} from "@awp/connector-gitlab";
import {
  type GitLabAuthorityScope,
  type GitLabPipelineObservationInput,
  TypeOrmGitLabReconciliationRepository,
} from "@awp/connector-gitlab-persistence-typeorm";
import type { PipelineReadRequest, TrustedConnectorOperationContext } from "@awp/connector-sdk";
import type { Sha256Digest } from "@awp/platform-contracts";

import { isGitLabLocalComposition, type RuntimeEnvironment } from "../config/environment.ts";
import { classifyPilotFailure, decidePilotRetry } from "../pilot/retry-policy.ts";
import {
  type GitLabAutomationObservability,
  recordGitLabAutomationPhase,
} from "./observability.ts";

export function gitLabWebhookVerificationErrorCode(error: unknown): string | undefined {
  return error instanceof GitLabWebhookVerificationError ? error.code : undefined;
}

function json<T>(value: unknown): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

function queryRows<T>(value: unknown): readonly T[] {
  const raw = value as readonly unknown[];
  return (Array.isArray(raw[0]) ? raw[0] : raw) as readonly T[];
}

function digest(value: unknown): Sha256Digest {
  return `sha256:${createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex")}`;
}

function deterministicUuid(namespace: string): string {
  const hex = createHash("sha256").update(namespace).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}

function trustedPins(
  value: readonly Readonly<Record<string, unknown>>[],
): TrustedConnectorOperationContext["configurationPins"] {
  return Object.freeze(
    value.map((raw) => {
      const pin = raw as Readonly<{
        logicalRole: string;
        capabilityKey: string;
        exactContractVersion: string;
        projectIntegrationBindingRef: TrustedConnectorOperationContext["configurationPins"][number]["bindingRef"];
        profileRef: TrustedConnectorOperationContext["configurationPins"][number]["profileRef"];
        connectionRef: TrustedConnectorOperationContext["configurationPins"][number]["connectionRef"];
        validationReportRef: TrustedConnectorOperationContext["configurationPins"][number]["validationReportRef"];
        operationSetHash: TrustedConnectorOperationContext["configurationPins"][number]["operationSetHash"];
      }>;
      return Object.freeze({
        logicalRole: pin.logicalRole,
        capabilityKey: pin.capabilityKey,
        exactContractVersion: pin.exactContractVersion,
        bindingRef: pin.projectIntegrationBindingRef,
        profileRef: pin.profileRef,
        connectionRef: pin.connectionRef,
        validationReportRef: pin.validationReportRef,
        operationSetHash: pin.operationSetHash,
      });
    }),
  );
}

export interface GitLabWebhookIngressAuthority {
  readonly scope: GitLabAuthorityScope & Readonly<{ projectId: string }>;
  readonly connectionRef: Readonly<{ id: string; version: number; contentHash: string }>;
  readonly profileRef: Readonly<{ id: string; version: number; contentHash: string }>;
  readonly connection: GitLabConnectionConfiguration;
  readonly profile: GitLabProfileConfiguration;
  readonly secretRef: string;
  readonly secretFingerprint: `sha256:${string}`;
  readonly webhookKeyVersionRef: string;
}

export interface GitLabWebhookKeyResolver {
  resolve(secretRef: string, allowedUseHash: `sha256:${string}`): Promise<Uint8Array>;
}

export interface GitLabWebhookIngressInput {
  readonly connectionId: string;
  readonly rawBody: Uint8Array;
  readonly contentType: string;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly receivedAt: Date;
}

export interface GitLabWebhookIngressResult {
  readonly status: "ACCEPTED" | "DUPLICATE" | "SECURITY_CONFLICT";
  readonly receiptId: string;
}

export class TypeOrmGitLabWebhookAuthorityLoader {
  constructor(private readonly source: DataSource) {}

  async resolve(connectionId: string): Promise<GitLabWebhookIngressAuthority> {
    const rows = (await this.source.query(
      `
SELECT connection.workspace_id,connection.version AS connection_version,connection.content_hash AS connection_hash,
       connection.content AS connection_content,binding.project_id,binding.content AS binding_content
FROM connection_revisions connection
JOIN connection_headers header ON header.id=connection.header_id AND header.workspace_id=connection.workspace_id
JOIN project_integration_binding_revisions binding ON binding.workspace_id=connection.workspace_id AND binding.status='PUBLISHED'
WHERE connection.header_id=$1 AND connection.status='PUBLISHED' AND connection.version=header.current_published_version`,
      [connectionId],
    )) as readonly Readonly<Record<string, unknown>>[];
    const candidates = rows.flatMap((row) => {
      const binding = json<
        Readonly<{
          numericGitLabProjectId?: number;
          entries?: readonly Readonly<{
            connectionRef?: Readonly<{ id: string; version: number; contentHash: string }>;
            profileRef?: Readonly<{ id: string; version: number; contentHash: string }>;
          }>[];
        }>
      >(row.binding_content);
      const entries =
        binding.entries?.filter(
          ({ connectionRef }) =>
            connectionRef?.id === connectionId &&
            connectionRef.version === Number(row.connection_version) &&
            connectionRef.contentHash === String(row.connection_hash),
        ) ?? [];
      const profileRefs = new Map(
        entries.flatMap(({ profileRef }) =>
          profileRef === undefined
            ? []
            : [[`${profileRef.id}:${profileRef.version}:${profileRef.contentHash}`, profileRef]],
        ),
      );
      const profileRef = [...profileRefs.values()][0];
      return profileRefs.size === 1 &&
        profileRef !== undefined &&
        Number.isSafeInteger(binding.numericGitLabProjectId)
        ? [{ row, numericProjectId: Number(binding.numericGitLabProjectId), profileRef }]
        : [];
    });
    if (candidates.length !== 1) throw new Error("GITLAB_WEBHOOK_CONNECTION_SCOPE_AMBIGUOUS");
    const candidate = candidates[0]!;
    const profiles = (await this.source.query(
      `
SELECT content,content_hash FROM connector_profile_revisions
WHERE workspace_id=$1 AND header_id=$2 AND version=$3 AND content_hash=$4 AND status='PUBLISHED'`,
      [
        candidate.row.workspace_id,
        candidate.profileRef.id,
        candidate.profileRef.version,
        candidate.profileRef.contentHash,
      ],
    )) as readonly Readonly<Record<string, unknown>>[];
    if (profiles.length !== 1) throw new Error("GITLAB_WEBHOOK_PROFILE_NOT_FOUND");
    const connection = validateGitLabConnectionConfiguration(
      json(candidate.row.connection_content),
    );
    const preflight = preflightGitLabProfile(json(profiles[0]!.content), connection);
    if (preflight.status !== "SAFE_TO_DISCOVER" || preflight.profile === undefined)
      throw new Error("GITLAB_WEBHOOK_PROFILE_INVALID");
    const profile = preflight.profile;
    if (
      profile.numericGitLabProjectId !== candidate.numericProjectId ||
      connection.operationIdentityRouting.webhookVerify !== "WEBHOOK"
    ) {
      throw new Error("GITLAB_WEBHOOK_PROJECT_SCOPE_INVALID");
    }
    return Object.freeze({
      scope: Object.freeze({
        workspaceId: String(candidate.row.workspace_id),
        projectId: String(candidate.row.project_id),
        connectionHeaderId: connectionId,
        numericProjectId: candidate.numericProjectId,
      }),
      connectionRef: Object.freeze({
        id: connectionId,
        version: Number(candidate.row.connection_version),
        contentHash: String(candidate.row.connection_hash),
      }),
      profileRef: Object.freeze({
        id: candidate.profileRef.id,
        version: candidate.profileRef.version,
        contentHash: candidate.profileRef.contentHash,
      }),
      connection,
      profile,
      secretRef: connection.identityReferences.webhook.reference,
      secretFingerprint: connection.identityReferences.webhook.referenceFingerprint,
      webhookKeyVersionRef: connection.identityReferences.webhook.keyVersionRef,
    });
  }
}

export class TypeOrmGitLabWebhookIngressService {
  constructor(
    private readonly source: DataSource,
    private readonly authorities: TypeOrmGitLabWebhookAuthorityLoader,
    private readonly secrets: GitLabWebhookKeyResolver,
    private readonly observability?: GitLabAutomationObservability,
  ) {}

  async accept(input: GitLabWebhookIngressInput): Promise<GitLabWebhookIngressResult> {
    const authority = await this.authorities.resolve(input.connectionId);
    const secret = await this.secrets.resolve(authority.secretRef, authority.secretFingerprint);
    const repository = new TypeOrmGitLabReconciliationRepository(this.source);
    const deliveryId = input.headers["webhook-id"];
    const existing =
      deliveryId === undefined
        ? undefined
        : await repository.webhookReceipt(authority.scope, deliveryId);
    const verified = verifyAndNormalizeGitLabWebhook({
      rawBody: input.rawBody,
      contentType: input.contentType,
      headers: {
        ...(deliveryId === undefined ? {} : { webhookId: deliveryId }),
        ...(input.headers["webhook-timestamp"] === undefined
          ? {}
          : { webhookTimestamp: input.headers["webhook-timestamp"] }),
        ...(input.headers["webhook-signature"] === undefined
          ? {}
          : { webhookSignature: input.headers["webhook-signature"] }),
        ...(input.headers["x-gitlab-token"] === undefined
          ? {}
          : { legacyGitLabToken: input.headers["x-gitlab-token"] }),
      },
      secret,
      receivedAt: input.receivedAt.toISOString(),
      route: {
        connectionId: input.connectionId,
        workspaceId: authority.scope.workspaceId,
        projectId: authority.scope.projectId,
        numericProjectId: authority.scope.numericProjectId,
      },
      policy: {
        verificationMode: authority.profile.webhook.verificationMode,
        maxRawBytes: 1_048_576,
        freshnessSeconds: authority.profile.webhook.freshnessSeconds,
        dedupeHorizonSeconds: authority.profile.webhook.dedupeHorizonSeconds,
        eventKinds: authority.profile.webhook.eventKinds,
      },
      ...(existing === undefined
        ? {}
        : {
            existingDelivery: {
              bodyHash: String(existing.body_hash) as `sha256:${string}`,
              receivedAt: new Date(String(existing.received_at)).toISOString(),
            },
          }),
    });
    const receiptId = existing === undefined ? randomUUID() : String(existing.webhook_receipt_id);
    const result = await this.source.transaction(
      async (manager) => await this.#persist(manager, authority, input, verified, receiptId),
    );
    const duplicate = result.status === "DUPLICATE";
    recordGitLabAutomationPhase(this.observability, {
      phase: "WEBHOOK",
      outcome: duplicate ? "DUPLICATE" : result.status === "ACCEPTED" ? "VERIFIED" : "FAILED",
      ...(duplicate ? { reasonCode: "DUPLICATE_DELIVERY" } : {}),
    });
    if (duplicate)
      recordGitLabAutomationPhase(this.observability, {
        phase: "DEDUPE",
        outcome: "DUPLICATE",
        reasonCode: "DUPLICATE_DELIVERY",
      });
    if (this.observability !== undefined && (result.status === "ACCEPTED" || duplicate)) {
      this.observability.observeSlo(
        "WEBHOOK_VISIBILITY",
        Math.max(0, this.observability.now().getTime() - input.receivedAt.getTime()),
      );
    }
    return result;
  }

  async #persist(
    manager: EntityManager,
    authority: GitLabWebhookIngressAuthority,
    input: GitLabWebhookIngressInput,
    verified: ReturnType<typeof verifyAndNormalizeGitLabWebhook>,
    receiptId: string,
  ): Promise<GitLabWebhookIngressResult> {
    const repository = new TypeOrmGitLabReconciliationRepository(manager);
    if (verified.status === "ACCEPTED") {
      const coreRows = (await manager.query(
        `
WITH inserted AS (
  INSERT INTO webhook_receipts(
    connector_key,delivery_id,body_hash,received_at,raw_body,content_type,body_size,
    verification_result,secret_key_version,retention_until
  ) VALUES($1,$2,$3,$4,$5,$6,$7,'SIGNATURE_VERIFIED',$8,$9)
  ON CONFLICT(connector_key,delivery_id) DO NOTHING RETURNING body_hash,true AS inserted
)
SELECT * FROM inserted
UNION ALL SELECT body_hash,false AS inserted FROM webhook_receipts
WHERE connector_key=$1 AND delivery_id=$2 AND NOT EXISTS(SELECT 1 FROM inserted)
LIMIT 1`,
        [
          `gitlab:${authority.scope.connectionHeaderId}`,
          verified.deliveryId,
          verified.bodyHash,
          input.receivedAt,
          Buffer.from(input.rawBody),
          input.contentType,
          input.rawBody.byteLength,
          authority.webhookKeyVersionRef,
          new Date(
            input.receivedAt.getTime() + authority.profile.webhook.dedupeHorizonSeconds * 1_000,
          ),
        ],
      )) as readonly Readonly<{ body_hash: string; inserted: boolean }>[];
      const coreRow = coreRows[0];
      if (!coreRow || coreRow.body_hash !== verified.bodyHash)
        throw new Error("GITLAB_WEBHOOK_CORE_BODY_CONFLICT");
      if (!coreRow.inserted) return Object.freeze({ status: "DUPLICATE", receiptId });
    }
    const stored = await repository.recordWebhookReceipt({
      webhookReceiptId: receiptId,
      scope: authority.scope,
      coreInboxReceiptRef: {
        id: `gitlab:${authority.scope.connectionHeaderId}:${verified.deliveryId}`,
        version: 1,
        contentHash: verified.bodyHash,
      },
      connectionRef: authority.connectionRef,
      adapterFamily: "gitlab-rest-v4",
      adapterContractVersion: "1.0.0",
      webhookKeyVersionRef: authority.webhookKeyVersionRef,
      providerDeliveryId: verified.deliveryId,
      eventKind: verified.eventKind,
      signatureValid: verified.signatureValid,
      freshnessValid: verified.freshnessValid,
      replayValid: verified.replayValid,
      bodyHash: verified.bodyHash,
      ...(verified.conflictBodyHash === undefined
        ? {}
        : { conflictBodyHash: verified.conflictBodyHash }),
      ...(verified.normalizedSignalHash === undefined
        ? {}
        : { normalizedSignalHash: verified.normalizedSignalHash }),
      status: verified.status,
      ...(verified.reasonCode === undefined ? {} : { reasonCode: verified.reasonCode }),
      receivedAt: input.receivedAt.toISOString(),
    });
    if (verified.status === "ACCEPTED" && verified.normalized !== undefined) {
      const envelope = Object.freeze({
        schemaVersion: "gitlab-authoritative-read-request@1.0.0",
        receiptId,
        sourceKind: "WEBHOOK_HINT" as const,
        signal: verified.normalized,
        profileRef: authority.profileRef,
        connectionRef: authority.connectionRef,
      });
      const envelopeHash = `sha256:${createHash("sha256").update(JSON.stringify(envelope)).digest("hex")}`;
      await manager.query(
        `
INSERT INTO event_outbox(id,workspace_id,project_id,event_type,envelope,envelope_hash,state,created_at)
VALUES($1,$2,$3,'gitlab.authoritative-read.requested.v1',$4::jsonb,$5,'READY',$6)`,
        [
          randomUUID(),
          authority.scope.workspaceId,
          authority.scope.projectId,
          JSON.stringify(envelope),
          envelopeHash,
          input.receivedAt,
        ],
      );
    }
    return Object.freeze({
      status: String(stored.status) as GitLabWebhookIngressResult["status"],
      receiptId,
    });
  }
}

export interface GitLabAuthoritativeReadEnvelope {
  readonly schemaVersion: "gitlab-authoritative-read-request@1.0.0";
  readonly receiptId: string;
  readonly sourceKind?: "WEBHOOK_HINT" | "POLL_REPAIR";
  readonly automationAttemptId?: string;
  readonly reconciliationCursorRef?: Readonly<{ id: string; leaseToken: number }>;
  readonly signal: Readonly<{
    deliveryId: string;
    externalPipelineId: number;
    numericGitLabProjectId: number;
  }>;
  readonly profileRef: Readonly<{ id: string; version: number; contentHash: string }>;
  readonly connectionRef: Readonly<{ id: string; version: number; contentHash: string }>;
}

export interface GitLabAuthoritativeReadHandler {
  read(
    input: Readonly<{
      workspaceId: string;
      projectId: string;
      envelope: GitLabAuthoritativeReadEnvelope;
      observedAt: string;
    }>,
  ): Promise<GitLabPipelineObservationInput | undefined>;
}

export type GitLabAuthoritativeReadOutcome =
  "IDLE" | "IGNORED" | "BACKOFF" | "AUTH_DEGRADED" | "UNAVAILABLE" | "RECONCILED";

function readEnvelope(
  value: unknown,
  row: Readonly<{ workspace_id: string; project_id: string }>,
): GitLabAuthoritativeReadEnvelope {
  const envelope = json<GitLabAuthoritativeReadEnvelope>(value);
  if (
    envelope.schemaVersion !== "gitlab-authoritative-read-request@1.0.0" ||
    !envelope.receiptId ||
    !Number.isSafeInteger(envelope.signal?.externalPipelineId) ||
    envelope.signal.externalPipelineId < 1 ||
    !Number.isSafeInteger(envelope.signal.numericGitLabProjectId) ||
    envelope.signal.numericGitLabProjectId < 1 ||
    !envelope.connectionRef?.id ||
    !envelope.profileRef?.id ||
    row.workspace_id.length === 0 ||
    row.project_id.length === 0
  )
    throw new Error("GITLAB_AUTHORITATIVE_READ_ENVELOPE_INVALID");
  return Object.freeze(structuredClone(envelope));
}

export class TypeOrmGitLabAuthoritativeReadOutboxWorker {
  constructor(
    private readonly source: DataSource,
    private readonly handler: GitLabAuthoritativeReadHandler,
    private readonly clock: Readonly<{ now(): Date }> = Object.freeze({ now: () => new Date() }),
    private readonly observability?: GitLabAutomationObservability,
  ) {}

  async runOne(): Promise<GitLabAuthoritativeReadOutcome> {
    const outcome = await this.source.transaction("READ COMMITTED", async (manager) => {
      const rows = (await manager.query(`
SELECT id,workspace_id,project_id,envelope,created_at
FROM event_outbox
WHERE state='READY' AND event_type='gitlab.authoritative-read.requested.v1'
ORDER BY created_at,id
FOR UPDATE SKIP LOCKED LIMIT 1`)) as readonly Readonly<{
        id: string;
        workspace_id: string;
        project_id: string;
        envelope: unknown;
        created_at: Date | string;
      }>[];
      const row = rows[0];
      if (row === undefined) return "IDLE";
      const envelope = readEnvelope(row.envelope, row);
      const scope = Object.freeze({
        workspaceId: row.workspace_id,
        projectId: row.project_id,
        connectionHeaderId: envelope.connectionRef.id,
        numericProjectId: envelope.signal.numericGitLabProjectId,
      });
      const repository = new TypeOrmGitLabReconciliationRepository(manager);
      const now = this.clock.now();
      const attemptIds = Array.from({ length: 4 }, (_, index) =>
        deterministicUuid(`gitlab-read:${row.id}:attempt:${index + 1}`),
      );
      const attempts = (await manager.query(
        `SELECT next_eligible_at FROM gitlab_rate_limit_snapshots
WHERE workspace_id=$1 AND rate_limit_snapshot_id=ANY($2::uuid[]) ORDER BY observed_at DESC`,
        [scope.workspaceId, attemptIds],
      )) as readonly Readonly<{ next_eligible_at: Date | null }>[];
      const attempt = attempts.length + 1;
      if (
        attempts.length >= 4 ||
        (attempts.length > 0 && now.getTime() - new Date(row.created_at).getTime() >= 300_000)
      ) {
        await repository.appendRateLimitSnapshot({
          rateLimitSnapshotId: randomUUID(),
          scope,
          profileRef: envelope.profileRef,
          lane: "READ",
          decision: "UNAVAILABLE",
          errorCode: "RETRY_WINDOW_OR_BUDGET_EXHAUSTED",
          observedAt: now.toISOString(),
          contentHash: digest({ outboxId: row.id, attempt, stoppedAt: now.toISOString() }),
        });
        await manager.query(
          "UPDATE event_outbox SET state='FAILED' WHERE id=$1 AND state='READY'",
          [row.id],
        );
        return "UNAVAILABLE";
      }
      if (
        attempts[0]?.next_eligible_at &&
        new Date(attempts[0].next_eligible_at).getTime() > now.getTime()
      )
        return "BACKOFF";
      const currentRate = await repository.latestRateLimitSnapshot(scope, "READ");
      if (
        currentRate?.decision === "BACKOFF" &&
        currentRate.next_eligible_at !== null &&
        Date.parse(String(currentRate.next_eligible_at)) > now.getTime()
      )
        return "BACKOFF";
      try {
        const observation = await this.handler.read({
          workspaceId: row.workspace_id,
          projectId: row.project_id,
          envelope,
          observedAt: now.toISOString(),
        });
        if (observation === undefined) {
          const ignored = queryRows<Readonly<{ id: string }>>(
            await manager.query(
              "UPDATE event_outbox SET state='ACKNOWLEDGED' WHERE id=$1 AND state='READY' RETURNING id",
              [row.id],
            ),
          );
          if (ignored.length !== 1)
            throw new Error("GITLAB_AUTHORITATIVE_READ_OUTBOX_CAS_CONFLICT");
          return "IGNORED";
        }
        if (
          observation.scope.workspaceId !== row.workspace_id ||
          observation.scope.connectionHeaderId !== envelope.connectionRef.id ||
          observation.scope.numericProjectId !== envelope.signal.numericGitLabProjectId ||
          observation.externalPipelineId !== String(envelope.signal.externalPipelineId)
        ) {
          throw new Error("GITLAB_AUTHORITATIVE_READ_SCOPE_MISMATCH");
        }
        await repository.appendPipelineObservation(observation);
        await repository.appendRateLimitSnapshot({
          rateLimitSnapshotId: randomUUID(),
          scope,
          profileRef: envelope.profileRef,
          lane: "READ",
          httpStatus: 200,
          decision: "AVAILABLE",
          observedAt: now.toISOString(),
          contentHash: `sha256:${createHash("sha256").update(`${row.id}:available:${now.toISOString()}`).digest("hex")}`,
        });
        const acknowledged = queryRows<Readonly<{ id: string }>>(
          await manager.query(
            "UPDATE event_outbox SET state='ACKNOWLEDGED' WHERE id=$1 AND state='READY' RETURNING id",
            [row.id],
          ),
        );
        if (acknowledged.length !== 1)
          throw new Error("GITLAB_AUTHORITATIVE_READ_OUTBOX_CAS_CONFLICT");
        return "RECONCILED";
      } catch (error) {
        const transport = error instanceof GitLabTransportError ? error : undefined;
        const failure = classifyPilotFailure(error);
        // Attempt identities belong to this durable outbox item, not to unrelated reads
        // on the connection. Row locking keeps the count stable across concurrent workers.
        const retry = decidePilotRetry({
          operation: "READ",
          certainty: "NOT_DISPATCHED",
          failure,
          attempt,
          firstAttemptAt: new Date(row.created_at).toISOString(),
          now: now.toISOString(),
          policy: {
            maximumAttempts: 4,
            minimumBackoffMs: 1000,
            maximumBackoffMs: 30_000,
            maximumElapsedMs: 300_000,
          },
        });
        const decision =
          failure.kind === "AUTHENTICATION" || failure.kind === "PERMISSION"
            ? "AUTH_DEGRADED"
            : retry.action === "RETRY_ORIGINAL"
              ? "BACKOFF"
              : "UNAVAILABLE";
        const hint = transport?.retryAfterSeconds;
        await repository.appendRateLimitSnapshot({
          rateLimitSnapshotId: attemptIds[attempt - 1]!,
          scope,
          profileRef: envelope.profileRef,
          lane: "READ",
          ...(transport?.status === undefined ? {} : { httpStatus: transport.status }),
          ...(hint === undefined || !Number.isSafeInteger(hint) || hint < 0 || hint > 2_147_483_647
            ? {}
            : { retryAfterSeconds: hint }),
          decision,
          ...(retry.nextEligibleAt === undefined ? {} : { nextEligibleAt: retry.nextEligibleAt }),
          errorCode: retry.reasonCode,
          observedAt: now.toISOString(),
          contentHash: digest({ outboxId: row.id, attempt, retry }),
        });
        if (retry.action !== "RETRY_ORIGINAL")
          await manager.query(
            "UPDATE event_outbox SET state='FAILED' WHERE id=$1 AND state='READY'",
            [row.id],
          );
        return decision;
      }
    });
    if (outcome === "RECONCILED") {
      recordGitLabAutomationPhase(this.observability, {
        phase: "RECONCILIATION",
        outcome: "RECONCILED",
      });
    } else if (outcome === "AUTH_DEGRADED") {
      recordGitLabAutomationPhase(this.observability, {
        phase: "RECONCILIATION",
        outcome: "FAILED",
        reasonCode: "AUTH_REVOKED",
      });
    } else if (outcome === "BACKOFF") {
      recordGitLabAutomationPhase(this.observability, {
        phase: "RECONCILIATION",
        outcome: "FAILED",
        reasonCode: "RATE_LIMITED",
      });
    } else if (outcome === "UNAVAILABLE") {
      recordGitLabAutomationPhase(this.observability, {
        phase: "RECONCILIATION",
        outcome: "FAILED",
        reasonCode: "PROVIDER_UNAVAILABLE",
      });
    }
    return outcome;
  }
}

export function createGitLabAuthoritativeReadWorkerStep(
  source: DataSource,
  handler: GitLabAuthoritativeReadHandler,
  clock?: Readonly<{ now(): Date }>,
  observability?: GitLabAutomationObservability,
): Readonly<{ run(): Promise<GitLabAuthoritativeReadOutcome> }> {
  const worker = new TypeOrmGitLabAuthoritativeReadOutboxWorker(
    source,
    handler,
    clock,
    observability,
  );
  return Object.freeze({ run: async () => await worker.runOne() });
}

interface ActiveGitLabPipelineRow extends Readonly<Record<string, unknown>> {
  readonly workspace_id: string;
  readonly project_id: string;
  readonly attempt_id: string;
  readonly external_pipeline_id: string;
  readonly connection_header_id: string;
  readonly connection_ref: unknown;
  readonly profile_ref: unknown;
  readonly profile_content: unknown;
  readonly numeric_project_id: number | string;
  readonly created_at: Date | string;
}

function reconciliationPollIntervalSeconds(profileContent: unknown): number {
  const content =
    json<Readonly<{ reconciliation?: Readonly<{ pollIntervalSeconds?: number }> }>>(profileContent);
  const value = Number(content.reconciliation?.pollIntervalSeconds);
  if (!Number.isSafeInteger(value) || value < 1 || value > 900)
    throw new Error("GITLAB_RECONCILIATION_POLL_INTERVAL_INVALID");
  return value;
}

export type GitLabReconciliationSchedulerOutcome = "IDLE" | "DEFERRED" | "SCHEDULED";

/**
 * Maintains one durable, fenced cursor per exact Connection/Profile/project
 * scope and converts due active-pipeline repair work into the same
 * authoritative-read outbox consumed by verified webhook hints.
 */
export class TypeOrmGitLabReconciliationPollScheduler {
  readonly #leaseOwner: string;

  constructor(
    private readonly source: DataSource,
    private readonly clock: Readonly<{ now(): Date }> = Object.freeze({ now: () => new Date() }),
    leaseOwner = `gitlab-reconciliation:${process.pid}:${randomUUID()}`,
  ) {
    this.#leaseOwner = leaseOwner;
  }

  async runOne(): Promise<GitLabReconciliationSchedulerOutcome> {
    return await this.source.transaction("READ COMMITTED", async (manager) => {
      const now = this.clock.now();
      const repository = new TypeOrmGitLabReconciliationRepository(manager);
      const active = await this.#activePipelines(manager);
      const scopes = new Map<string, ActiveGitLabPipelineRow>();
      for (const row of active) {
        const profileRef = json<Record<string, unknown>>(row.profile_ref);
        const key = `${row.workspace_id}\0${row.connection_header_id}\0${row.numeric_project_id}\0${JSON.stringify(profileRef)}`;
        const previous = scopes.get(key);
        if (
          previous === undefined ||
          new Date(row.created_at).getTime() < new Date(previous.created_at).getTime()
        )
          scopes.set(key, row);
      }
      for (const row of scopes.values()) {
        const profileRef = json<{ id: string; version: number; contentHash: string }>(
          row.profile_ref,
        );
        await repository.ensureCursor({
          reconciliationCursorId: deterministicUuid(
            `gitlab-active-pipelines:${row.workspace_id}:${row.connection_header_id}:${row.numeric_project_id}:${JSON.stringify(profileRef)}`,
          ),
          scope: {
            workspaceId: row.workspace_id,
            connectionHeaderId: row.connection_header_id,
            numericProjectId: Number(row.numeric_project_id),
          },
          profileRef,
          lane: "ACTIVE_PIPELINES",
          boundedWindowStart: new Date(row.created_at).toISOString(),
          boundedWindowEnd: now.toISOString(),
          nextEligibleAt: now.toISOString(),
          createdAt: now.toISOString(),
        });
      }

      const cursor = (await repository.cursorsDue("ACTIVE_PIPELINES", now, 1))[0];
      if (cursor === undefined) return "IDLE";
      const claimed = await repository.claimCursor({
        reconciliationCursorId: String(cursor.reconciliation_cursor_id),
        expectedResourceVersion: Number(cursor.resource_version),
        leaseOwner: this.#leaseOwner,
        now: now.toISOString(),
        leaseSeconds: 30,
      });
      if (claimed === undefined) return "IDLE";
      const scope = Object.freeze({
        workspaceId: String(claimed.workspace_id),
        connectionHeaderId: String(claimed.connection_header_id),
        numericProjectId: Number(claimed.numeric_project_id),
      });
      const rate = await repository.latestRateLimitSnapshot(scope, "READ");
      if (rate?.decision === "AUTH_DEGRADED" || rate?.decision === "UNAVAILABLE") {
        await this.#advance(
          repository,
          claimed,
          now,
          "9999-12-31T23:59:59.999Z",
          String(rate.error_code ?? "GITLAB_READ_RETRY_STOPPED"),
          [],
        );
        return "DEFERRED";
      }
      if (
        rate?.decision === "BACKOFF" &&
        rate.next_eligible_at !== null &&
        rate.next_eligible_at !== undefined &&
        Date.parse(String(rate.next_eligible_at)) > now.getTime()
      ) {
        await this.#advance(
          repository,
          claimed,
          now,
          new Date(String(rate.next_eligible_at)).toISOString(),
          String(rate.error_code ?? "GITLAB_READ_BACKOFF"),
          [],
        );
        return "DEFERRED";
      }

      const candidates = (await manager.query(
        `
SELECT command.project_id,attempt.attempt_id,effect.external_pipeline_id,
       effect.connection_ref,effect.profile_ref,effect.numeric_project_id,profile.content AS profile_content
FROM gitlab_effect_reconciliations effect
JOIN connector_commands command ON command.workspace_id=effect.workspace_id AND command.id=effect.command_id
JOIN qa_automation_attempts attempt ON attempt.workspace_id=command.workspace_id AND attempt.project_id=command.project_id
 AND attempt.connector_command_id=command.id
JOIN connector_profile_revisions profile ON profile.workspace_id=effect.workspace_id
 AND profile.header_id=(effect.profile_ref->>'id')::uuid AND profile.version=(effect.profile_ref->>'version')::integer
 AND profile.content_hash=effect.profile_ref->>'contentHash' AND profile.status='PUBLISHED'
WHERE effect.workspace_id=$1 AND effect.connection_header_id=$2 AND effect.numeric_project_id=$3
  AND effect.profile_ref=$4::jsonb AND effect.state IN ('ONE_FOUND','CONFIRMED')
  AND effect.external_pipeline_id IS NOT NULL AND attempt.current_status<>'TERMINAL'
ORDER BY attempt.created_at,attempt.attempt_id`,
        [
          scope.workspaceId,
          scope.connectionHeaderId,
          scope.numericProjectId,
          JSON.stringify(json(claimed.profile_ref)),
        ],
      )) as readonly ActiveGitLabPipelineRow[];
      const scheduled: string[] = [];
      for (const candidate of candidates) {
        const externalPipelineId = Number(candidate.external_pipeline_id);
        if (!Number.isSafeInteger(externalPipelineId) || externalPipelineId < 1)
          throw new Error("GITLAB_RECONCILIATION_PIPELINE_ID_INVALID");
        const pending = (await manager.query(
          `
SELECT id FROM event_outbox
WHERE event_type='gitlab.authoritative-read.requested.v1' AND state='READY'
  AND workspace_id=$1 AND project_id=$2
  AND envelope->'connectionRef'->>'id'=$3 AND envelope->'signal'->>'externalPipelineId'=$4
LIMIT 1`,
          [
            scope.workspaceId,
            candidate.project_id,
            scope.connectionHeaderId,
            String(externalPipelineId),
          ],
        )) as readonly unknown[];
        if (pending.length > 0) continue;
        const leaseToken = Number(claimed.lease_token);
        const receiptId = deterministicUuid(
          `gitlab-poll-read:${claimed.reconciliation_cursor_id}:${leaseToken}:${candidate.attempt_id}:${externalPipelineId}`,
        );
        const deliveryId = `poll:${claimed.reconciliation_cursor_id}:${leaseToken}`;
        const envelope: GitLabAuthoritativeReadEnvelope = Object.freeze({
          schemaVersion: "gitlab-authoritative-read-request@1.0.0",
          receiptId,
          sourceKind: "POLL_REPAIR",
          automationAttemptId: candidate.attempt_id,
          reconciliationCursorRef: Object.freeze({
            id: String(claimed.reconciliation_cursor_id),
            leaseToken,
          }),
          signal: Object.freeze({
            deliveryId,
            externalPipelineId,
            numericGitLabProjectId: scope.numericProjectId,
          }),
          profileRef: Object.freeze(
            json<{ id: string; version: number; contentHash: string }>(candidate.profile_ref),
          ),
          connectionRef: Object.freeze(
            json<{ id: string; version: number; contentHash: string }>(candidate.connection_ref),
          ),
        });
        await manager.query(
          `
INSERT INTO event_outbox(id,workspace_id,project_id,event_type,envelope,envelope_hash,state,created_at)
VALUES($1,$2,$3,'gitlab.authoritative-read.requested.v1',$4::jsonb,$5,'READY',$6)`,
          [
            randomUUID(),
            scope.workspaceId,
            candidate.project_id,
            JSON.stringify(envelope),
            digest(envelope),
            now,
          ],
        );
        scheduled.push(`${candidate.attempt_id}:${externalPipelineId}`);
      }
      const pollSeconds =
        candidates.length === 0
          ? 30
          : Math.min(
              ...candidates.map(({ profile_content }) =>
                reconciliationPollIntervalSeconds(profile_content),
              ),
            );
      await this.#advance(
        repository,
        claimed,
        now,
        new Date(now.getTime() + pollSeconds * 1_000).toISOString(),
        undefined,
        scheduled,
      );
      return scheduled.length === 0 ? "IDLE" : "SCHEDULED";
    });
  }

  async #activePipelines(manager: EntityManager): Promise<readonly ActiveGitLabPipelineRow[]> {
    return await manager.query(
      `
SELECT effect.workspace_id,command.project_id,attempt.attempt_id,effect.external_pipeline_id,
       effect.connection_header_id,effect.connection_ref,effect.profile_ref,effect.numeric_project_id,
       effect.created_at,profile.content AS profile_content
FROM gitlab_effect_reconciliations effect
JOIN connector_commands command ON command.workspace_id=effect.workspace_id AND command.id=effect.command_id
JOIN qa_automation_attempts attempt ON attempt.workspace_id=command.workspace_id AND attempt.project_id=command.project_id
 AND attempt.connector_command_id=command.id
JOIN connector_profile_revisions profile ON profile.workspace_id=effect.workspace_id
 AND profile.header_id=(effect.profile_ref->>'id')::uuid AND profile.version=(effect.profile_ref->>'version')::integer
 AND profile.content_hash=effect.profile_ref->>'contentHash' AND profile.status='PUBLISHED'
WHERE effect.state IN ('ONE_FOUND','CONFIRMED') AND effect.external_pipeline_id IS NOT NULL
  AND attempt.current_status<>'TERMINAL'
ORDER BY effect.workspace_id,effect.connection_header_id,effect.numeric_project_id,effect.created_at`,
      [],
    );
  }

  async #advance(
    repository: TypeOrmGitLabReconciliationRepository,
    cursor: Readonly<Record<string, unknown>>,
    now: Date,
    nextEligibleAt: string,
    lastErrorCode: string | undefined,
    scheduled: readonly string[],
  ): Promise<void> {
    const priorEnd = new Date(String(cursor.bounded_window_end));
    const windowStart = priorEnd.getTime() > now.getTime() ? now : priorEnd;
    await repository.advanceCursor({
      reconciliationCursorId: String(cursor.reconciliation_cursor_id),
      expectedResourceVersion: Number(cursor.resource_version),
      leaseOwner: this.#leaseOwner,
      leaseToken: Number(cursor.lease_token),
      boundedWindowStart: windowStart.toISOString(),
      boundedWindowEnd: now.toISOString(),
      cursorValueHash: digest([...scheduled].sort()),
      nextEligibleAt,
      ...(lastErrorCode === undefined ? {} : { lastErrorCode }),
      updatedAt: now.toISOString(),
    });
  }
}

export function createLocalGitLabAuthoritativeReadHandler(
  source: DataSource,
  environment: RuntimeEnvironment,
  transport: typeof fetch = fetch,
): GitLabAuthoritativeReadHandler {
  if (
    !isGitLabLocalComposition(environment.composition) ||
    environment.environmentScope !== "LOCAL" ||
    !environment.mockHubUrl
  ) {
    throw new Error("GITLAB_RECONCILIATION_LOCAL_AUTHORITY_REQUIRED");
  }
  const endpoint = new URL(environment.mockHubUrl);
  if (
    endpoint.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "mock-hub"].includes(endpoint.hostname)
  ) {
    throw new Error("GITLAB_RECONCILIATION_LOCAL_ENDPOINT_FORBIDDEN");
  }
  const handler: GitLabAuthoritativeReadHandler = {
    async read(input) {
      const rows = (await source.query(
        `
SELECT attempt.attempt_id,attempt.authorization_basis_hash,attempt.executing_service_principal_id,
       attempt.correlation_id,attempt.causation_id,effect.marker_hash,
       session.target_snapshot,session.target_hash,session.automation_configuration_pin_set_hash,
       profile.content AS profile_content,profile.content_hash AS profile_content_hash,
       connection.content AS connection_content,connection.content_hash AS connection_content_hash,
       discovery.adapter_family,discovery.api_family,discovery.edition,discovery.exact_version,discovery.exact_build
FROM gitlab_effect_reconciliations effect
JOIN connector_commands command ON command.workspace_id=effect.workspace_id AND command.id=effect.command_id
JOIN qa_automation_attempts attempt ON attempt.workspace_id=command.workspace_id AND attempt.project_id=command.project_id
 AND attempt.connector_command_id=command.id
JOIN qa_test_sessions session ON session.workspace_id=attempt.workspace_id AND session.project_id=attempt.project_id
 AND session.session_id=attempt.session_id
JOIN connector_profile_revisions profile ON profile.workspace_id=effect.workspace_id
 AND profile.header_id=(effect.profile_ref->>'id')::uuid AND profile.version=(effect.profile_ref->>'version')::integer
 AND profile.content_hash=effect.profile_ref->>'contentHash' AND profile.status='PUBLISHED'
JOIN connection_revisions connection ON connection.workspace_id=effect.workspace_id
 AND connection.header_id=effect.connection_header_id AND connection.version=(effect.connection_ref->>'version')::integer
 AND connection.content_hash=effect.connection_ref->>'contentHash' AND connection.status='PUBLISHED'
JOIN gitlab_discovery_snapshots discovery ON discovery.workspace_id=effect.workspace_id
 AND discovery.connection_ref=effect.connection_ref AND discovery.numeric_project_id=effect.numeric_project_id
 AND discovery.validation_status='VALID' AND discovery.production_denied=true
WHERE effect.workspace_id=$1 AND command.project_id=$2 AND effect.connection_header_id=$3
  AND effect.numeric_project_id=$4 AND effect.external_pipeline_id=$5
  AND effect.profile_ref=$6::jsonb AND effect.connection_ref=$7::jsonb
  AND effect.state IN ('ONE_FOUND','CONFIRMED') AND attempt.current_status<>'TERMINAL'
ORDER BY discovery.collected_at DESC LIMIT 1`,
        [
          input.workspaceId,
          input.projectId,
          input.envelope.connectionRef.id,
          input.envelope.signal.numericGitLabProjectId,
          String(input.envelope.signal.externalPipelineId),
          JSON.stringify(input.envelope.profileRef),
          JSON.stringify(input.envelope.connectionRef),
        ],
      )) as readonly Readonly<Record<string, unknown>>[];
      const row = rows[0];
      if (row === undefined) return undefined;
      if (
        input.envelope.automationAttemptId !== undefined &&
        input.envelope.automationAttemptId !== String(row.attempt_id)
      ) {
        throw new Error("GITLAB_RECONCILIATION_ATTEMPT_SCOPE_MISMATCH");
      }
      const target = json<
        Readonly<{
          target: Readonly<{ commitSha: string }>;
          suite: Readonly<{ suiteKey: string }>;
          environment: Readonly<{ environmentRef: string }>;
          configurationPins: readonly Readonly<Record<string, unknown>>[];
        }>
      >(row.target_snapshot);
      const configurationPins = trustedPins(target.configurationPins);
      const executionPins = configurationPins.filter(
        ({ logicalRole }) => logicalRole === "TEST_EXECUTION",
      );
      const pin = executionPins[0];
      if (
        executionPins.length !== 1 ||
        pin === undefined ||
        pin.profileRef.id !== input.envelope.profileRef.id ||
        pin.profileRef.version !== input.envelope.profileRef.version ||
        pin.profileRef.contentHash !== String(row.profile_content_hash) ||
        pin.connectionRef.id !== input.envelope.connectionRef.id ||
        pin.connectionRef.version !== input.envelope.connectionRef.version ||
        pin.connectionRef.contentHash !== String(row.connection_content_hash)
      ) {
        throw new Error("GITLAB_RECONCILIATION_CONFIGURATION_PIN_REVOKED");
      }
      const connection = validateGitLabConnectionConfiguration(json(row.connection_content));
      const preflight = preflightGitLabProfile(json(row.profile_content), connection);
      if (preflight.status !== "SAFE_TO_DISCOVER" || preflight.profile === undefined)
        throw new Error("GITLAB_RECONCILIATION_PROFILE_REVOKED");
      const profile = preflight.profile;
      if (profile.numericGitLabProjectId !== input.envelope.signal.numericGitLabProjectId)
        throw new Error("GITLAB_RECONCILIATION_PROJECT_SCOPE_MISMATCH");
      const observedAt = new Date(input.observedAt);
      const clock = Object.freeze({ now: () => observedAt });
      const auth = new GitLabAuth(
        connection,
        Object.freeze({
          async resolve(secretRef: string, allowedUseHash: Sha256Digest, signal: AbortSignal) {
            if (
              signal.aborted ||
              secretRef !== connection.identityReferences.read.reference ||
              allowedUseHash !== connection.identityReferences.read.referenceFingerprint
            ) {
              throw new Error("GITLAB_RECONCILIATION_READ_CREDENTIAL_DENIED");
            }
            return Object.freeze({
              metadata: Object.freeze({ secretRef, allowedUseHash }),
              async use<T>(_at: Date, consumer: (material: Uint8Array) => Promise<T>): Promise<T> {
                return await consumer(new TextEncoder().encode("mock-gitlab-read"));
              },
            });
          },
        }),
        clock,
      );
      const client = new GitLabRestClient({
        baseUrl: endpoint.origin,
        numericProjectId: profile.numericGitLabProjectId,
        environmentClass: "LOCAL",
        allowedOrigins: Object.freeze([endpoint.origin]),
        allowedLocalHostnames: Object.freeze([endpoint.hostname]),
        transport,
        auth,
        clock,
        requestTimeoutMs: Number(profile.ratePolicy.requestTimeoutMs ?? 10_000),
      });
      const reader = new GitLabPipelineReader({
        profile,
        authority: () =>
          Object.freeze({
            sourceCommitSha: target.target.commitSha,
            suiteKey: target.suite.suiteKey,
            environmentRef: target.environment.environmentRef,
            targetSnapshotHash: String(row.target_hash) as Sha256Digest,
            configurationPinSetHash: String(
              row.automation_configuration_pin_set_hash,
            ) as Sha256Digest,
          }),
        clock,
        transport: createGitLabRestPipelineReadTransport(
          client,
          createGitLabDialect({
            adapterFamily: String(row.adapter_family) as "gitlab-rest-v4",
            apiFamily: String(row.api_family) as "v4",
            edition: String(row.edition) as "CE" | "EE",
            exactVersion: String(row.exact_version),
            exactBuild: String(row.exact_build),
            triggerDialect: profile.trigger.dialect,
            webhookDialect: profile.webhook.verificationMode,
          }),
        ),
      });
      const context: TrustedConnectorOperationContext = Object.freeze({
        scope: Object.freeze({
          kind: "PROJECT",
          workspaceId: input.workspaceId,
          projectId: input.projectId,
        }),
        actor: Object.freeze({
          kind: "SERVICE",
          principalId: String(row.executing_service_principal_id),
          serviceKey: "worker.gitlab-reconciliation",
        }),
        authorizationBasisHash: String(row.authorization_basis_hash) as Sha256Digest,
        correlationId: String(row.correlation_id),
        causationId: String(row.causation_id),
        effectIdempotencyKey: `gitlab:authoritative-read:${input.envelope.receiptId}`,
        profileRef: pin.profileRef,
        classification: Object.freeze({ key: "INTERNAL", rank: 10 }),
        signal: new AbortController().signal,
        configurationPins,
        deadlineAt: new Date(
          observedAt.getTime() + Number(profile.ratePolicy.requestTimeoutMs ?? 10_000) + 5_000,
        ).toISOString(),
        telemetry: Object.freeze({
          correlationId: String(row.correlation_id),
          causationId: String(row.causation_id),
          operation: "pipeline.read",
        }),
      });
      const request: PipelineReadRequest = Object.freeze({
        schemaVersion: "test-executor.trigger-status@1.0.0",
        messageType: "REQUEST",
        operation: "pipeline.read",
        automationAttemptId: String(row.attempt_id),
        externalPipelineId: String(input.envelope.signal.externalPipelineId),
        targetSnapshotHash: String(row.target_hash) as Sha256Digest,
        configurationPinSetHash: String(row.automation_configuration_pin_set_hash) as Sha256Digest,
      });
      const observation = await reader.read(context, request);
      return Object.freeze({
        pipelineObservationId: randomUUID(),
        scope: Object.freeze({
          workspaceId: input.workspaceId,
          connectionHeaderId: input.envelope.connectionRef.id,
          numericProjectId: input.envelope.signal.numericGitLabProjectId,
        }),
        connectionRef: input.envelope.connectionRef,
        profileRef: input.envelope.profileRef,
        externalPipelineId: observation.externalPipelineId,
        externalJobIds: observation.externalJobIds,
        providerStatus: observation.providerState,
        providerRevisionToken: observation.providerRevisionToken,
        providerUpdatedAt: observation.providerUpdatedAt,
        sourceCommitSha: observation.sourceCommitSha,
        sourceRefHash: digest(profile.trigger.ref),
        markerHash: String(row.marker_hash) as Sha256Digest,
        normalizedJobSetHash: digest(observation.externalJobIds),
        sourceKind: input.envelope.sourceKind === "POLL_REPAIR" ? "POLL" : "RECONCILIATION",
        sourceRef: Object.freeze({
          id: input.envelope.receiptId,
          version: Math.max(1, input.envelope.reconciliationCursorRef?.leaseToken ?? 1),
          contentHash: digest({
            receiptId: input.envelope.receiptId,
            sourceKind: input.envelope.sourceKind ?? "WEBHOOK_HINT",
          }),
        }),
        observationHash: observation.observationHash,
        observedAt: observation.observedAt,
      });
    },
  };
  return Object.freeze(handler);
}

export interface GitLabReconciliationWorkerSteps {
  readonly pollScheduler: Readonly<{ run(): Promise<GitLabReconciliationSchedulerOutcome> }>;
  readonly authoritativeReads: Readonly<{ run(): Promise<GitLabAuthoritativeReadOutcome> }>;
}

export function createGitLabReconciliationWorkerSteps(
  source: DataSource,
  handler: GitLabAuthoritativeReadHandler,
  clock?: Readonly<{ now(): Date }>,
): GitLabReconciliationWorkerSteps {
  const scheduler = new TypeOrmGitLabReconciliationPollScheduler(source, clock);
  const reads = new TypeOrmGitLabAuthoritativeReadOutboxWorker(source, handler, clock);
  return Object.freeze({
    pollScheduler: Object.freeze({ run: async () => await scheduler.runOne() }),
    authoritativeReads: Object.freeze({ run: async () => await reads.runOne() }),
  });
}
