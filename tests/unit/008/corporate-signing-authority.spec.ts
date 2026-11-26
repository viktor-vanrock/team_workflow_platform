import { afterEach, describe, expect, it, vi } from "vitest";

import { DenyByDefaultAuthorizationPolicy } from "../../../packages/platform-core/src/index.ts";
import {
  RuntimeConfigurationRepository,
  TypeOrmCorporateScopedAccessRepository,
  TypeOrmIdentityRepository,
} from "../../../packages/platform-persistence-typeorm/src/index.ts";
import { createCorporateSigningAuthority } from "../../../packages/runtime-composition/src/security/corporate-signing-authority.ts";

const ref = { id: "signing:1", version: 1, contentHash: `sha256:${"a".repeat(64)}` as const };
const config = {
  workspaceId: "workspace",
  projectId: "project",
  servicePrincipalId: "service",
  mount: "transit",
  keyName: "evidence",
  keyVersion: 1,
  kid: "signing:1",
  publicKeyRef: ref,
  signingPolicyRef: ref,
};
const manifest = {
  workspaceId: "workspace",
  projectId: "project",
  effectiveClassificationKey: "INTERNAL",
};
const grant = {
  configuration: config,
  serviceIdentity: { issuer: "issuer", subject: "subject", serviceKey: "signer" },
  permission: "evidence.sign",
};
const source = {
  isInitialized: true,
  transaction: async (_isolation: string, callback: (manager: object) => Promise<unknown>) =>
    await callback({}),
};
afterEach(() => vi.restoreAllMocks());

describe("corporate evidence signing authority", () => {
  it("reauthorizes the exact service and published signing policy for the manifest classification", async () => {
    vi.spyOn(TypeOrmIdentityRepository.prototype, "findByVerifiedSubject").mockResolvedValue({
      id: "service",
      kind: "SERVICE",
    } as never);
    vi.spyOn(TypeOrmCorporateScopedAccessRepository.prototype, "getWorkspace").mockResolvedValue({
      state: "ACTIVE",
    } as never);
    vi.spyOn(TypeOrmCorporateScopedAccessRepository.prototype, "getProject").mockResolvedValue({
      state: "ACTIVE",
    } as never);
    vi.spyOn(
      TypeOrmCorporateScopedAccessRepository.prototype,
      "authorizationFacts",
    ).mockResolvedValue({} as never);
    vi.spyOn(RuntimeConfigurationRepository.prototype, "current").mockResolvedValue({} as never);
    const decide = vi
      .spyOn(DenyByDefaultAuthorizationPolicy.prototype, "decide")
      .mockReturnValue({ allowed: true } as never);
    const authorize = createCorporateSigningAuthority(source as never, ref, [grant]);
    expect(await authorize(manifest as never, config, new AbortController().signal)).toBe(true);
    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({
        permission: "evidence.sign",
        resourceClassification: expect.objectContaining({ key: "INTERNAL" }),
      }),
    );
    expect(
      await authorize(
        { ...manifest, projectId: "other" } as never,
        config,
        new AbortController().signal,
      ),
    ).toBe(false);
  });
  it("rejects expired or revoked signing policy", async () => {
    vi.spyOn(TypeOrmIdentityRepository.prototype, "findByVerifiedSubject").mockResolvedValue({
      id: "service",
      kind: "SERVICE",
    } as never);
    vi.spyOn(TypeOrmCorporateScopedAccessRepository.prototype, "getWorkspace").mockResolvedValue({
      state: "ACTIVE",
    } as never);
    vi.spyOn(TypeOrmCorporateScopedAccessRepository.prototype, "getProject").mockResolvedValue({
      state: "ACTIVE",
    } as never);
    vi.spyOn(RuntimeConfigurationRepository.prototype, "current").mockRejectedValue(
      new Error("REVOKED"),
    );
    const authorize = createCorporateSigningAuthority(source as never, ref, [grant]);
    expect(await authorize(manifest as never, config, new AbortController().signal)).toBe(false);
  });
});
