import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { TLSSocket } from "node:tls";

import { canonicalize, type JsonValue } from "@awp/platform-contracts";
import { type ExactRevisionRef, freezePilotValue } from "@awp/platform-core";

import {
  assertIngressPolicy,
  ingressConfigurationHash,
  type IngressKeyVersion,
  type ProviderIngressPolicy,
} from "./provider-conformance.ts";

export const ingressRawHash = (value: Uint8Array | string): string =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
export interface ProviderIngressRequest {
  readonly route: string;
  readonly method: string;
  readonly contentType: string;
  readonly rawBody: Uint8Array;
  readonly headers: Readonly<Record<string, string | undefined>>;
}
export interface AuthenticatedIngressSource {
  readonly bodyHash: string;
  readonly semanticId: string;
  readonly deliveryAlias?: string;
  readonly occurredAt: string;
  readonly expiresAt?: string;
  readonly sourceIdentity: string;
  readonly signal: JsonValue;
  readonly sourceKeyRef: ExactRevisionRef;
}
export interface IngressSourceAuthenticator {
  authenticate(request: ProviderIngressRequest, now: Date): Promise<AuthenticatedIngressSource>;
}
export interface IngressSecretUse {
  use<T>(ref: ExactRevisionRef, consume: (key: Uint8Array) => T | Promise<T>): Promise<T>;
}
// Transport evidence never comes from forwarded headers or from JSON. A host
// terminating TLS binds the verified peer from the actual Node connection.
const peers = new WeakMap<ProviderIngressRequest, string>();
export function bindIngressTlsPeer(request: ProviderIngressRequest, socket: unknown): void {
  if (!(socket instanceof TLSSocket) || !socket.authorized) return;
  const certificate = socket.getPeerCertificate();
  if (certificate.raw?.byteLength) peers.set(request, ingressRawHash(certificate.raw));
}
export function authenticatedIngressTlsKey(
  policy: ProviderIngressPolicy,
  request: ProviderIngressRequest,
  now: Date,
): ExactRevisionRef {
  const fingerprint = peers.get(request);
  const key = policy.sourceKeys.find(
    (value) =>
      value.ref.contentHash === fingerprint &&
      Date.parse(value.notBefore) <= now.getTime() &&
      Date.parse(value.verifyUntil) > now.getTime(),
  );
  if (!key) throw new Error("INGRESS_SOURCE_MTLS_REQUIRED");
  return key.ref;
}
export function snapshotIngressRequest(
  policy: ProviderIngressPolicy,
  input: ProviderIngressRequest,
): ProviderIngressRequest {
  if (
    input.route !== policy.route ||
    input.method !== "POST" ||
    !/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(input.contentType.trim()) ||
    !(input.rawBody instanceof Uint8Array) ||
    input.rawBody.byteLength < 1 ||
    input.rawBody.byteLength > policy.maxRawBytes
  )
    throw new Error("INGRESS_REQUEST_DENIED");
  const headers: Record<string, string | undefined> = {};
  if (Object.keys(input.headers).length > 100) throw new Error("INGRESS_HEADERS_INVALID");
  for (const [key, value] of Object.entries(input.headers)) {
    const normalized = key.toLowerCase();
    if (
      Object.hasOwn(headers, normalized) ||
      (value !== undefined &&
        (typeof value !== "string" || value.length > 32768 || /[\r\n]/u.test(value)))
    )
      throw new Error("INGRESS_HEADERS_INVALID");
    headers[normalized] = value;
  }
  const snapshot = {
    route: input.route,
    method: input.method,
    contentType: input.contentType,
    rawBody: new Uint8Array(input.rawBody),
    headers: Object.freeze(headers),
  };
  const peer = peers.get(input);
  if (peer) peers.set(snapshot, peer);
  return snapshot;
}
export function assertAuthenticatedIngressProof(
  policy: ProviderIngressPolicy,
  request: ProviderIngressRequest,
  proof: AuthenticatedIngressSource,
  now: Date,
): void {
  if (
    proof.sourceIdentity !== policy.sourceIdentity ||
    proof.bodyHash !== ingressRawHash(request.rawBody) ||
    !/^[A-Za-z0-9_.:-]{1,256}$/u.test(proof.semanticId) ||
    (proof.deliveryAlias !== undefined && !/^[A-Za-z0-9_.:-]{1,256}$/u.test(proof.deliveryAlias)) ||
    !policy.sourceKeys.some(
      (key) =>
        ingressConfigurationHash(key.ref) === ingressConfigurationHash(proof.sourceKeyRef) &&
        Date.parse(key.notBefore) <= now.getTime() &&
        Date.parse(key.verifyUntil) > now.getTime(),
    )
  )
    throw new Error("INGRESS_SOURCE_AUTHENTICATION_REQUIRED");
  assertOriginalFreshness(policy, proof.occurredAt, proof.expiresAt, now);
}
export function assertOriginalFreshness(
  policy: ProviderIngressPolicy,
  occurredAt: string,
  expiresAt: string | undefined,
  now: Date,
): void {
  const original = Date.parse(occurredAt),
    at = now.getTime();
  if (
    !Number.isFinite(at) ||
    !Number.isFinite(original) ||
    original > at + policy.maximumClockSkewSeconds * 1000 ||
    at - original > policy.freshnessSeconds * 1000 ||
    (expiresAt !== undefined &&
      (!Number.isFinite(Date.parse(expiresAt)) ||
        Date.parse(expiresAt) <= at ||
        Date.parse(expiresAt) <= original))
  )
    throw new Error("INGRESS_ORIGINAL_STALE");
}
export class IngressHmacKeys {
  readonly #keys: readonly IngressKeyVersion[];
  constructor(
    policy: ProviderIngressPolicy,
    keys: readonly IngressKeyVersion[],
    private readonly secrets: IngressSecretUse,
  ) {
    assertIngressPolicy(policy);
    if (
      ![policy.sourceKeys, policy.proxyKeys].some(
        (ring) => ingressConfigurationHash(ring) === ingressConfigurationHash(keys),
      )
    )
      throw new Error("INGRESS_KEY_RING_DENIED");
    this.#keys = freezePilotValue(structuredClone(keys));
  }
  active(now: Date): ExactRevisionRef {
    const keys = this.#keys.filter((key) => key.role === "ACTIVE" && this.eligible(key, now));
    if (keys.length !== 1) throw new Error("INGRESS_SIGNING_KEY_UNAVAILABLE");
    return keys[0]!.ref;
  }
  async sign(ref: ExactRevisionRef, bytes: Uint8Array, now: Date): Promise<string> {
    const key = this.#keys.find(
      (key) =>
        ingressConfigurationHash(key.ref) === ingressConfigurationHash(ref) &&
        this.eligible(key, now),
    );
    if (!key) throw new Error("INGRESS_KEY_VERSION_DENIED");
    return this.secrets.use(ref, (material) => {
      if (material.byteLength < 32 || material.byteLength > 4096)
        throw new Error("INGRESS_KEY_MATERIAL_INVALID");
      return createHmac("sha256", material).update(bytes).digest("hex");
    });
  }
  async verify(
    bytes: Uint8Array,
    signature: string,
    now: Date,
    exact?: ExactRevisionRef,
  ): Promise<ExactRevisionRef> {
    return this.verifyAndUse(bytes, signature, now, (ref) => ref, exact);
  }
  async verifyAndUse<T>(
    bytes: Uint8Array,
    signature: string,
    now: Date,
    consume: (ref: ExactRevisionRef, key: Uint8Array) => T | Promise<T>,
    exact?: ExactRevisionRef,
  ): Promise<T> {
    if (!/^[a-f0-9]{64}$/u.test(signature)) throw new Error("INGRESS_SIGNATURE_INVALID");
    const keys = this.#keys.filter(
      (key) =>
        this.eligible(key, now) &&
        (!exact || ingressConfigurationHash(key.ref) === ingressConfigurationHash(exact)),
    );
    for (const key of keys) {
      const result = await this.secrets.use(key.ref, async (material) => {
        if (material.byteLength < 32 || material.byteLength > 4096)
          throw new Error("INGRESS_KEY_MATERIAL_INVALID");
        const expected = createHmac("sha256", material).update(bytes).digest();
        if (!timingSafeEqual(Buffer.from(signature, "hex"), expected))
          return { matched: false as const };
        return { matched: true as const, value: await consume(key.ref, material) };
      });
      if (result.matched) return result.value;
    }
    throw new Error("INGRESS_SIGNATURE_INVALID");
  }
  private eligible(key: IngressKeyVersion, now: Date): boolean {
    return (
      Number.isFinite(now.getTime()) &&
      Date.parse(key.notBefore) <= now.getTime() &&
      now.getTime() < Date.parse(key.verifyUntil)
    );
  }
}
export interface TrustedIngressStatement {
  readonly schemaVersion: "trusted-ingress@1";
  readonly workspaceId: string;
  readonly projectId: string;
  readonly connectionId: string;
  readonly route: string;
  readonly method: "POST";
  readonly policyHash: string;
  readonly sourceIdentity: string;
  readonly bodyHash: string;
  readonly semanticId: string;
  readonly deliveryAlias?: string;
  readonly originalOccurredAt: string;
  readonly originalExpiresAt?: string;
  readonly signedAt: string;
  readonly signingKeyRef: ExactRevisionRef;
  readonly sourceKeyRef: ExactRevisionRef;
  readonly signal: JsonValue;
}
export interface TrustedIngressEnvelope {
  readonly statement: TrustedIngressStatement;
  readonly keyRef: ExactRevisionRef;
  readonly signature: string;
}

