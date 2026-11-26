import { afterEach, describe, expect, it, vi } from "vitest";

import { pilotContentHash } from "../../../packages/platform-core/src/index.ts";
import { RuntimeConfigurationRepository } from "../../../packages/platform-persistence-typeorm/src/runtime-configuration.repository.ts";
import { PublishedVaultSecretAuthorization } from "../../../packages/runtime-composition/src/security/published-vault-authorization.ts";
import type { VaultSecretMapping } from "../../../packages/runtime-composition/src/security/vault-secret-resolver.ts";

const ref = { id: "policy", version: 1, contentHash: `sha256:${"a".repeat(64)}` as const };
const mapping: VaultSecretMapping = {
  ref,
  secretRef: "secretref://jira/read",
  use: {
    workspaceId: "workspace",
    projectId: "project",
    servicePrincipalId: "service",
    purpose: "CONNECTOR_READ",
    profileRef: ref,
    connectionRef: ref,
    policyRef: ref,
  },
  mount: "secret",
  path: "jira/read",
  field: "credential",
  secretVersion: 1,
  maximumLeaseMs: 500,
};
const source = {
  isInitialized: true,
  transaction: async (_isolation: string, callback: (manager: object) => Promise<unknown>) =>
    await callback({}),
};
afterEach(() => vi.restoreAllMocks());

describe("published Vault mapping authorization", () => {
  it("requires the approved mapping hash and current authorization before issuing a lease", async () => {
    vi.spyOn(RuntimeConfigurationRepository.prototype, "current").mockResolvedValue({
      validUntil: new Date(Date.now() + 60_000).toISOString(),
    } as never);
    const current = vi.fn().mockResolvedValue(true);
    const authorization = new PublishedVaultSecretAuthorization(
      source as never,
      ref,
      [{ mapping, approvedMappingHash: pilotContentHash(mapping) }],
      current,
    );
    expect(authorization.isCurrent(mapping.use, mapping)).toBe(false);
    expect(await authorization.authorize(mapping.use, mapping, new AbortController().signal)).toBe(
      true,
    );
    expect(authorization.isCurrent(mapping.use, mapping)).toBe(true);
    current.mockResolvedValue(false);
    expect(await authorization.authorize(mapping.use, mapping, new AbortController().signal)).toBe(
      false,
    );
    expect(authorization.isCurrent(mapping.use, mapping)).toBe(false);
  });
  it("fails closed for changed mapping, unpublished policy and abort", async () => {
    const published = vi
      .spyOn(RuntimeConfigurationRepository.prototype, "current")
      .mockRejectedValue(new Error("REVOKED"));
    const authorization = new PublishedVaultSecretAuthorization(
      source as never,
      ref,
      [{ mapping, approvedMappingHash: pilotContentHash(mapping) }],
      async () => true,
    );
    expect(
      await authorization.authorize(
        mapping.use,
        { ...mapping, field: "other" },
        new AbortController().signal,
      ),
    ).toBe(false);
    expect(published).not.toHaveBeenCalled();
    expect(await authorization.authorize(mapping.use, mapping, new AbortController().signal)).toBe(
      false,
    );
    const controller = new AbortController();
    controller.abort();
    expect(await authorization.authorize(mapping.use, mapping, controller.signal)).toBe(false);
    expect(authorization.isCurrent(mapping.use, mapping)).toBe(false);
  });
});
