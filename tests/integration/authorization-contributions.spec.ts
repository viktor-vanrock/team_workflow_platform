import { describe, expect, it, vi } from "vitest";

import {
  ArtifactAccessDeniedError,
  ArtifactAuthorizationContributionRegistry,
  type ArtifactAuthorizationRequest,
  type ArtifactMetadata,
  type ArtifactService,
  type WorkspaceContext,
} from "../../packages/platform-core/src/index.ts";
import {
  ArtifactsController,
  AuthorizationContributionRegistry,
  type AuthorizationContributionRequest,
  WorkspaceContextStore,
} from "../../packages/platform-runtime-nest/src/index.ts";

const context: WorkspaceContext = Object.freeze({
  actor: { kind: "HUMAN", principalId: "principal-a", issuer: "issuer", subject: "subject-a" },
  scope: { kind: "PROJECT", workspaceId: "workspace-a", projectId: "project-a" },
  correlationId: "correlation-a",
  causationId: "causation-a",
} as const);

const artifact: ArtifactMetadata = Object.freeze({
  id: "artifact-a",
  workspaceId: "workspace-a",
  projectId: "project-a",
  owner: { entityType: "work-item", entityId: "work-item-a" },
  artifactKind: "report",
  fileName: "report.txt",
  mediaType: "text/plain",
  sizeBytes: 12,
  checksum: { algorithm: "SHA256", value: "sha256:artifact-a" },
  classification: { key: "INTERNAL", rank: 10 },
  availability: "AVAILABLE",
  createdBy: "principal-a",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  objectVersionOrEtag: "etag-a",
  storageProviderKind: "test",
} as const);

describe("generic authorization contribution registries", () => {
  it("evaluates matching permission contributions in stable order and stops on denial", async () => {
    const calls: string[] = [];
    const allow = (componentRef: string) => ({
      componentRef,
      matches: () => true,
      authorize: async () => {
        calls.push(componentRef);
        return { allowed: true, reason: "ALLOW" as const };
      },
    });
    const deny = {
      componentRef: "c-deny",
      matches: () => true,
      authorize: async () => {
        calls.push("c-deny");
        return { allowed: false, reason: "EXPLICIT_DENY" as const };
      },
    };
    const registry = new AuthorizationContributionRegistry([
      allow("z-after-denial"),
      deny,
      allow("a-first"),
    ]);
    const request: AuthorizationContributionRequest = {
      context,
      permission: "work-item.read",
      resourceClassification: { key: "INTERNAL", rank: 10 },
      operation: "WorkItemsController.list",
    };

    await expect(registry.authorize(request)).resolves.toEqual({
      allowed: false,
      reason: "EXPLICIT_DENY",
    });
    expect(calls).toEqual(["a-first", "c-deny"]);
  });

  it("fails composition when two permission contributions claim the same component", () => {
    const duplicate = {
      componentRef: "pack.policy",
      matches: () => true,
      authorize: async () => ({ allowed: true, reason: "ALLOW" as const }),
    };
    expect(() => new AuthorizationContributionRegistry([duplicate, duplicate])).toThrow(
      "AUTHORIZATION_CONTRIBUTION_COLLISION:pack.policy",
    );
  });

  it("denies artifact content before the controller opens object storage", async () => {
    const getArtifactMetadata = vi.fn(async () => artifact);
    const streamArtifactContent = vi.fn();
    const artifacts = { getArtifactMetadata, streamArtifactContent } as unknown as ArtifactService;
    const contexts = new WorkspaceContextStore();
    const contribution = {
      componentRef: "pack.artifact-policy",
      matches: (request: ArtifactAuthorizationRequest) => request.operation === "STREAM_CONTENT",
      authorize: async () => ({ allowed: false, reason: "EXPLICIT_DENY" as const }),
    };
    const controller = new ArtifactsController(
      artifacts,
      contexts,
      new ArtifactAuthorizationContributionRegistry([contribution]),
    );

    await contexts.run(context, async () => {
      await expect(
        controller.streamArtifactContent("artifact-a", { setHeader: vi.fn() }),
      ).rejects.toBeInstanceOf(ArtifactAccessDeniedError);
    });

    expect(getArtifactMetadata).toHaveBeenCalledOnce();
    expect(streamArtifactContent).not.toHaveBeenCalled();
  });

  it("fails composition when two artifact policies claim the same component", () => {
    const duplicate = {
      componentRef: "pack.artifact-policy",
      matches: () => true,
      authorize: async () => ({ allowed: true, reason: "ALLOW" as const }),
    };
    expect(() => new ArtifactAuthorizationContributionRegistry([duplicate, duplicate])).toThrow(
      "ARTIFACT_AUTHORIZATION_CONTRIBUTION_COLLISION:pack.artifact-policy",
    );
  });
});
