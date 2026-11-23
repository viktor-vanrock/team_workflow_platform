import type { DataSource, EntityManager } from "typeorm";

import { type JsonValue, sha256 } from "@awp/platform-contracts";
import {
  assertExactRevisionRef,
  assertProjectScope,
  type ExactRevisionRef,
  freezePilotValue,
} from "@awp/platform-core";

export type PilotIngressDialect =
  | "JIRA_CLOUD_BODY_HMAC"
  | "JIRA_DC_BODY_HMAC"
  | "GITLAB_STANDARD_WEBHOOKS"
  | "MATTERMOST_SIGNED_PROXY_INTENT";
export interface ProviderIngressSubject {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly bindingRef: ExactRevisionRef;
  readonly profileRef: ExactRevisionRef;
  readonly connectionRef: ExactRevisionRef;
  readonly provider: "JIRA" | "GITLAB" | "MATTERMOST";
  readonly edition: string;
  readonly providerVersion: string;
  readonly ingressDialect: PilotIngressDialect;
  readonly externalScopeId: string;
  readonly mode: "CORPORATE" | "DEVELOPMENT_MOCK";
}
export interface IngressKeyVersion {
  readonly ref: ExactRevisionRef;
  readonly role: "ACTIVE" | "OVERLAP";
  readonly notBefore: string;
  readonly verifyUntil: string;
}
export interface ProviderIngressPolicy {
  readonly schemaVersion: 1;
  readonly subject: ProviderIngressSubject;
  readonly conformanceRef: ExactRevisionRef;
  readonly route: string;
  readonly sourceIdentity: string;
  readonly transport: "NATIVE" | "TRUSTED_PROXY";
  readonly maxRawBytes: number;
  readonly freshnessSeconds: number;
  readonly maximumClockSkewSeconds: number;
  readonly retryHorizonSeconds: number;
  readonly receiptRetentionSeconds: number;
  readonly sourceKeys: readonly IngressKeyVersion[];
  readonly proxyKeys: readonly IngressKeyVersion[];
}
export interface ProviderConformanceRecord {
  readonly id: string;
  readonly version: number;
  readonly schemaVersion: 1;
  readonly subject: ProviderIngressSubject;
  readonly evidenceRef: ExactRevisionRef;
  readonly evidenceKind: "INSTALLED_PROVIDER" | "DEVELOPMENT_MOCK";
  readonly observedAt: string;
  readonly validUntil: string;
  readonly guarantees: Readonly<{
    rawBodyIntegrity: true;
    originalFreshness: "SIGNED_BODY_TIMESTAMP" | "SIGNED_WEBHOOK_TIMESTAMP" | "ORIGINAL_INTENT";
    replayIdentity: "BODY_HASH_AND_DELIVERY" | "SIGNED_DELIVERY" | "ONE_USE_INTENT";
  }>;
  readonly contentHash: `sha256:${string}`;
}
/** Installed evidence verification and current Core pins are supplied by the host;
 * neither a request header nor provider self-description grants conformance. */
export interface ProviderIngressAuthority {
  verifyEvidence(record: ProviderConformanceRecord): Promise<boolean>;
  assertCurrent(policy: ProviderIngressPolicy, manager?: EntityManager): Promise<void>;
}
export const ingressConfigurationHash = (value: unknown): `sha256:${string}` =>
  sha256(value as JsonValue);
