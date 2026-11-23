import type { ConnectorSecretLease, SecretResolverPort } from "@awp/connector-sdk";
import {
  assertExactRevisionRef,
  type ExactRevisionRef,
  freezePilotValue,
  pilotContentHash,
  type ProjectScope,
} from "@awp/platform-core";

import { VaultHttpClient, vaultObject } from "./vault-http-client.ts";

export type VaultSecretPurpose =
  "CONNECTOR_READ" | "CONNECTOR_WRITE" | "CONNECTOR_WEBHOOK" | "TEST_ACCOUNT" | "ARTIFACT";
export interface VaultSecretUse extends ProjectScope {
  readonly servicePrincipalId: string;
  readonly purpose: VaultSecretPurpose;
  readonly profileRef: ExactRevisionRef;
  readonly connectionRef: ExactRevisionRef;
  readonly policyRef: ExactRevisionRef;
}
export interface VaultSecretMapping {
  readonly ref: ExactRevisionRef;
  readonly secretRef: string;
  readonly use: VaultSecretUse;
  readonly mount: string;
  readonly path: string;
  readonly field: string;
  readonly secretVersion: number;
  readonly maximumLeaseMs: number;
}
export interface VaultSecretAuthorization {
  authorize(
    use: VaultSecretUse,
    mapping: VaultSecretMapping,
    signal: AbortSignal,
  ): Promise<boolean>;
  /** Current local revocation/config projection, also checked synchronously when material is consumed. */
  isCurrent(use: VaultSecretUse, mapping: VaultSecretMapping): boolean;
}

export function secretAllowedUseHash(mapping: VaultSecretMapping): string {
  return pilotContentHash(mapping);
}

