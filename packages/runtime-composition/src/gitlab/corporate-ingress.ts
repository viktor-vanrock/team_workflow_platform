import { verifyAndNormalizeGitLabWebhook } from "@awp/connector-gitlab";
import type { JsonValue } from "@awp/platform-contracts";
import { freezePilotValue } from "@awp/platform-core";

import { assertIngressPolicy, type ProviderIngressPolicy } from "../pilot/provider-conformance.ts";
import {
  assertOriginalFreshness,
  type AuthenticatedIngressSource,
  type IngressHmacKeys,
  type IngressSourceAuthenticator,
  type ProviderIngressRequest,
  snapshotIngressRequest,
} from "../pilot/trusted-ingress.ts";

export class GitLabNativeIngressSource implements IngressSourceAuthenticator {
  readonly #policy: ProviderIngressPolicy;
  constructor(
    policy: ProviderIngressPolicy,
    private readonly keys: IngressHmacKeys,
  ) {
    assertIngressPolicy(policy);
    if (
      policy.subject.provider !== "GITLAB" ||
      !/^[1-9][0-9]{0,14}$/u.test(policy.subject.externalScopeId)
    )
      throw new Error("GITLAB_INGRESS_DIALECT_REQUIRED");
    this.#policy = freezePilotValue(structuredClone(policy));
  }
  async authenticate(
    input: ProviderIngressRequest,
    now: Date,
  ): Promise<AuthenticatedIngressSource> {
    const policy = this.#policy,
      request = snapshotIngressRequest(policy, input);
    const deliveryId = request.headers["webhook-id"],
      timestamp = request.headers["webhook-timestamp"],
      signatures = request.headers["webhook-signature"];
    if (
      !deliveryId ||
      !/^[A-Za-z0-9_.:-]{1,128}$/u.test(deliveryId) ||
      !timestamp ||
      !/^[0-9]{10}$/u.test(timestamp) ||
      !signatures
    )
      throw new Error("GITLAB_INGRESS_SIGNATURE_REQUIRED");
    const occurredAt = new Date(Number(timestamp) * 1000).toISOString();
    assertOriginalFreshness(policy, occurredAt, undefined, now);
    const message = Buffer.concat([Buffer.from(`${deliveryId}.${timestamp}.`), request.rawBody]);
    const candidates = signatures.split(/\s+/u).flatMap((signature) => {
      const match = /^v1,([A-Za-z0-9+/]{43}=)$/u.exec(signature);
      if (!match) return [];
      const bytes = Buffer.from(match[1]!, "base64");
      return bytes.length === 32 && bytes.toString("base64") === match[1]
        ? [bytes.toString("hex")]
        : [];
    });
    if (candidates.length === 0 || candidates.length > 3)
      throw new Error("GITLAB_INGRESS_SIGNATURE_INVALID");
    for (const signature of candidates) {
      try {
        return await this.keys.verifyAndUse(message, signature, now, (sourceKeyRef, secret) => {
          const verified = verifyAndNormalizeGitLabWebhook({
            rawBody: request.rawBody,
            contentType: request.contentType,
            headers: {
              webhookId: deliveryId,
              webhookTimestamp: timestamp,
              webhookSignature: signatures,
            },
            secret,
            receivedAt: now.toISOString(),
            route: {
              connectionId: policy.subject.connectionRef.id,
              workspaceId: policy.subject.workspaceId,
              projectId: policy.subject.projectId,
              numericProjectId: Number(policy.subject.externalScopeId),
            },
            policy: {
              verificationMode: "STANDARD_WEBHOOKS_HMAC_SHA256",
              maxRawBytes: policy.maxRawBytes,
              freshnessSeconds: policy.freshnessSeconds,
              dedupeHorizonSeconds: policy.retryHorizonSeconds,
              eventKinds: ["PIPELINE_HOOK", "JOB_HOOK"],
            },
          });
          if (!verified.normalized) throw new Error("GITLAB_INGRESS_NORMALIZATION_REQUIRED");
          return freezePilotValue({
            bodyHash: verified.bodyHash,
            semanticId: deliveryId,
            occurredAt,
            sourceIdentity: policy.sourceIdentity,
            sourceKeyRef,
            signal: {
              schemaVersion: "gitlab-authoritative-read-request@1.0.0",
              profileRef: policy.subject.profileRef,
              connectionRef: policy.subject.connectionRef,
              signal: verified.normalized,
            } as unknown as JsonValue,
          });
        });
      } catch (error) {
        if (!(error instanceof Error) || error.message !== "INGRESS_SIGNATURE_INVALID") throw error;
      }
    }
    throw new Error("GITLAB_INGRESS_SIGNATURE_INVALID");
  }
}
