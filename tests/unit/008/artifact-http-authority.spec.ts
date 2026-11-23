import "../../../apps/api/node_modules/reflect-metadata/Reflect.js";

import { describe, expect, it, vi } from "vitest";

import {
  type QaAuthorizationInput,
  QaSessionGuard,
} from "../../../apps/api/src/extensions/qa-api-authorization.ts";
import { createQaArtifactHttpApi } from "../../../apps/api/src/extensions/qa-artifact-http-api.ts";
import {
  ArtifactAuthorizationContributionRegistry,
  type ArtifactReference,
} from "../../../packages/platform-core/src/index.ts";

const artifact: ArtifactReference = {
  id: "a",
  workspaceId: "w",
  projectId: "p",
  owner: { entityType: "TEST", entityId: "owner" },
  artifactKind: "EVIDENCE",
  storage: { providerKind: "FIXTURE", opaqueLocator: "PRIVATE_LOCATOR", objectVersionOrEtag: "v1" },
  fileName: "evidence.txt",
  mediaType: "text/plain",
  sizeBytes: 3,
  checksum: { algorithm: "SHA256", value: `sha256:${"a".repeat(64)}` },
  classification: { key: "INTERNAL", rank: 10 },
  availability: "AVAILABLE",
  createdBy: "human",
  createdAt: new Date(),
};

describe("008 artifact HTTP authorization", () => {
  it("rejects a forged request before scope discovery, artifact lookup or storage", async () => {
    const scope = vi.fn();
    const get = vi.fn();
    const stream = vi.fn();
    const api = createQaArtifactHttpApi({
      source: {} as never,
      scope,
      repository: { get, save: vi.fn() },
      storage: { stream },
      contributions: new ArtifactAuthorizationContributionRegistry(),
    });
    for (const read of [
      () => api.metadata({ localPersonaKey: "owner.local" }, "a"),
      () => api.content({ localPersonaKey: "owner.local" }, "a"),
    ])
      await expect(read()).rejects.toThrow("ARTIFACT_NOT_FOUND");
    expect(scope).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    expect(stream).not.toHaveBeenCalled();
  });
  it("applies current classification and revocation before returning metadata or starting a content iterator", async () => {
    let denied = false;
    let ceiling: "PUBLIC" | "INTERNAL" = "INTERNAL";
    const request = { headers: {}, method: "GET" };
    const guard = new QaSessionGuard({
      authenticate: async () => async (input: QaAuthorizationInput) => {
        if (denied) throw new Error("REVOKED");
        return {
          actor: { kind: "HUMAN", principalId: "human", issuer: "idp", subject: "subject" },
          scope: input.scope,
          classificationCeiling: ceiling,
          basis: {
            kind: "PROJECT",
            policyVersion: "v1",
            membershipRef: { id: "m", version: 1 },
            roleAssignmentRefs: [{ id: "r", version: 1 }],
            entitlementRefs: [{ id: "e", version: 1 }],
            skillContext: "NOT_APPLICABLE",
          },
        };
      },
    });
    await guard.canActivate({ switchToHttp: () => ({ getRequest: () => request }) } as never);
    let iterated = false;
    const stream = vi.fn(async () => ({
      body: (async function* () {
        iterated = true;
        yield new TextEncoder().encode("abc");
      })(),
    }));
    const api = createQaArtifactHttpApi({
      source: {} as never,
      scope: async () => ({ workspaceId: "w", projectId: "p" }),
      repository: { get: async () => artifact, save: vi.fn() },
      storage: { stream },
      contributions: new ArtifactAuthorizationContributionRegistry(),
    });
    expect(await api.metadata(request, "a")).not.toHaveProperty("storage");
    ceiling = "PUBLIC";
    await expect(api.content(request, "a")).rejects.toThrow("ARTIFACT_NOT_FOUND");
    expect(stream).not.toHaveBeenCalled();
    ceiling = "INTERNAL";
    const content = await api.content(request, "a");
    denied = true;
    await expect(content.body[Symbol.asyncIterator]().next()).rejects.toThrow("ARTIFACT_NOT_FOUND");
    expect(iterated).toBe(false);
  });
  it("preserves pack-specific denial before opening storage", async () => {
    const request = { headers: {}, method: "GET" };
    await new QaSessionGuard({
      authenticate: async () => async (input) => ({
        actor: { kind: "HUMAN", principalId: "human", issuer: "idp", subject: "subject" },
        scope: input.scope,
        classificationCeiling: "INTERNAL",
        basis: {
          kind: "PROJECT",
          policyVersion: "v1",
          membershipRef: { id: "m", version: 1 },
          roleAssignmentRefs: [{ id: "r", version: 1 }],
          entitlementRefs: [{ id: "e", version: 1 }],
          skillContext: "NOT_APPLICABLE",
        },
      }),
    }).canActivate({ switchToHttp: () => ({ getRequest: () => request }) } as never);
    const stream = vi.fn();
    const api = createQaArtifactHttpApi({
      source: {} as never,
      scope: async () => ({ workspaceId: "w", projectId: "p" }),
      repository: { get: async () => artifact, save: vi.fn() },
      storage: { stream },
      contributions: new ArtifactAuthorizationContributionRegistry([
        {
          componentRef: "qa",
          matches: () => true,
          authorize: async () => ({ allowed: false, reason: "NO_ENTITLEMENT" }),
        },
      ]),
    });
    await expect(api.content(request, "a")).rejects.toThrow("ARTIFACT_NOT_FOUND");
    expect(stream).not.toHaveBeenCalled();
  });
});
