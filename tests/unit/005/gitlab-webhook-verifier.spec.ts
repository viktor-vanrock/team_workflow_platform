import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  GitLabWebhookVerificationError,
  type GitLabWebhookVerificationInput,
  verifyAndNormalizeGitLabWebhook,
} from "../../../packages/connector-gitlab/src/webhooks/gitlab-webhook-normalizer.ts";
import { designContractRegistry } from "../../../packages/platform-contracts/src/index.ts";

const encoder = new TextEncoder();
const secret = encoder.encode("feature-005-standard-webhooks-key");
const receivedAt = "2026-09-01T12:00:00.000Z";
const timestamp = String(Date.parse(receivedAt) / 1_000);

function pipelineBody(overrides: Readonly<Record<string, unknown>> = {}): Uint8Array {
  return encoder.encode(
    JSON.stringify({
      object_kind: "pipeline",
      project: { id: 5001 },
      object_attributes: {
        id: 101,
        status: "success",
        sha: "a".repeat(40),
        updated_at: "2026-09-01T11:59:59.000Z",
      },
      ...overrides,
    }),
  );
}

function signature(deliveryId: string, signedTimestamp: string, rawBody: Uint8Array): string {
  const message = Buffer.concat([
    Buffer.from(`${deliveryId}.${signedTimestamp}.`),
    Buffer.from(rawBody),
  ]);
  return `v1,${createHmac("sha256", secret).update(message).digest("base64")}`;
}

function input(
  overrides: Partial<GitLabWebhookVerificationInput> = {},
): GitLabWebhookVerificationInput {
  const rawBody = overrides.rawBody ?? pipelineBody();
  const deliveryId = overrides.headers?.webhookId ?? "delivery-005-us4-1";
  const signedTimestamp = overrides.headers?.webhookTimestamp ?? timestamp;
  return {
    rawBody,
    contentType: "application/json",
    headers: {
      webhookId: deliveryId,
      webhookTimestamp: signedTimestamp,
      webhookSignature: signature(deliveryId, signedTimestamp, rawBody),
    },
    secret,
    receivedAt,
    route: {
      connectionId: "550e8400-e29b-41d4-a716-446655440201",
      workspaceId: "550e8400-e29b-41d4-a716-446655440202",
      projectId: "550e8400-e29b-41d4-a716-446655440203",
      numericProjectId: 5001,
    },
    policy: {
      verificationMode: "STANDARD_WEBHOOKS_HMAC_SHA256",
      maxRawBytes: 1_048_576,
      freshnessSeconds: 300,
      dedupeHorizonSeconds: 86_400,
      eventKinds: ["PIPELINE_HOOK", "JOB_HOOK"],
    },
    ...overrides,
  };
}

function rejected(code: string): Readonly<{ code: string }> {
  return { code };
}

