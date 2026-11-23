import { normalizeJiraWebhook } from "@awp/connector-jira";
import type { JsonValue } from "@awp/platform-contracts";
import { freezePilotValue } from "@awp/platform-core";

import { assertIngressPolicy, type ProviderIngressPolicy } from "../pilot/provider-conformance.ts";
import {
  assertOriginalFreshness,
  type AuthenticatedIngressSource,
  type IngressHmacKeys,
  ingressRawHash,
  type IngressSourceAuthenticator,
  type ProviderIngressRequest,
  snapshotIngressRequest,
} from "../pilot/trusted-ingress.ts";

/** Selected Cloud/DC body-HMAC dialect with an authenticated body timestamp.
 * Delivery headers are aliases, never the semantic identity of signed bytes. */
export class JiraNativeIngressSource implements IngressSourceAuthenticator {
  readonly #policy: ProviderIngressPolicy;
  constructor(
    policy: ProviderIngressPolicy,
    private readonly keys: IngressHmacKeys,
  ) {
    assertIngressPolicy(policy);
    if (policy.subject.provider !== "JIRA") throw new Error("JIRA_INGRESS_DIALECT_REQUIRED");
    this.#policy = freezePilotValue(structuredClone(policy));
  }
  async authenticate(
    input: ProviderIngressRequest,
    now: Date,
  ): Promise<AuthenticatedIngressSource> {
    const policy = this.#policy,
      request = snapshotIngressRequest(policy, input);
    const signature = request.headers["x-hub-signature"];
    if (!signature?.startsWith("sha256=")) throw new Error("JIRA_INGRESS_SIGNATURE_REQUIRED");
    const sourceKeyRef = await this.keys.verify(request.rawBody, signature.slice(7), now);
    const event = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(request.rawBody),
    ) as Record<string, unknown>;
    if (
      !event ||
      typeof event !== "object" ||
      Array.isArray(event) ||
      !Number.isSafeInteger(event.timestamp)
    )
      throw new Error("JIRA_INGRESS_AUTHENTICATED_TIME_REQUIRED");
    const occurredAt = new Date(event.timestamp as number).toISOString();
    assertOriginalFreshness(policy, occurredAt, undefined, now);
    const issue = event.issue as
      { id?: unknown; fields?: { project?: { id?: unknown } } } | undefined;
    if (
      typeof issue?.id !== "string" ||
      !/^[A-Za-z0-9_-]{1,128}$/u.test(issue.id) ||
      issue.fields?.project?.id !== policy.subject.externalScopeId
    )
      throw new Error("JIRA_INGRESS_PROJECT_DENIED");
    const bodyHash = ingressRawHash(request.rawBody),
      semanticId = bodyHash;
    const normalized = normalizeJiraWebhook({
      connectionId: policy.subject.connectionRef.id,
      canonicalBodyHash: bodyHash,
      deliveryId: semanticId,
      event,
    });
    const alias = request.headers["x-atlassian-webhook-identifier"];
    if (alias !== undefined && !/^[A-Za-z0-9_.:-]{1,128}$/u.test(alias))
      throw new Error("JIRA_INGRESS_DELIVERY_INVALID");
    return freezePilotValue({
      sourceIdentity: policy.sourceIdentity,
      bodyHash,
      semanticId,
      ...(alias ? { deliveryAlias: alias } : {}),
      occurredAt,
      sourceKeyRef,
      signal: {
        connectionId: normalized.connectionId,
        externalEntityId: normalized.externalEntityId,
        receiptIdentity: semanticId,
        source: "WEBHOOK_READ",
      } as JsonValue,
    });
  }
}
