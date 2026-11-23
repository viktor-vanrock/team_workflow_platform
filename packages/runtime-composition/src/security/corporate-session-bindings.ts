import type { DataSource } from "typeorm";

import {
  TypeOrmCorporateScopedAccessRepository,
  TypeOrmCorporateSessionStore,
  TypeOrmIdentityRepository,
  TypeOrmIdentityRevocations,
} from "@awp/platform-persistence-typeorm";
import {
  AesGcmSessionStateCodec,
  type CorporateSessionPolicy,
  CorporateSessionService,
  type OidcClientAuthentication,
  type OidcTransport,
  type PinnedOidcPolicy,
  PinnedOidcTokenVerifier,
  type SessionEncryptionKeys,
} from "@awp/platform-runtime-nest";

import type { PinnedNetworkTransport } from "../pilot/network-policy.ts";
import { type CorporateGroupPolicy, CorporateIdentityService } from "./corporate-identity.ts";
import { PlatformAccessService } from "./platform-access.ts";

/** All trust and credential ports are explicit; this factory has no local fallback. */
export function createCorporateSessionBindings(
  input: Readonly<{
    source: DataSource;
    tokens: PinnedOidcPolicy;
    session: CorporateSessionPolicy;
    groups: CorporateGroupPolicy;
    encryptionKeyId: string;
    encryptionKeys: SessionEncryptionKeys;
    network: PinnedNetworkTransport;
    clientAuthentication: OidcClientAuthentication;
    clock?: () => number;
    /** Enabled by default: first verified corporate login claims platform administration once. */
    accessProvisioning?: boolean;
  }>,
) {
  const { tokens, session, groups } = input;
  if (
    (input.accessProvisioning !== undefined && typeof input.accessProvisioning !== "boolean") ||
    !input.source.isInitialized ||
    tokens.mode !== input.network.policy.mode ||
    tokens.issuer !== groups.issuer ||
    groups.ref.id !== session.policyRef.id ||
    groups.ref.version !== session.policyRef.version ||
    groups.ref.contentHash !== session.policyRef.contentHash
  )
    throw new Error("CORPORATE_IDENTITY_BINDING_INVALID");
  const transport: OidcTransport = {
    authorizeEndpoint: (url, method, signal) =>
      input.network.authorizeEndpoint(url, method, signal),
    fetch: input.network.fetch,
  };
  const clock = input.clock ?? Date.now;
  const revocations = new TypeOrmIdentityRevocations(input.source);
  const platformAccess = new PlatformAccessService(input.source);
  const identities = new CorporateIdentityService(
    groups,
    new TypeOrmIdentityRepository(input.source),
    new TypeOrmCorporateScopedAccessRepository(input.source),
    revocations,
    clock,
    input.accessProvisioning !== false
      ? {
          registerVerified: (evidence) => platformAccess.registerVerified(evidence),
          authorize: (principalId, permission) => platformAccess.authorize(principalId, permission),
        }
      : undefined,
  );
  const store = new TypeOrmCorporateSessionStore(input.source);
  const verifier = new PinnedOidcTokenVerifier(tokens, transport);
  const codec = new AesGcmSessionStateCodec(input.encryptionKeyId, input.encryptionKeys);
  const sessions = new CorporateSessionService(
    session,
    verifier,
    transport,
    store,
    codec,
    identities,
    input.clientAuthentication,
    clock,
  );
  return Object.freeze({ sessions, identities, revocations, store, verifier, platformAccess });
}
