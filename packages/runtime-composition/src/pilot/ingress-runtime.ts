import { createHash } from "node:crypto";

import type { DataSource, EntityManager } from "typeorm";

import { freezePilotValue } from "@awp/platform-core";

import {
  assertIngressPolicy,
  ingressConfigurationHash,
  type ProviderConformanceRecord,
  type ProviderIngressAuthority,
  type ProviderIngressPolicy,
  selectProviderConformance,
} from "./provider-conformance.ts";
import {
  assertAuthenticatedIngressProof,
  type AuthenticatedIngressSource,
  type IngressSourceAuthenticator,
  type ProviderIngressRequest,
  snapshotIngressRequest,
  type TrustedIngressAdapter,
  type TrustedIngressEnvelope,
} from "./trusted-ingress.ts";

export interface TransactionalIngressSource extends IngressSourceAuthenticator {
  /** Revalidates current human/intent authority and consumes it in the receipt/outbox transaction. */
  finalize(
    manager: EntityManager,
    request: ProviderIngressRequest,
    proof: AuthenticatedIngressSource,
    receiptId: string,
    now: Date,
  ): Promise<void>;
}
const receiptIdFor = (key: string, semanticId: string): string => {
  const hex = createHash("sha256")
    .update(JSON.stringify([key, semanticId]))
    .digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};
export class ProviderIngressRuntime {
  readonly policy: ProviderIngressPolicy;
  readonly #conformance: ProviderConformanceRecord;
  constructor(
    private readonly database: DataSource,
    policy: ProviderIngressPolicy,
    conformance: ProviderConformanceRecord,
    private readonly authority: ProviderIngressAuthority,
    private readonly source: IngressSourceAuthenticator | TransactionalIngressSource,
    private readonly proxy: TrustedIngressAdapter,
    private readonly clock: () => Date = () => new Date(),
  ) {
    assertIngressPolicy(policy);
    this.policy = freezePilotValue(structuredClone(policy));
    this.#conformance = freezePilotValue(structuredClone(conformance));
    if (policy.subject.provider === "MATTERMOST" && !("finalize" in source))
      throw new Error("INGRESS_INTENT_TRANSACTION_REQUIRED");
  }
  async attest(input: ProviderIngressRequest): Promise<TrustedIngressEnvelope> {
    const request = snapshotIngressRequest(this.policy, input),
      now = this.now();
    await selectProviderConformance(this.policy, this.#conformance, this.authority, now);
    const result = await this.proxy.attest(request, now);
    await selectProviderConformance(this.policy, this.#conformance, this.authority, this.now());
    return result;
  }
  async initialize(): Promise<void> {
    await selectProviderConformance(this.policy, this.#conformance, this.authority, this.now());
  }
  async accept(
    input: ProviderIngressRequest,
    supplied?: TrustedIngressEnvelope,
  ): Promise<Readonly<{ status: "ACCEPTED" | "DUPLICATE"; receiptId: string }>> {
    const policy = this.policy,
      request = snapshotIngressRequest(policy, input),
      envelope = supplied ? structuredClone(supplied) : undefined,
      now = this.now();
    await selectProviderConformance(policy, this.#conformance, this.authority, now);
    if (policy.transport === "TRUSTED_PROXY" && !envelope)
      throw new Error("INGRESS_PROXY_REQUIRED");
    if (policy.transport === "NATIVE" && envelope) throw new Error("INGRESS_UNEXPECTED_PROXY");
    const proof =
      policy.transport === "NATIVE"
        ? await this.source.authenticate(request, now)
        : await this.proxy.verify(request, envelope!, now);
    assertAuthenticatedIngressProof(policy, request, proof, now);
    const subject = policy.subject;
    const key = `pilot:${subject.provider}:${subject.workspaceId}:${subject.projectId}:${subject.connectionRef.id}`;
    const semanticIdentity = `semantic:${proof.semanticId}`,
      identities = [
        semanticIdentity,
        ...(proof.deliveryAlias ? [`delivery:${proof.deliveryAlias}`] : []),
      ];
    const receiptId = receiptIdFor(key, proof.semanticId);
    return this.database.transaction(async (manager) => {
      await manager.query("SET LOCAL statement_timeout='5s'");
      await manager.query("SET LOCAL lock_timeout='5s'");
      // Serialize all aliases for this scoped connection. Separate SELECT after
      // the lock sees commits by waiters under READ COMMITTED (no CTE race).
      await manager.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [key]);
      const at = this.now();
      await selectProviderConformance(policy, this.#conformance, this.authority, at, manager);
      assertAuthenticatedIngressProof(policy, request, proof, at);
      const existing = (await manager.query(
        "SELECT delivery_id,body_hash FROM webhook_receipts WHERE connector_key=$1 AND delivery_id=ANY($2::text[])",
        [key, identities],
      )) as Array<{ delivery_id: string; body_hash: string }>;
      if (existing.some((row) => row.body_hash !== proof.bodyHash))
        throw new Error("INGRESS_DELIVERY_BODY_CONFLICT");
      const duplicate = existing.some((row) => row.delivery_id === semanticIdentity);
      if ("finalize" in this.source)
        await this.source.finalize(manager, request, proof, receiptId, at);
      for (const identity of identities) {
        if (existing.some((row) => row.delivery_id === identity)) continue;
        await manager.query(
          `INSERT INTO webhook_receipts(connector_key,delivery_id,body_hash,received_at,raw_body,content_type,body_size,verification_result,secret_key_version,retention_until)
VALUES($1,$2,$3,$4,$5,$6,$7,'SIGNATURE_VERIFIED',$8,$9)`,
          [
            key,
            identity,
            proof.bodyHash,
            at,
            subject.provider === "MATTERMOST" ? Buffer.alloc(0) : Buffer.from(request.rawBody),
            request.contentType,
            request.rawBody.byteLength,
            `${proof.sourceKeyRef.id}:${proof.sourceKeyRef.version}`,
            new Date(at.getTime() + policy.receiptRetentionSeconds * 1000),
          ],
        );
      }
      if (!duplicate) {
        const eventType =
          subject.provider === "JIRA"
            ? "jira.authoritative-read.requested.v1"
            : subject.provider === "GITLAB"
              ? "gitlab.authoritative-read.requested.v1"
              : "mattermost.intent.received.v1";
        const body = { ...(proof.signal as object), receiptId, sourceKind: "WEBHOOK_HINT" };
        await manager.query(
          "INSERT INTO event_outbox(id,workspace_id,project_id,event_type,envelope,envelope_hash,state,created_at) VALUES($1,$2,$3,$4,$5::jsonb,$6,'READY',$7)",
          [
            receiptId,
            subject.workspaceId,
            subject.projectId,
            eventType,
            JSON.stringify(body),
            ingressConfigurationHash(body),
            at,
          ],
        );
      }
      return Object.freeze({
        status: duplicate ? ("DUPLICATE" as const) : ("ACCEPTED" as const),
        receiptId,
      });
    });
  }
  private now(): Date {
    return new Date(this.clock());
  }
}
