import { createHmac, randomUUID } from "node:crypto";

import {
  ingressConfigurationHash,
  type ProviderConformanceRecord,
  type ProviderIngressPolicy,
  type ProviderIngressSubject,
} from "../../packages/runtime-composition/src/pilot/provider-conformance.ts";
import {
  IngressHmacKeys,
  type ProviderIngressRequest,
} from "../../packages/runtime-composition/src/pilot/trusted-ingress.ts";

export function ingressFixture(
  provider: ProviderIngressSubject["provider"] = "JIRA",
  now = new Date("2026-09-04T12:00:00Z"),
) {
  const ref = (id = randomUUID()) => ({
    id,
    version: 1,
    contentHash: `sha256:${"a".repeat(64)}` as const,
  });
  const connectionRef = { ...ref(), contentHash: ingressConfigurationHash({}) };
  const profileRef = { ...ref(), contentHash: ingressConfigurationHash({ connectionRef }) };
  const bindingRef = {
    ...ref(),
    contentHash: ingressConfigurationHash({ entries: [{ profileRef }] }),
  };
  const subject: ProviderIngressSubject = {
    workspaceId: randomUUID(),
    projectId: randomUUID(),
    bindingRef,
    profileRef,
    connectionRef,
    provider,
    edition: provider === "JIRA" ? "Cloud" : provider === "GITLAB" ? "EE" : "Team",
    providerVersion: provider === "GITLAB" ? "19.1.2" : "fixture-2026-09-04",
    ingressDialect:
      provider === "JIRA"
        ? "JIRA_CLOUD_BODY_HMAC"
        : provider === "GITLAB"
          ? "GITLAB_STANDARD_WEBHOOKS"
          : "MATTERMOST_SIGNED_PROXY_INTENT",
    externalScopeId: provider === "GITLAB" ? "5001" : "100",
    mode: "DEVELOPMENT_MOCK",
  };
  const record: Omit<ProviderConformanceRecord, "contentHash"> = {
    id: randomUUID(),
    version: 1,
    schemaVersion: 1,
    subject,
    evidenceRef: ref(),
    evidenceKind: "DEVELOPMENT_MOCK",
    observedAt: new Date(now.getTime() - 1000).toISOString(),
    validUntil: new Date(now.getTime() + 3600000).toISOString(),
    guarantees: {
      rawBodyIntegrity: true,
      originalFreshness:
        provider === "JIRA"
          ? "SIGNED_BODY_TIMESTAMP"
          : provider === "GITLAB"
            ? "SIGNED_WEBHOOK_TIMESTAMP"
            : "ORIGINAL_INTENT",
      replayIdentity:
        provider === "JIRA"
          ? "BODY_HASH_AND_DELIVERY"
          : provider === "GITLAB"
            ? "SIGNED_DELIVERY"
            : "ONE_USE_INTENT",
    },
  };
  const conformance: ProviderConformanceRecord = {
    ...record,
    contentHash: ingressConfigurationHash(record),
  };
  const key = (role: "ACTIVE" | "OVERLAP") => ({
    ref: ref(),
    role,
    notBefore: new Date(now.getTime() - 3600000).toISOString(),
    verifyUntil: new Date(now.getTime() + (role === "ACTIVE" ? 3600000 : 60000)).toISOString(),
  });
  const policy: ProviderIngressPolicy = {
    schemaVersion: 1,
    subject,
    conformanceRef: { id: record.id, version: 1, contentHash: conformance.contentHash },
    route: `/api/v1/pilot/ingress/${provider.toLowerCase()}`,
    sourceIdentity: `${provider.toLowerCase()}:fixture`,
    transport: "TRUSTED_PROXY",
    maxRawBytes: 262144,
    freshnessSeconds: 300,
    maximumClockSkewSeconds: 30,
    retryHorizonSeconds: 86400,
    receiptRetentionSeconds: 90000,
    sourceKeys: [key("ACTIVE"), key("OVERLAP")],
    proxyKeys: [key("ACTIVE"), key("OVERLAP")],
  };
  const sourceSecret = new TextEncoder().encode("fixture-source-secret-at-least-32-bytes"),
    proxySecret = new TextEncoder().encode("fixture-proxy-secret-at-least-32-bytes");
  const sourceKeys = new IngressHmacKeys(policy, policy.sourceKeys, {
    use: async (_ref, consume) => consume(sourceSecret),
  });
  const proxyKeys = new IngressHmacKeys(policy, policy.proxyKeys, {
    use: async (_ref, consume) => consume(proxySecret),
  });
  const bodyValue =
    provider === "GITLAB"
      ? {
          object_kind: "pipeline",
          project: { id: 5001 },
          object_attributes: {
            id: 201,
            status: "pending",
            sha: "a".repeat(40),
            updated_at: now.toISOString(),
          },
        }
      : { timestamp: now.getTime(), issue: { id: "10001", fields: { project: { id: "100" } } } };
  const body = new TextEncoder().encode(JSON.stringify(bodyValue));
  const request = (patch: Record<string, unknown> = {}): ProviderIngressRequest => {
    const rawBody = new TextEncoder().encode(JSON.stringify({ ...bodyValue, ...patch }));
    const timestamp = String(Math.floor(now.getTime() / 1000));
    const headers =
      provider === "GITLAB"
        ? {
            "webhook-id": "delivery-1",
            "webhook-timestamp": timestamp,
            "webhook-signature": `v1,${createHmac("sha256", sourceSecret).update(`delivery-1.${timestamp}.`).update(rawBody).digest("base64")}`,
          }
        : {
            "x-hub-signature": `sha256=${createHmac("sha256", sourceSecret).update(rawBody).digest("hex")}`,
            "x-atlassian-webhook-identifier": "delivery-1",
          };
    return {
      route: policy.route,
      method: "POST",
      contentType: "application/json",
      rawBody,
      headers,
    };
  };
  const authority = { verifyEvidence: async () => true, assertCurrent: async () => {} };
  return {
    now,
    policy,
    conformance,
    sourceSecret,
    proxySecret,
    sourceKeys,
    proxyKeys,
    body,
    request,
    authority,
  };
}
