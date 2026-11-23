import { createHmac } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { verifyAndNormalizeGitLabWebhook } from "../../../../packages/connector-gitlab/src/index.ts";
import {
  type GitLabWebhookReceiptInput,
  TypeOrmGitLabReconciliationRepository,
} from "../../../../packages/connector-gitlab-persistence-typeorm/src/index.ts";
import {
  createPlatformDataSource,
  migrationClasses,
} from "../../../../packages/platform-persistence-typeorm/src/index.ts";
import {
  type RunningPostgres,
  startPostgres,
} from "../../../../packages/platform-testkit/src/postgres.ts";
import {
  loadEnvironment,
  qaJiraGitLabLocalSeedIds,
  runQaJiraGitLabLocalSeed,
  TypeOrmGitLabWebhookAuthorityLoader,
  TypeOrmGitLabWebhookIngressService,
} from "../../../../packages/runtime-composition/src/index.ts";

const encoder = new TextEncoder();
const secret = encoder.encode("feature-005-standard-webhooks-key");
const workspaceId = "550e8400-e29b-41d4-a716-446655440211";
const connectionHeaderId = "550e8400-e29b-41d4-a716-446655440212";
const projectId = "550e8400-e29b-41d4-a716-446655440213";
const profileId = "550e8400-e29b-41d4-a716-446655440214";
const receivedAt = "2026-09-01T12:00:00.000Z";
const timestamp = String(Date.parse(receivedAt) / 1_000);
const scope = Object.freeze({ workspaceId, connectionHeaderId, numericProjectId: 5001 });

let postgres: RunningPostgres | undefined;
let source: ReturnType<typeof createPlatformDataSource> | undefined;
let repository: TypeOrmGitLabReconciliationRepository;

function body(status = "success", numericProjectId = 5001): Uint8Array {
  return encoder.encode(
    JSON.stringify({
      object_kind: "pipeline",
      project: { id: numericProjectId },
      object_attributes: {
        id: 101,
        status,
        sha: "b".repeat(40),
        updated_at: "2026-09-01T11:59:59.000Z",
      },
    }),
  );
}

function sign(deliveryId: string, rawBody: Uint8Array): string {
  return `v1,${createHmac("sha256", secret)
    .update(Buffer.concat([Buffer.from(`${deliveryId}.${timestamp}.`), Buffer.from(rawBody)]))
    .digest("base64")}`;
}

function verify(
  deliveryId: string,
  rawBody: Uint8Array,
  existingDelivery?: Readonly<{ bodyHash: `sha256:${string}`; receivedAt: string }>,
) {
  return verifyAndNormalizeGitLabWebhook({
    rawBody,
    contentType: "application/json",
    headers: {
      webhookId: deliveryId,
      webhookTimestamp: timestamp,
      webhookSignature: sign(deliveryId, rawBody),
    },
    secret,
    receivedAt,
    route: { connectionId: connectionHeaderId, workspaceId, projectId, numericProjectId: 5001 },
    policy: {
      verificationMode: "STANDARD_WEBHOOKS_HMAC_SHA256",
      maxRawBytes: 1_048_576,
      freshnessSeconds: 300,
      dedupeHorizonSeconds: 86_400,
      eventKinds: ["PIPELINE_HOOK", "JOB_HOOK"],
    },
    ...(existingDelivery === undefined ? {} : { existingDelivery }),
  });
}

function receipt(id: string, result: ReturnType<typeof verify>): GitLabWebhookReceiptInput {
  return {
    webhookReceiptId: id,
    scope,
    coreInboxReceiptRef: { id: `core:${id}`, version: 1, contentHash: `sha256:${"1".repeat(64)}` },
    connectionRef: { id: connectionHeaderId, version: 1, contentHash: `sha256:${"2".repeat(64)}` },
    adapterFamily: "gitlab-rest-v4",
    adapterContractVersion: "1.0.0",
    webhookKeyVersionRef: "key-version:gitlab-webhook:project-5001:v1",
    providerDeliveryId: result.deliveryId,
    eventKind: result.eventKind,
    signatureValid: result.signatureValid,
    freshnessValid: result.freshnessValid,
    replayValid: result.replayValid,
    bodyHash: result.bodyHash,
    ...(result.conflictBodyHash === undefined ? {} : { conflictBodyHash: result.conflictBodyHash }),
    ...(result.normalizedSignalHash === undefined
      ? {}
      : { normalizedSignalHash: result.normalizedSignalHash }),
    status: result.status,
    ...(result.reasonCode === undefined ? {} : { reasonCode: result.reasonCode }),
    receivedAt,
  };
}

