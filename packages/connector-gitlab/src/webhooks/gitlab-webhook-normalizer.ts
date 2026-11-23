import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export type GitLabWebhookEventKind = "PIPELINE_HOOK" | "JOB_HOOK";
export type GitLabWebhookReceiptStatus = "ACCEPTED" | "DUPLICATE" | "SECURITY_CONFLICT";

export interface GitLabWebhookVerificationHeaders {
  readonly webhookId?: string;
  readonly webhookTimestamp?: string;
  readonly webhookSignature?: string;
  readonly legacyGitLabToken?: string;
}

export interface GitLabWebhookVerificationInput {
  readonly rawBody: Uint8Array;
  readonly contentType: string;
  readonly headers: GitLabWebhookVerificationHeaders;
  readonly secret: Uint8Array;
  readonly receivedAt: string;
  readonly route: Readonly<{
    connectionId: string;
    workspaceId: string;
    projectId: string;
    numericProjectId: number;
  }>;
  readonly policy: Readonly<{
    verificationMode: "STANDARD_WEBHOOKS_HMAC_SHA256";
    maxRawBytes: number;
    freshnessSeconds: number;
    dedupeHorizonSeconds: number;
    eventKinds: readonly GitLabWebhookEventKind[];
  }>;
  readonly existingDelivery?: Readonly<{ bodyHash: `sha256:${string}`; receivedAt: string }>;
}

export interface GitLabNormalizedWebhook {
  readonly schemaVersion: "gitlab-normalized-webhook@1.0.0";
  readonly connectionId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly deliveryId: string;
  readonly eventKind: GitLabWebhookEventKind;
  readonly numericGitLabProjectId: number;
  readonly externalPipelineId: number;
  readonly externalJobId?: number;
  readonly externalStatus:
    | "created"
    | "waiting_for_resource"
    | "preparing"
    | "pending"
    | "running"
    | "success"
    | "failed"
    | "canceled"
    | "skipped"
    | "manual"
    | "scheduled";
  readonly commitSha?: string;
  readonly signatureVerified: true;
  readonly bodyHash: `sha256:${string}`;
  readonly providerObservedAt: string;
  readonly receivedAt: string;
}

export interface GitLabWebhookVerificationResult {
  readonly deliveryId: string;
  readonly eventKind: GitLabWebhookEventKind;
  readonly status: GitLabWebhookReceiptStatus;
  readonly signatureValid: true;
  readonly freshnessValid: true;
  readonly replayValid: boolean;
  readonly bodyHash: `sha256:${string}`;
  readonly conflictBodyHash?: `sha256:${string}`;
  readonly normalizedSignalHash?: `sha256:${string}`;
  readonly normalized?: GitLabNormalizedWebhook;
  readonly reasonCode?: "DELIVERY_ID_BODY_CONFLICT";
}

export class GitLabWebhookVerificationError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "GitLabWebhookVerificationError";
  }
}

const statuses = new Set<GitLabNormalizedWebhook["externalStatus"]>([
  "created",
  "waiting_for_resource",
  "preparing",
  "pending",
  "running",
  "success",
  "failed",
  "canceled",
  "skipped",
  "manual",
  "scheduled",
]);

function fail(code: string): never {
  throw new GitLabWebhookVerificationError(code);
}

function digest(value: Uint8Array | string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function object(
  value: unknown,
  code = "GITLAB_WEBHOOK_BODY_INVALID",
): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return fail(code);
  return value as Readonly<Record<string, unknown>>;
}

function positiveInteger(value: unknown, code: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) return fail(code);
  return Number(value);
}

function timestamp(value: unknown, code: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return fail(code);
  return new Date(value).toISOString();
}

function status(value: unknown): GitLabNormalizedWebhook["externalStatus"] {
  if (
    typeof value !== "string" ||
    !statuses.has(value as GitLabNormalizedWebhook["externalStatus"])
  )
    return fail("GITLAB_WEBHOOK_STATUS_INVALID");
  return value as GitLabNormalizedWebhook["externalStatus"];
}