describe("Feature 005 Standard Webhooks verifier", () => {
  it("verifies exact raw bytes in constant-time and emits the closed safe pipeline signal", () => {
    const result = verifyAndNormalizeGitLabWebhook(input());
    expect(result).toMatchObject({
      status: "ACCEPTED",
      signatureValid: true,
      freshnessValid: true,
      replayValid: true,
    });
    expect(result.normalized).toEqual({
      schemaVersion: "gitlab-normalized-webhook@1.0.0",
      connectionId: "550e8400-e29b-41d4-a716-446655440201",
      workspaceId: "550e8400-e29b-41d4-a716-446655440202",
      projectId: "550e8400-e29b-41d4-a716-446655440203",
      deliveryId: "delivery-005-us4-1",
      eventKind: "PIPELINE_HOOK",
      numericGitLabProjectId: 5001,
      externalPipelineId: 101,
      externalStatus: "success",
      commitSha: "a".repeat(40),
      signatureVerified: true,
      bodyHash: result.bodyHash,
      providerObservedAt: "2026-09-01T11:59:59.000Z",
      receivedAt,
    });
    designContractRegistry.validateById(
      "urn:awp:schemas:005:gitlab-normalized-webhook:v1",
      result.normalized,
    );
    expect(JSON.stringify(result)).not.toContain("object_attributes");
  });

  it("rejects a bad signature and never accepts the legacy GitLab token by itself", () => {
    expect(() =>
      verifyAndNormalizeGitLabWebhook(
        input({
          headers: {
            webhookId: "delivery-invalid",
            webhookTimestamp: timestamp,
            webhookSignature: "v1,AAAAAAAA",
            legacyGitLabToken: "legacy-token",
          },
        }),
      ),
    ).toThrow(expect.objectContaining(rejected("GITLAB_WEBHOOK_SIGNATURE_INVALID")));
    expect(() =>
      verifyAndNormalizeGitLabWebhook(
        input({
          headers: {
            webhookId: "delivery-token-only",
            webhookTimestamp: timestamp,
            legacyGitLabToken: "legacy-token",
          },
        }),
      ),
    ).toThrow(expect.objectContaining(rejected("GITLAB_WEBHOOK_SIGNATURE_REQUIRED")));
  });

  it("rejects stale and excessively future timestamps before payload normalization", () => {
    for (const signedTimestamp of [
      String(Number(timestamp) - 301),
      String(Number(timestamp) + 301),
    ]) {
      const rawBody = pipelineBody();
      expect(() =>
        verifyAndNormalizeGitLabWebhook(
          input({
            rawBody,
            headers: {
              webhookId: `delivery-time-${signedTimestamp}`,
              webhookTimestamp: signedTimestamp,
              webhookSignature: signature(
                `delivery-time-${signedTimestamp}`,
                signedTimestamp,
                rawBody,
              ),
            },
          }),
        ),
      ).toThrow(expect.objectContaining(rejected("GITLAB_WEBHOOK_TIMESTAMP_STALE")));
    }
  });

  it("classifies an exact duplicate, rejects replay outside the horizon, and quarantines same-ID changed bytes", () => {
    const first = verifyAndNormalizeGitLabWebhook(input());
    expect(
      verifyAndNormalizeGitLabWebhook(
        input({
          existingDelivery: { bodyHash: first.bodyHash, receivedAt: "2026-09-01T11:59:30.000Z" },
        }),
      ),
    ).toMatchObject({ status: "DUPLICATE", bodyHash: first.bodyHash, replayValid: true });

    expect(() =>
      verifyAndNormalizeGitLabWebhook(
        input({
          existingDelivery: { bodyHash: first.bodyHash, receivedAt: "2026-08-31T11:59:59.000Z" },
        }),
      ),
    ).toThrow(expect.objectContaining(rejected("GITLAB_WEBHOOK_REPLAY_HORIZON_EXCEEDED")));

    const changedBody = pipelineBody({
      object_attributes: {
        id: 101,
        status: "failed",
        sha: "a".repeat(40),
        updated_at: "2026-09-01T11:59:59.000Z",
      },
    });
    const conflict = verifyAndNormalizeGitLabWebhook(
      input({
        rawBody: changedBody,
        headers: {
          webhookId: "delivery-005-us4-1",
          webhookTimestamp: timestamp,
          webhookSignature: signature("delivery-005-us4-1", timestamp, changedBody),
        },
        existingDelivery: { bodyHash: first.bodyHash, receivedAt: "2026-09-01T11:59:30.000Z" },
      }),
    );
    expect(conflict).toMatchObject({
      status: "SECURITY_CONFLICT",
      conflictBodyHash: conflict.bodyHash,
      reasonCode: "DELIVERY_ID_BODY_CONFLICT",
    });
    expect(conflict.normalized).toBeUndefined();
  });

  it("rejects oversized, wrong-content-type, and cross-project bodies before producing a signal", () => {
    const cases: readonly [GitLabWebhookVerificationInput, string][] = [
      [input({ rawBody: new Uint8Array(1_048_577) }), "GITLAB_WEBHOOK_BODY_TOO_LARGE"],
      [input({ contentType: "text/plain" }), "GITLAB_WEBHOOK_CONTENT_TYPE_INVALID"],
      [
        input({ rawBody: pipelineBody({ project: { id: 5002 } }) }),
        "GITLAB_WEBHOOK_PROJECT_SCOPE_MISMATCH",
      ],
    ];
    for (const [candidate, code] of cases) {
      expect(() => verifyAndNormalizeGitLabWebhook(candidate)).toThrow(
        expect.objectContaining(rejected(code)),
      );
    }
  });

  it("rejects unsupported webhook event kinds and malformed JSON with stable codes", () => {
    const unsupported = pipelineBody({ object_kind: "merge_request" });
    expect(() =>
      verifyAndNormalizeGitLabWebhook(
        input({
          rawBody: unsupported,
          headers: {
            webhookId: "delivery-unsupported",
            webhookTimestamp: timestamp,
            webhookSignature: signature("delivery-unsupported", timestamp, unsupported),
          },
        }),
      ),
    ).toThrow(expect.objectContaining(rejected("GITLAB_WEBHOOK_EVENT_KIND_UNSUPPORTED")));
    const malformed = encoder.encode("{not-json");
    expect(() =>
      verifyAndNormalizeGitLabWebhook(
        input({
          rawBody: malformed,
          headers: {
            webhookId: "delivery-malformed",
            webhookTimestamp: timestamp,
            webhookSignature: signature("delivery-malformed", timestamp, malformed),
          },
        }),
      ),
    ).toThrow(expect.objectContaining(rejected("GITLAB_WEBHOOK_BODY_INVALID")));
    expect(GitLabWebhookVerificationError).toBeDefined();
  });
});
