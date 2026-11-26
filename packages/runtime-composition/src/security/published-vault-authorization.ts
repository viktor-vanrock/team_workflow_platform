import type { DataSource } from "typeorm";

import {
  assertExactRevisionRef,
  freezePilotValue,
  pilotContentHash,
  type ExactRevisionRef,
} from "@awp/platform-core";
import { RuntimeConfigurationRepository } from "@awp/platform-persistence-typeorm";

import type {
  VaultSecretAuthorization,
  VaultSecretMapping,
  VaultSecretUse,
} from "./vault-secret-resolver.ts";

/** A separately approved, non-secret host file pins every use and Vault mapping by content hash. */
export interface PublishedVaultMappingGrant {
  readonly mapping: VaultSecretMapping;
  readonly approvedMappingHash: string;
}

export class PublishedVaultSecretAuthorization implements VaultSecretAuthorization {
  readonly #approved = new Map<string, PublishedVaultMappingGrant>();
  readonly #current = new Map<string, number>();
  readonly #repository = new RuntimeConfigurationRepository();
  readonly #policyRef: ExactRevisionRef;

  constructor(
    private readonly source: DataSource,
    policyRef: ExactRevisionRef,
    grants: readonly PublishedVaultMappingGrant[],
    private readonly authorizeUse: (use: VaultSecretUse, signal: AbortSignal) => Promise<boolean>,
    private readonly projectionLifetimeMs = 1000,
  ) {
    if (
      !source.isInitialized ||
      typeof authorizeUse !== "function" ||
      !grants.length ||
      grants.length > 256 ||
      !Number.isSafeInteger(projectionLifetimeMs) ||
      projectionLifetimeMs < 1 ||
      projectionLifetimeMs > 5000
    )
      throw new Error("VAULT_AUTHORIZATION_CONFIGURATION_INVALID");
    assertExactRevisionRef(policyRef);
    this.#policyRef = freezePilotValue(structuredClone(policyRef));
    for (const input of grants) {
      const grant = freezePilotValue(structuredClone(input));
      if (
        pilotContentHash(grant.mapping) !== grant.approvedMappingHash ||
        pilotContentHash(grant.mapping.use.policyRef) !== pilotContentHash(policyRef) ||
        this.#approved.has(grant.approvedMappingHash)
      )
        throw new Error("VAULT_AUTHORIZATION_CONFIGURATION_INVALID");
      this.#approved.set(grant.approvedMappingHash, grant);
    }
  }

  async authorize(
    use: VaultSecretUse,
    mapping: VaultSecretMapping,
    signal: AbortSignal,
  ): Promise<boolean> {
    const key = pilotContentHash(mapping);
    this.#current.delete(key);
    try {
      const grant = this.#approved.get(key);
      if (
        !grant ||
        signal.aborted ||
        pilotContentHash(use) !== pilotContentHash(mapping.use) ||
        !(await this.authorizeUse(use, signal))
      )
        return false;
      const publication = await this.source.transaction("REPEATABLE READ", async (manager) =>
        this.#repository.current(manager, use, this.#policyRef, "SECRET_RESOLVER_POLICY"),
      );
      if (signal.aborted || !(await this.authorizeUse(use, signal))) return false;
      const expiresAt = Math.min(
        Date.parse(publication.validUntil),
        Date.now() + this.projectionLifetimeMs,
      );
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false;
      this.#current.set(key, expiresAt);
      return true;
    } catch {
      return false;
    }
  }

  isCurrent(use: VaultSecretUse, mapping: VaultSecretMapping): boolean {
    const key = pilotContentHash(mapping);
    return (
      pilotContentHash(use) === pilotContentHash(mapping.use) &&
      this.#approved.has(key) &&
      (this.#current.get(key) ?? 0) > Date.now()
    );
  }
}