function optionalCommitSha(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || !/^[a-f0-9]{40}$/u.test(value))
    return fail("GITLAB_WEBHOOK_COMMIT_SHA_INVALID");
  return value;
}

function signatureCandidates(header: string): readonly Uint8Array[] {
  return header.split(/\s+/u).flatMap((part) => {
    const match = /^v1,([A-Za-z0-9+/]+={0,2})$/u.exec(part);
    if (!match) return [];
    const value = Buffer.from(match[1]!, "base64");
    return value.length === 32 ? [value] : [];
  });
}

function verifySignature(
  input: GitLabWebhookVerificationInput,
  deliveryId: string,
  signedTimestamp: string,
): void {
  const header = input.headers.webhookSignature;
  if (header === undefined || header.length === 0) return fail("GITLAB_WEBHOOK_SIGNATURE_REQUIRED");
  const message = Buffer.concat([
    Buffer.from(`${deliveryId}.${signedTimestamp}.`),
    Buffer.from(input.rawBody),
  ]);
  const expected = createHmac("sha256", input.secret).update(message).digest();
  const valid = signatureCandidates(header).some(
    (candidate) => candidate.length === expected.length && timingSafeEqual(candidate, expected),
  );
  if (!valid) fail("GITLAB_WEBHOOK_SIGNATURE_INVALID");
}

function normalizePayload(
  input: GitLabWebhookVerificationInput,
  payload: Readonly<Record<string, unknown>>,
  deliveryId: string,
  bodyHash: `sha256:${string}`,
): Readonly<{ eventKind: GitLabWebhookEventKind; normalized: GitLabNormalizedWebhook }> {
  const kind = payload.object_kind;
  let eventKind: GitLabWebhookEventKind;
  let numericProjectId: number;
  let externalPipelineId: number;
  let externalJobId: number | undefined;
  let externalStatus: GitLabNormalizedWebhook["externalStatus"];
  let commitSha: string | undefined;
  let providerObservedAt: string;

  if (kind === "pipeline") {
    eventKind = "PIPELINE_HOOK";
    const project = object(payload.project, "GITLAB_WEBHOOK_PROJECT_INVALID");
    const attributes = object(payload.object_attributes);
    numericProjectId = positiveInteger(project.id, "GITLAB_WEBHOOK_PROJECT_INVALID");
    externalPipelineId = positiveInteger(attributes.id, "GITLAB_WEBHOOK_PIPELINE_INVALID");
    externalStatus = status(attributes.status);
    commitSha = optionalCommitSha(attributes.sha);
    providerObservedAt = timestamp(attributes.updated_at, "GITLAB_WEBHOOK_PROVIDER_TIME_INVALID");
  } else if (kind === "build") {
    eventKind = "JOB_HOOK";
    numericProjectId = positiveInteger(payload.project_id, "GITLAB_WEBHOOK_PROJECT_INVALID");
    externalPipelineId = positiveInteger(payload.pipeline_id, "GITLAB_WEBHOOK_PIPELINE_INVALID");
    externalJobId = positiveInteger(payload.build_id, "GITLAB_WEBHOOK_JOB_INVALID");
    externalStatus = status(payload.build_status);
    commitSha = optionalCommitSha(
      payload.commit === undefined ? undefined : object(payload.commit).sha,
    );
    providerObservedAt = timestamp(
      payload.build_finished_at ?? payload.build_started_at ?? input.receivedAt,
      "GITLAB_WEBHOOK_PROVIDER_TIME_INVALID",
    );
  } else {
    return fail("GITLAB_WEBHOOK_EVENT_KIND_UNSUPPORTED");
  }

  if (!input.policy.eventKinds.includes(eventKind)) fail("GITLAB_WEBHOOK_EVENT_KIND_DENIED");
  if (numericProjectId !== input.route.numericProjectId)
    fail("GITLAB_WEBHOOK_PROJECT_SCOPE_MISMATCH");
  const normalized: GitLabNormalizedWebhook = Object.freeze({
    schemaVersion: "gitlab-normalized-webhook@1.0.0",
    connectionId: input.route.connectionId,
    workspaceId: input.route.workspaceId,
    projectId: input.route.projectId,
    deliveryId,
    eventKind,
    numericGitLabProjectId: numericProjectId,
    externalPipelineId,
    ...(externalJobId === undefined ? {} : { externalJobId }),
    externalStatus,
    ...(commitSha === undefined ? {} : { commitSha }),
    signatureVerified: true,
    bodyHash,
    providerObservedAt,
    receivedAt: new Date(input.receivedAt).toISOString(),
  });
  return Object.freeze({ eventKind, normalized });
}

