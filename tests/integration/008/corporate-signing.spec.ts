import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createCorporateEvidenceCrypto } from "../../../apps/api/src/extensions/onboarding/corporate-evidence-crypto.ts";
import {
  buildEvidenceManifestV2,
  canonicalEvidenceBytes,
  evidenceContentHash,
} from "../../../packages/competency-qa/src/index.ts";
import { OfflineSchemaRegistry } from "../../../packages/platform-contracts/src/index.ts";
import {
  CorporateEvidenceSigner,
  FilePublicKeyHistory,
} from "../../../packages/runtime-composition/src/security/corporate-evidence-signing.ts";
import { VaultHttpClient } from "../../../packages/runtime-composition/src/security/vault-http-client.ts";
import { manifestInput } from "../../support/007-evidence-fixture.ts";
import { startVaultFixture008 } from "../../support/008-vault-fixture.ts";

describe("008 remote evidence signing", () => {
  let fixture: Awaited<ReturnType<typeof startVaultFixture008>>;
  let directory: string;
  let signer: CorporateEvidenceSigner;
  let history: FilePublicKeyHistory;
  const manifest = buildEvidenceManifestV2(manifestInput());
  const scope = { workspaceId: manifest.workspaceId, projectId: manifest.projectId };
  const policyRef = {
    id: "signing-policy",
    version: 1,
    contentHash: `sha256:${"a".repeat(64)}` as const,
  };
  beforeEach(async () => {
    fixture = await startVaultFixture008();
    directory = mkdtempSync(join(tmpdir(), "awp-008-public-keys-"));
    history = new FilePublicKeyHistory(directory, scope);
    const publicKeyRef = history.publish("evidence:1", 1, fixture.publicJwk(1));
    const client = new VaultHttpClient({
      baseUrl: fixture.origin,
      namespace: "pilot/",
      mode: "LOCAL_FIXTURE",
      deadlineMs: 200,
      maximumResponseBytes: 8192,
      authorizeEndpoint: async () => true,
      credentials: {
        withToken: async (_use, _signal, consume) =>
          await consume("fixture-workload-credential", Date.now() + 10000),
      },
    });
    signer = new CorporateEvidenceSigner(
      client,
      history,
      {
        ...scope,
        servicePrincipalId: "signer",
        mount: "transit",
        keyName: "evidence",
        keyVersion: 1,
        kid: "evidence:1",
        publicKeyRef,
        signingPolicyRef: policyRef,
      },
      async () => true,
    );
  });
  afterEach(async () => {
    await fixture.stop();
    rmSync(directory, { recursive: true, force: true });
  });
  it("signs the exact existing JWS input and verifies with persisted public material", async () => {
    const envelope = await signer.signManifest(manifest);
    expect(() =>
      new OfflineSchemaRegistry().validateById(
        "urn:awp:schemas:007:evidence-signature-envelope:v1",
        envelope,
      ),
    ).not.toThrow();
    const { contentHash: _hash, ...payload } = manifest;
    void _hash;
    const signingInput = `${Buffer.from(canonicalEvidenceBytes(envelope.protectedHeader)).toString("base64url")}.${Buffer.from(canonicalEvidenceBytes(payload)).toString("base64url")}`;
    expect(fixture.requests[0]).toEqual({
      method: "POST",
      path: "/v1/transit/sign/evidence",
      body: {
        input: Buffer.from(signingInput).toString("base64"),
        key_version: 1,
        prehashed: false,
      },
    });
    expect(envelope.payloadHash).toBe(manifest.contentHash);
    expect(envelope.signature).toMatch(/^[a-zA-Z0-9_-]{86}$/u);
    expect(await signer.verify(manifest, envelope)).toBe("VALID");
  });
  it("composes scoped evidence crypto from an explicitly trusted public key", async () => {
    const publicKeyRef = history.publish("evidence:1", 1, fixture.publicJwk(1));
    const client = new VaultHttpClient({
      baseUrl: fixture.origin,
      namespace: "pilot/",
      mode: "LOCAL_FIXTURE",
      deadlineMs: 200,
      maximumResponseBytes: 8192,
      authorizeEndpoint: async () => true,
      credentials: {
        withToken: async (_use, _signal, consume) =>
          await consume("fixture-workload-credential", Date.now() + 10000),
      },
    });
    const resolve = createCorporateEvidenceCrypto({
      source: client,
      publicKeyHistoryDirectory: directory,
      signingPolicyRef: policyRef,
      projects: [
        {
          signing: {
            ...scope,
            servicePrincipalId: "signer",
            mount: "transit",
            keyName: "evidence",
            keyVersion: 1,
            kid: "evidence:1",
            publicKeyRef,
            signingPolicyRef: policyRef,
          },
          redactionPolicyRef: policyRef,
          exportPolicyRef: policyRef,
          trustedPublicKeys: [publicKeyRef],
        },
      ],
      authorize: async () => true,
    });
    const crypto = resolve(scope);
    const signed = await crypto.signManifest(manifest);
    expect(await crypto.verify(manifest, signed)).toBe("VALID");
    expect(() => resolve({ ...scope, projectId: "foreign" })).toThrow(
      "CORPORATE_EVIDENCE_SCOPE_DENIED",
    );
  });
  it("retains old public keys across rotation/restart and verifies during signer outage", async () => {
    const envelope = await signer.signManifest(manifest);
    history.publish("evidence:2", 2, fixture.publicJwk(2));
    fixture.state.status = 503;
    const restored = new FilePublicKeyHistory(directory, scope);
    expect((await restored.resolve(envelope.publicKeyRef))?.kid).toBe("evidence:1");
    expect(await restored.verify(manifest, envelope)).toBe("VALID");
    expect(fixture.requests).toHaveLength(1);
  });
  it("rejects a returned key version other than the requested version", async () => {
    fixture.state.signatureVersion = 2;
    await expect(signer.signManifest(manifest)).rejects.toThrow("EVIDENCE_SIGNER_VERSION_CONFLICT");
    expect(fixture.requests).toHaveLength(1);
  });
  it("verifies the remote signature before returning an envelope", async () => {
    fixture.state.corruptSignature = true;
    await expect(signer.signManifest(manifest)).rejects.toThrow(
      "EVIDENCE_REMOTE_SIGNATURE_INVALID",
    );
  });
  it("rejects hash and scope changes before invoking the remote signer", async () => {
    await expect(signer.signManifest({ ...manifest, workItemId: "tampered" })).rejects.toThrow(
      "EVIDENCE_MANIFEST_HASH_MISMATCH",
    );
    await expect(signer.signManifest({ ...manifest, projectId: "foreign" })).rejects.toThrow(
      "EVIDENCE_SIGNING_SCOPE_DENIED",
    );
    expect(fixture.requests).toHaveLength(0);
  });
  it("makes archived keys immutable and excludes private key material", () => {
    expect(() => history.publish("evidence:1", 1, fixture.publicJwk(2))).toThrow(
      "EVIDENCE_PUBLIC_KEY_IMMUTABLE",
    );
    expect(() =>
      history.publish("private:1", 1, { ...fixture.publicJwk(1), d: "private" }),
    ).toThrow("EVIDENCE_PUBLIC_KEY_INVALID");
  });
  it("detects modified envelope identity, public-key refs and signature bytes", async () => {
    const envelope = await signer.signManifest(manifest);
    for (const patch of [
      { projectId: "foreign" },
      { payloadHash: evidenceContentHash("other") },
      { signature: "invalid" },
      { publicKeyRef: { ...envelope.publicKeyRef, version: 2 } },
    ]) {
      expect(await signer.verify(manifest, { ...envelope, ...patch })).not.toBe("VALID");
    }
  });
  it("redacts signer failure and never falls back to a local private key", async () => {
    fixture.state.status = 503;
    await expect(signer.signManifest(manifest)).rejects.toThrow("VAULT_REQUEST_FAILED");
    expect(fixture.requests).toHaveLength(1);
  });
  it("does not accept altered archive bytes or keys from another project", async () => {
    const envelope = await signer.signManifest(manifest);
    expect(
      await new FilePublicKeyHistory(directory, { ...scope, projectId: "other" }).resolve(
        envelope.publicKeyRef,
      ),
    ).toBeUndefined();
    const scopeDirectory = join(directory, evidenceContentHash(scope).slice(7));
    const file = readdirSync(scopeDirectory)[0]!;
    writeFileSync(join(scopeDirectory, file), "{}");
    expect(await history.verify(manifest, envelope)).toBe("KEY_UNAVAILABLE");
  });
  it("rechecks authorization after the remote signature and rejects revocation", async () => {
    let calls = 0;
    const publicKeyRef = history.publish("evidence:1", 1, fixture.publicJwk(1));
    const client = new VaultHttpClient({
      baseUrl: fixture.origin,
      namespace: "pilot/",
      mode: "LOCAL_FIXTURE",
      deadlineMs: 200,
      maximumResponseBytes: 8192,
      authorizeEndpoint: async () => true,
      credentials: {
        withToken: async (_use, _signal, consume) =>
          await consume("fixture-workload-credential", Date.now() + 10000),
      },
    });
    const guarded = new CorporateEvidenceSigner(
      client,
      history,
      {
        ...scope,
        servicePrincipalId: "signer",
        mount: "transit",
        keyName: "evidence",
        keyVersion: 1,
        kid: "evidence:1",
        publicKeyRef,
        signingPolicyRef: policyRef,
      },
      async () => ++calls === 1,
    );
    await expect(guarded.signManifest(manifest)).rejects.toThrow(
      "EVIDENCE_SIGNING_AUTHORIZATION_DENIED",
    );
    expect(fixture.requests).toHaveLength(1);
  });
});