/** The only signing entry authenticates the original source first. The receiver
 * verifies the original event/intent lifetime independently of the proxy clock. */
export class TrustedIngressAdapter {
  readonly #policy: ProviderIngressPolicy;
  constructor(
    policy: ProviderIngressPolicy,
    private readonly source: IngressSourceAuthenticator,
    private readonly keys: IngressHmacKeys,
  ) {
    assertIngressPolicy(policy);
    this.#policy = freezePilotValue(structuredClone(policy));
  }
  async attest(input: ProviderIngressRequest, now: Date): Promise<TrustedIngressEnvelope> {
    const request = snapshotIngressRequest(this.#policy, input);
    now = new Date(now);
    const proof = await this.source.authenticate(request, now);
    this.assertProof(request, proof, now);
    const keyRef = this.keys.active(now),
      policy = this.#policy;
    const statement: TrustedIngressStatement = {
      schemaVersion: "trusted-ingress@1",
      workspaceId: policy.subject.workspaceId,
      projectId: policy.subject.projectId,
      connectionId: policy.subject.connectionRef.id,
      route: policy.route,
      method: "POST",
      policyHash: ingressConfigurationHash(policy),
      sourceIdentity: proof.sourceIdentity,
      bodyHash: proof.bodyHash,
      semanticId: proof.semanticId,
      ...(proof.deliveryAlias ? { deliveryAlias: proof.deliveryAlias } : {}),
      originalOccurredAt: proof.occurredAt,
      ...(proof.expiresAt ? { originalExpiresAt: proof.expiresAt } : {}),
      signedAt: now.toISOString(),
      signingKeyRef: keyRef,
      sourceKeyRef: proof.sourceKeyRef,
      signal: proof.signal,
    };
    const bytes = new TextEncoder().encode(canonicalize(statement as unknown as JsonValue));
    return freezePilotValue({
      statement,
      keyRef,
      signature: await this.keys.sign(keyRef, bytes, now),
    });
  }
  async verify(
    input: ProviderIngressRequest,
    supplied: TrustedIngressEnvelope,
    now: Date,
  ): Promise<AuthenticatedIngressSource> {
    const request = snapshotIngressRequest(this.#policy, input);
    const envelope = freezePilotValue(structuredClone(supplied));
    if (JSON.stringify(envelope).length > this.#policy.maxRawBytes * 2 + 8192)
      throw new Error("INGRESS_ENVELOPE_TOO_LARGE");
    const value = envelope.statement,
      policy = this.#policy;
    if (
      !value ||
      value.schemaVersion !== "trusted-ingress@1" ||
      value.workspaceId !== policy.subject.workspaceId ||
      value.projectId !== policy.subject.projectId ||
      value.connectionId !== policy.subject.connectionRef.id ||
      value.route !== policy.route ||
      value.method !== "POST" ||
      value.policyHash !== ingressConfigurationHash(policy) ||
      ingressConfigurationHash(value.signingKeyRef) !== ingressConfigurationHash(envelope.keyRef) ||
      !Number.isFinite(Date.parse(value.signedAt)) ||
      Math.abs(now.getTime() - Date.parse(value.signedAt)) > policy.maximumClockSkewSeconds * 1000
    )
      throw new Error("INGRESS_ENVELOPE_DENIED");
    await this.keys.verify(
      new TextEncoder().encode(canonicalize(value as unknown as JsonValue)),
      envelope.signature,
      now,
      envelope.keyRef,
    );
    const proof: AuthenticatedIngressSource = {
      bodyHash: value.bodyHash,
      semanticId: value.semanticId,
      ...(value.deliveryAlias ? { deliveryAlias: value.deliveryAlias } : {}),
      occurredAt: value.originalOccurredAt,
      ...(value.originalExpiresAt ? { expiresAt: value.originalExpiresAt } : {}),
      sourceIdentity: value.sourceIdentity,
      sourceKeyRef: value.sourceKeyRef,
      signal: value.signal,
    };
    this.assertProof(request, proof, now);
    return freezePilotValue(proof);
  }
  private assertProof(
    request: ProviderIngressRequest,
    proof: AuthenticatedIngressSource,
    now: Date,
  ): void {
    assertAuthenticatedIngressProof(this.#policy, request, proof, now);
  }
}