export function verifyAndNormalizeGitLabWebhook(
  input: GitLabWebhookVerificationInput,
): GitLabWebhookVerificationResult {
  if (input.policy.verificationMode !== "STANDARD_WEBHOOKS_HMAC_SHA256")
    fail("GITLAB_WEBHOOK_VERIFICATION_MODE_UNSUPPORTED");
  if (
    !Number.isSafeInteger(input.policy.maxRawBytes) ||
    input.policy.maxRawBytes < 1 ||
    input.rawBody.byteLength > input.policy.maxRawBytes
  )
    fail("GITLAB_WEBHOOK_BODY_TOO_LARGE");
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(input.contentType.trim()))
    fail("GITLAB_WEBHOOK_CONTENT_TYPE_INVALID");
  const deliveryId = input.headers.webhookId;
  if (typeof deliveryId !== "string" || deliveryId.length < 1 || deliveryId.length > 128)
    fail("GITLAB_WEBHOOK_DELIVERY_ID_INVALID");
  const signedTimestamp = input.headers.webhookTimestamp;
  if (typeof signedTimestamp !== "string" || !/^[0-9]{10,13}$/u.test(signedTimestamp))
    fail("GITLAB_WEBHOOK_TIMESTAMP_INVALID");
  const receivedAtMs = Date.parse(input.receivedAt);
  if (!Number.isFinite(receivedAtMs)) fail("GITLAB_WEBHOOK_RECEIVED_AT_INVALID");
  const signedAtMs = Number(signedTimestamp) * 1_000;
  if (
    !Number.isSafeInteger(signedAtMs) ||
    Math.abs(receivedAtMs - signedAtMs) > input.policy.freshnessSeconds * 1_000
  )
    fail("GITLAB_WEBHOOK_TIMESTAMP_STALE");
  verifySignature(input, deliveryId, signedTimestamp);

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(input.rawBody));
  } catch {
    return fail("GITLAB_WEBHOOK_BODY_INVALID");
  }
  const bodyHash = digest(input.rawBody);
  const { eventKind, normalized } = normalizePayload(input, object(parsed), deliveryId, bodyHash);
  if (input.existingDelivery !== undefined) {
    const existingAtMs = Date.parse(input.existingDelivery.receivedAt);
    if (
      !Number.isFinite(existingAtMs) ||
      receivedAtMs - existingAtMs > input.policy.dedupeHorizonSeconds * 1_000
    )
      fail("GITLAB_WEBHOOK_REPLAY_HORIZON_EXCEEDED");
    if (input.existingDelivery.bodyHash === bodyHash) {
      return Object.freeze({
        deliveryId,
        eventKind,
        status: "DUPLICATE",
        signatureValid: true,
        freshnessValid: true,
        replayValid: true,
        bodyHash,
        normalizedSignalHash: digest(JSON.stringify(normalized)),
        normalized,
      });
    }
    return Object.freeze({
      deliveryId,
      eventKind,
      status: "SECURITY_CONFLICT",
      signatureValid: true,
      freshnessValid: true,
      replayValid: false,
      bodyHash,
      conflictBodyHash: bodyHash,
      reasonCode: "DELIVERY_ID_BODY_CONFLICT",
    });
  }
  return Object.freeze({
    deliveryId,
    eventKind,
    status: "ACCEPTED",
    signatureValid: true,
    freshnessValid: true,
    replayValid: true,
    bodyHash,
    normalizedSignalHash: digest(JSON.stringify(normalized)),
    normalized,
  });
}