class SingleUseSecretLease implements ConnectorSecretLease {
  readonly #material: Uint8Array;
  readonly #expiresAt: number;
  readonly #signal: AbortSignal;
  readonly #isCurrent: () => boolean;
  readonly #clock: () => number;
  readonly #onAbort: () => void;
  readonly #timer: ReturnType<typeof setTimeout>;
  #closed = false;
  readonly metadata: Readonly<Record<string, unknown>>;
  constructor(
    material: Uint8Array,
    expiresAt: number,
    metadata: Readonly<Record<string, unknown>>,
    signal: AbortSignal,
    isCurrent: () => boolean,
    clock: () => number,
  ) {
    this.#material = material;
    this.#expiresAt = expiresAt;
    this.#signal = signal;
    this.#isCurrent = isCurrent;
    this.#clock = clock;
    this.metadata = freezePilotValue({ ...metadata, expiresAt: new Date(expiresAt).toISOString() });
    this.#onAbort = () => this.close();
    signal.addEventListener("abort", this.#onAbort, { once: true });
    this.#timer = setTimeout(() => this.close(), Math.max(0, expiresAt - clock()));
    this.#timer.unref();
    if (signal.aborted) this.close();
  }
  withMaterial<T>(now: Date, consume: (bytes: Uint8Array) => T): T {
    let current = false;
    try {
      current = this.#isCurrent();
    } catch {
      /* Revocation projection failure closes the lease. */
    }
    if (
      this.#closed ||
      this.#signal.aborted ||
      !Number.isFinite(now.getTime()) ||
      Math.max(now.getTime(), this.#clock()) >= this.#expiresAt ||
      !current
    ) {
      this.close();
      throw new Error("SECRET_LEASE_CLOSED");
    }
    // The existing port is synchronous. Transports construct their header/request inside this callback.
    try {
      return consume(this.#material);
    } finally {
      this.close();
    }
  }
  private close(): void {
    this.#closed = true;
    this.#material.fill(0);
    clearTimeout(this.#timer);
    this.#signal.removeEventListener("abort", this.#onAbort);
  }
}

export class VaultSecretResolver implements SecretResolverPort {
  readonly #use: VaultSecretUse;
  readonly #mappings = new Map<string, VaultSecretMapping>();
  constructor(
    private readonly client: VaultHttpClient,
    use: VaultSecretUse,
    mappings: readonly VaultSecretMapping[],
    private readonly authorization: VaultSecretAuthorization,
    private readonly clock: () => number = Date.now,
  ) {
    this.#use = freezePilotValue(structuredClone(use));
    if (
      !use.workspaceId ||
      !use.projectId ||
      !use.servicePrincipalId ||
      ![
        "CONNECTOR_READ",
        "CONNECTOR_WRITE",
        "CONNECTOR_WEBHOOK",
        "TEST_ACCOUNT",
        "ARTIFACT",
      ].includes(use.purpose)
    )
      throw new Error("SECRET_USE_DENIED");
    [use.profileRef, use.connectionRef, use.policyRef].forEach(assertExactRevisionRef);
    for (const input of mappings) {
      const mapping = freezePilotValue(structuredClone(input));
      assertExactRevisionRef(mapping.ref);
      if (
        pilotContentHash(mapping.use) !== pilotContentHash(use) ||
        this.#mappings.has(mapping.secretRef) ||
        !/^(?:secret-ref:[A-Za-z0-9][A-Za-z0-9/_-]{0,255}|secretref:\/\/[a-z0-9][a-z0-9._/-]{0,255})$/u.test(
          mapping.secretRef,
        ) ||
        !/^[A-Za-z0-9_-]+$/u.test(mapping.mount) ||
        !/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/u.test(mapping.path) ||
        !/^[A-Za-z0-9_-]+$/u.test(mapping.field) ||
        !Number.isSafeInteger(mapping.secretVersion) ||
        mapping.secretVersion < 1 ||
        !Number.isInteger(mapping.maximumLeaseMs) ||
        mapping.maximumLeaseMs < 1 ||
        mapping.maximumLeaseMs > 60_000
      )
        throw new Error("SECRET_MAPPING_INVALID");
      this.#mappings.set(mapping.secretRef, mapping);
    }
  }

  async resolve(
    secretRef: string,
    allowedUseHash: string,
    signal: AbortSignal,
  ): Promise<ConnectorSecretLease> {
    const mapping = this.#mappings.get(secretRef);
    if (!mapping || signal.aborted || secretAllowedUseHash(mapping) !== allowedUseHash)
      throw new Error("SECRET_USE_DENIED");
    let allowed = false;
    try {
      allowed = await this.authorization.authorize(this.#use, mapping, signal);
    } catch {
      /* No provider error escapes. */
    }
    if (!allowed || signal.aborted) throw new Error("SECRET_USE_DENIED");
    const received = await this.client.request(
      { ...this.#use, allowedUseHash },
      "GET",
      `/v1/${mapping.mount}/data/${mapping.path}?version=${mapping.secretVersion}`,
      undefined,
      signal,
    );
    const root = vaultObject(received.value);
    const data = vaultObject(root.data);
    const metadata = vaultObject(data.metadata);
    if (
      metadata.version !== mapping.secretVersion ||
      metadata.destroyed !== false ||
      metadata.deletion_time !== ""
    )
      throw new Error("SECRET_VERSION_UNAVAILABLE");
    const values = vaultObject(data.data);
    const value = values[mapping.field];
    if (typeof value !== "string" || !value || Buffer.byteLength(value) > 65536)
      throw new Error("SECRET_VALUE_INVALID");
    const material = Buffer.from(value, "utf8");
    values[mapping.field] = null;
    try {
      if (!(await this.authorization.authorize(this.#use, mapping, signal)) || signal.aborted)
        throw new Error();
      const expiresAt = Math.min(
        this.clock() + mapping.maximumLeaseMs,
        received.credentialExpiresAt,
      );
      if (expiresAt <= this.clock()) throw new Error();
      return new SingleUseSecretLease(
        material,
        expiresAt,
        { allowedUseHash, secretVersion: mapping.secretVersion, policyRef: this.#use.policyRef },
        signal,
        () => this.authorization.isCurrent(this.#use, mapping),
        this.clock,
      );
    } catch {
      material.fill(0);
      throw new Error("SECRET_USE_DENIED");
    }
  }
}