const invalid = () => new Error("PROVIDER_INGRESS_POLICY_INVALID");
export function assertIngressPolicy(policy: ProviderIngressPolicy): void {
  try {
    assertProjectScope(policy.subject);
    [
      policy.subject.bindingRef,
      policy.subject.profileRef,
      policy.subject.connectionRef,
      policy.conformanceRef,
    ].forEach(assertExactRevisionRef);
    const subject = policy.subject;
    const dialects =
      subject.provider === "JIRA"
        ? ["JIRA_CLOUD_BODY_HMAC", "JIRA_DC_BODY_HMAC"]
        : subject.provider === "GITLAB"
          ? ["GITLAB_STANDARD_WEBHOOKS"]
          : subject.provider === "MATTERMOST"
            ? ["MATTERMOST_SIGNED_PROXY_INTENT"]
            : [];
    if (
      policy.schemaVersion !== 1 ||
      !dialects.includes(subject.ingressDialect) ||
      !["CORPORATE", "DEVELOPMENT_MOCK"].includes(subject.mode) ||
      !subject.edition ||
      subject.edition.length > 128 ||
      !subject.providerVersion ||
      subject.providerVersion.length > 128 ||
      /unknown|latest|\*/iu.test(subject.providerVersion) ||
      !/^[A-Za-z0-9_.:-]{1,256}$/u.test(subject.externalScopeId) ||
      !/^[A-Za-z0-9_.:/-]{1,256}$/u.test(policy.sourceIdentity) ||
      !/^\/api\/v1\/pilot\/ingress\/[A-Za-z0-9_-]{1,128}$/u.test(policy.route) ||
      !["NATIVE", "TRUSTED_PROXY"].includes(policy.transport) ||
      (subject.provider === "MATTERMOST" && policy.transport !== "TRUSTED_PROXY")
    )
      throw invalid();
    for (const [value, min, max] of [
      [policy.maxRawBytes, 1, 1_048_576],
      [policy.freshnessSeconds, 1, 3600],
      [policy.maximumClockSkewSeconds, 0, 300],
      [policy.retryHorizonSeconds, 1, 604800],
      [policy.receiptRetentionSeconds, 1, 2592000],
    ])
      if (!Number.isSafeInteger(value) || value! < min! || value! > max!) throw invalid();
    if (
      policy.receiptRetentionSeconds <
      Math.max(policy.retryHorizonSeconds, policy.freshnessSeconds) + policy.maximumClockSkewSeconds
    )
      throw invalid();
    for (const input of [policy.sourceKeys, policy.proxyKeys]) {
      if (!Array.isArray(input)) throw invalid();
      const keys: readonly IngressKeyVersion[] = input as readonly IngressKeyVersion[];
      if (keys.length > 3 || keys.filter((key) => key.role === "ACTIVE").length !== 1)
        throw invalid();
      const refs = new Set<string>();
      for (const key of keys) {
        assertExactRevisionRef(key.ref);
        const id = `${key.ref.id}:${key.ref.version}`;
        if (
          refs.has(id) ||
          !["ACTIVE", "OVERLAP"].includes(key.role) ||
          !Number.isFinite(Date.parse(key.notBefore)) ||
          !Number.isFinite(Date.parse(key.verifyUntil)) ||
          Date.parse(key.verifyUntil) <= Date.parse(key.notBefore)
        )
          throw invalid();
        refs.add(id);
      }
    }
  } catch {
    throw invalid();
  }
}
export async function selectProviderConformance(
  policy: ProviderIngressPolicy,
  supplied: ProviderConformanceRecord,
  authority: ProviderIngressAuthority,
  now: Date,
  manager?: EntityManager,
): Promise<ProviderConformanceRecord> {
  assertIngressPolicy(policy);
  const record = freezePilotValue(structuredClone(supplied));
  const { contentHash, ...body } = record;
  const expected = policy.conformanceRef,
    guarantee = record.guarantees;
  const freshness =
    policy.subject.provider === "JIRA"
      ? "SIGNED_BODY_TIMESTAMP"
      : policy.subject.provider === "GITLAB"
        ? "SIGNED_WEBHOOK_TIMESTAMP"
        : "ORIGINAL_INTENT";
  const replay =
    policy.subject.provider === "JIRA"
      ? "BODY_HASH_AND_DELIVERY"
      : policy.subject.provider === "GITLAB"
        ? "SIGNED_DELIVERY"
        : "ONE_USE_INTENT";
  if (
    record.id !== expected.id ||
    record.version !== expected.version ||
    record.schemaVersion !== 1 ||
    contentHash !== expected.contentHash ||
    ingressConfigurationHash(body) !== contentHash ||
    ingressConfigurationHash(record.subject) !== ingressConfigurationHash(policy.subject) ||
    !Object.is(guarantee?.rawBodyIntegrity, true) ||
    guarantee.originalFreshness !== freshness ||
    guarantee.replayIdentity !== replay ||
    !["INSTALLED_PROVIDER", "DEVELOPMENT_MOCK"].includes(record.evidenceKind) ||
    (policy.subject.mode === "CORPORATE" && record.evidenceKind !== "INSTALLED_PROVIDER") ||
    !Number.isFinite(now.getTime()) ||
    !Number.isFinite(Date.parse(record.observedAt)) ||
    !Number.isFinite(Date.parse(record.validUntil)) ||
    Date.parse(record.observedAt) > now.getTime() ||
    Date.parse(record.validUntil) <= now.getTime()
  )
    throw new Error("PROVIDER_CONFORMANCE_REQUIRED");
  assertExactRevisionRef(record.evidenceRef);
  if (!(await authority.verifyEvidence(record)))
    throw new Error("PROVIDER_CONFORMANCE_EVIDENCE_INVALID");
  await authority.assertCurrent(policy, manager);
  return record;
}