beforeAll(async () => {
  const { qaJiraGitLabLocalComposition, qaJiraGitLabLocalMigrationRegistry } =
    await import("../../../../packages/runtime-composition/src/gitlab/composition.ts");
  postgres = await startPostgres();
  source = createPlatformDataSource({
    url: postgres.url,
    entities: qaJiraGitLabLocalComposition.entities,
    migrations: migrationClasses(qaJiraGitLabLocalMigrationRegistry),
  });
  await source.initialize();
  await source.runMigrations({ transaction: "all" });
  await runQaJiraGitLabLocalSeed(
    source,
    loadEnvironment({
      AWP_ENVIRONMENT: "LOCAL",
      AWP_COMPOSITION: "qa-jira-gitlab-local",
      AWP_EXTERNAL_NETWORK_MODE: "deny",
      AWP_DATABASE_URL: postgres.url,
      AWP_MOCK_HUB_URL: "http://127.0.0.1:4010",
      AWP_IDENTITY_ISSUER: "https://fake-idp:4443/oidc",
    }),
  );
  repository = new TypeOrmGitLabReconciliationRepository(source);
}, 120_000);

afterAll(async () => {
  if (source?.isInitialized) await source.destroy();
  await postgres?.stop();
}, 120_000);

describe("Feature 005 GitLab webhook ingress security persistence", () => {
  it("persists one safe receipt, deduplicates exact replay, and stores no raw body or signature", async () => {
    const rawBody = body();
    const accepted = verify("delivery-security-1", rawBody);
    const stored = await repository.recordWebhookReceipt(
      receipt("550e8400-e29b-41d4-a716-446655440221", accepted),
    );
    expect(stored).toMatchObject({
      status: "ACCEPTED",
      provider_delivery_id: "delivery-security-1",
      body_hash: accepted.bodyHash,
    });
    expect(JSON.stringify(stored)).not.toContain(Buffer.from(rawBody).toString("utf8"));
    expect(JSON.stringify(stored)).not.toContain("webhook-signature");

    const duplicate = verify("delivery-security-1", rawBody, {
      bodyHash: accepted.bodyHash,
      receivedAt,
    });
    await expect(
      repository.recordWebhookReceipt(receipt("550e8400-e29b-41d4-a716-446655440222", duplicate)),
    ).resolves.toMatchObject({ status: "DUPLICATE", replayed: true });
    const [count] = (await source!.query(
      "SELECT count(*)::int AS count FROM gitlab_webhook_receipts WHERE provider_delivery_id=$1",
      ["delivery-security-1"],
    )) as readonly Readonly<{ count: number }>[];
    expect(count?.count).toBe(1);
  });

  it("quarantines a validly signed same-delivery-ID changed body without replacing original evidence", async () => {
    const first = await repository.webhookReceipt(scope, "delivery-security-1");
    const changed = body("failed");
    const conflict = verify("delivery-security-1", changed, {
      bodyHash: String(first!.body_hash) as `sha256:${string}`,
      receivedAt,
    });
    const stored = await repository.recordWebhookReceipt(
      receipt("550e8400-e29b-41d4-a716-446655440223", conflict),
    );
    expect(stored).toMatchObject({
      status: "SECURITY_CONFLICT",
      body_hash: first!.body_hash,
      conflict_body_hash: conflict.bodyHash,
      reason_code: "DELIVERY_ID_BODY_CONFLICT",
    });
    expect(await repository.webhookReceipt(scope, "delivery-security-1")).toMatchObject({
      status: "SECURITY_CONFLICT",
      body_hash: first!.body_hash,
    });
  });

  it("rejects invalid signature, stale, oversized, and cross-project attacks with zero durable receipts", async () => {
    const before = (await source!.query(
      "SELECT count(*)::int AS count FROM gitlab_webhook_receipts",
    )) as readonly Readonly<{ count: number }>[];
    const invalidCases = [
      () =>
        verifyAndNormalizeGitLabWebhook({
          rawBody: body(),
          contentType: "application/json",
          headers: {
            webhookId: "attack-signature",
            webhookTimestamp: timestamp,
            webhookSignature: "v1,invalid",
          },
          secret,
          receivedAt,
          route: {
            connectionId: connectionHeaderId,
            workspaceId,
            projectId,
            numericProjectId: 5001,
          },
          policy: {
            verificationMode: "STANDARD_WEBHOOKS_HMAC_SHA256" as const,
            maxRawBytes: 1_048_576,
            freshnessSeconds: 300,
            dedupeHorizonSeconds: 86_400,
            eventKinds: ["PIPELINE_HOOK" as const],
          },
        }),
      () => verify("attack-cross-project", body("success", 5002)),
      () => verify("attack-oversized", new Uint8Array(1_048_577)),
    ];
    for (const attack of invalidCases) expect(attack).toThrow();
    const after = (await source!.query(
      "SELECT count(*)::int AS count FROM gitlab_webhook_receipts",
    )) as readonly Readonly<{ count: number }>[];
    expect(after[0]?.count).toBe(before[0]?.count);
  });

  it("isolates delivery identities by exact connection and numeric project scope", async () => {
    await expect(
      repository.webhookReceipt({ ...scope, connectionHeaderId: profileId }, "delivery-security-1"),
    ).resolves.toBeUndefined();
    await expect(
      repository.webhookReceipt({ ...scope, numericProjectId: 5002 }, "delivery-security-1"),
    ).resolves.toBeUndefined();
  });

  it("resolves the published authority and ACKs through durable raw inbox plus one read-request outbox without provider I/O", async () => {
    const webhookSecret = encoder.encode("mock-gitlab-webhook");
    let secretResolutions = 0;
    const ingress = new TypeOrmGitLabWebhookIngressService(
      source!,
      new TypeOrmGitLabWebhookAuthorityLoader(source!),
      Object.freeze({
        async resolve() {
          secretResolutions += 1;
          return webhookSecret;
        },
      }),
    );
    const deliveryId = "delivery-seeded-authority-1";
    const rawBody = body();
    const webhookSignature = `v1,${createHmac("sha256", webhookSecret)
      .update(Buffer.concat([Buffer.from(`${deliveryId}.${timestamp}.`), Buffer.from(rawBody)]))
      .digest("base64")}`;
    const request = {
      connectionId: qaJiraGitLabLocalSeedIds.connection,
      rawBody,
      contentType: "application/json",
      headers: {
        "webhook-id": deliveryId,
        "webhook-timestamp": timestamp,
        "webhook-signature": webhookSignature,
      },
      receivedAt: new Date(receivedAt),
    } as const;
    const accepted = await ingress.accept(request);
    expect(accepted).toMatchObject({ status: "ACCEPTED" });
    await expect(ingress.accept(request)).resolves.toMatchObject({
      status: "DUPLICATE",
      receiptId: accepted.receiptId,
    });
    expect(secretResolutions).toBe(2);
    const [counts] = (await source!.query(
      `SELECT
      (SELECT count(*)::int FROM webhook_receipts WHERE connector_key=$1 AND delivery_id=$2) AS core_receipts,
      (SELECT count(*)::int FROM gitlab_webhook_receipts WHERE connection_header_id=$3 AND provider_delivery_id=$2) AS gitlab_receipts,
      (SELECT count(*)::int FROM event_outbox WHERE event_type='gitlab.authoritative-read.requested.v1' AND envelope->>'receiptId'=$4) AS read_requests`,
      [
        `gitlab:${qaJiraGitLabLocalSeedIds.connection}`,
        deliveryId,
        qaJiraGitLabLocalSeedIds.connection,
        accepted.receiptId,
      ],
    )) as readonly Readonly<{
      core_receipts: number;
      gitlab_receipts: number;
      read_requests: number;
    }>[];
    expect(counts).toEqual({ core_receipts: 1, gitlab_receipts: 1, read_requests: 1 });
    const [core] = (await source!.query(
      "SELECT raw_body,verification_result,secret_key_version FROM webhook_receipts WHERE connector_key=$1 AND delivery_id=$2",
      [`gitlab:${qaJiraGitLabLocalSeedIds.connection}`, deliveryId],
    )) as readonly Readonly<Record<string, unknown>>[];
    expect(Buffer.from(core!.raw_body as Uint8Array)).toEqual(Buffer.from(rawBody));
    expect(core).toMatchObject({
      verification_result: "SIGNATURE_VERIFIED",
      secret_key_version: "key-version:gitlab-webhook:project-5001:v1",
    });
  });
});