/** The evidence port verifies installed observations (or explicit development
 * fixtures). The access port checks current Core service grants. Neither is
 * replaceable by a provider header. Current heads stay locked until commit. */
export class TypeOrmProviderIngressAuthority implements ProviderIngressAuthority {
  constructor(
    private readonly database: DataSource,
    private readonly evidence: (record: ProviderConformanceRecord) => Promise<boolean>,
    private readonly access: (
      policy: ProviderIngressPolicy,
      manager: EntityManager,
    ) => Promise<void>,
  ) {}
  verifyEvidence(record: ProviderConformanceRecord): Promise<boolean> {
    return this.evidence(record);
  }
  async assertCurrent(policy: ProviderIngressPolicy, transaction?: EntityManager): Promise<void> {
    const check = async (manager: EntityManager) => {
      const {
        workspaceId,
        projectId,
        bindingRef: b,
        profileRef: p,
        connectionRef: c,
      } = policy.subject;
      await this.access(policy, manager);
      const rows = (await manager.query(
        `SELECT b.content AS binding_body,p.content AS profile_body,c.content AS connection_body FROM project_integration_binding_revisions b
JOIN project_integration_binding_headers bh ON bh.workspace_id=b.workspace_id AND bh.project_id=b.project_id AND bh.id=b.header_id AND bh.current_published_version=b.version
JOIN connector_profile_revisions p ON p.workspace_id=b.workspace_id AND p.header_id=$6 AND p.version=$7 AND p.content_hash=$8 AND p.status='PUBLISHED'
JOIN connector_profile_headers ph ON ph.workspace_id=p.workspace_id AND ph.id=p.header_id AND ph.current_published_version=p.version
JOIN connection_revisions c ON c.workspace_id=b.workspace_id AND c.header_id=$9 AND c.version=$10 AND c.content_hash=$11 AND c.status='PUBLISHED'
JOIN connection_headers ch ON ch.workspace_id=c.workspace_id AND ch.id=c.header_id AND ch.current_published_version=c.version
WHERE b.workspace_id=$1 AND b.project_id=$2 AND b.header_id=$3 AND b.version=$4 AND b.content_hash=$5 AND b.status='PUBLISHED'
AND EXISTS(SELECT 1 FROM jsonb_array_elements(b.content->'entries') e WHERE e->'profileRef' @> $12::jsonb)
AND p.content->'connectionRef' @> $13::jsonb FOR SHARE OF b,bh,p,ph,c,ch`,
        [
          workspaceId,
          projectId,
          b.id,
          b.version,
          b.contentHash,
          p.id,
          p.version,
          p.contentHash,
          c.id,
          c.version,
          c.contentHash,
          JSON.stringify({ id: p.id, version: p.version }),
          JSON.stringify({ id: c.id, version: c.version }),
        ],
      )) as Array<{ binding_body: unknown; profile_body: unknown; connection_body: unknown }>;
      const row = rows[0];
      if (
        rows.length !== 1 ||
        !row ||
        ingressConfigurationHash(row.binding_body) !== b.contentHash ||
        ingressConfigurationHash(row.profile_body) !== p.contentHash ||
        ingressConfigurationHash(row.connection_body) !== c.contentHash
      )
        throw new Error("INGRESS_CURRENT_BINDING_REQUIRED");
    };
    if (transaction) await check(transaction);
    else await this.database.transaction(check);
  }
}
