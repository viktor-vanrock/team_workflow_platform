import { describe, expect, it, vi } from "vitest";

import { InMemoryDurableCommandStore } from "../../packages/platform-core/src/commanding/connector-command.ts";
import {
  type ArtifactAccessAuthorizer,
  type ArtifactReference,
  ArtifactService,
  type ScopedArtifactRepository,
  type WorkspaceContext,
} from "../../packages/platform-core/src/index.ts";
import {
  CommandWorker,
  DeterministicClock,
  envelopeFromStore,
  InMemoryRecoverableQueue,
} from "../../packages/platform-testkit/src/index.ts";

const context: WorkspaceContext = {
  actor: { kind: "HUMAN", principalId: "actor", issuer: "issuer", subject: "actor" },
  scope: { kind: "PROJECT", workspaceId: "workspace-a", projectId: "project-alpha" },
  correlationId: "correlation",
  causationId: "causation",
};
const artifact: ArtifactReference = {
  id: "artifact",
  workspaceId: "workspace-a",
  projectId: "project-alpha",
  owner: { entityType: "WORK_ITEM", entityId: "work-item" },
  artifactKind: "GENERIC_FILE",
  storage: {
    providerKind: "LEGACY_EXTERNAL",
    opaqueLocator: "never-expose",
    objectVersionOrEtag: "v1",
  },
  fileName: "artifact.txt",
  mediaType: "text/plain",
  sizeBytes: 1,
  checksum: { algorithm: "SHA256", value: "sha256:test" },
  classification: { key: "RESTRICTED", rank: 20 },
  availability: "AVAILABLE",
  createdBy: "actor",
  createdAt: new Date("2026-08-30T00:00:00.000Z"),
};

describe("cross-scope async and artifact regression surfaces", () => {
  it("denies forged Project scope before repository and object stream", async () => {
    const get = vi.fn(async () => artifact);
    const repository: ScopedArtifactRepository = { get, save: vi.fn(async () => undefined) };
    const authorizer: ArtifactAccessAuthorizer = {
      authorizeScope: vi.fn(async () => ({ allowed: false, reason: "NO_ENTITLEMENT" as const })),
      authorizeResource: vi.fn(async () => ({ allowed: true, reason: "ALLOW" as const })),
    };
    const storage = {
      stream: vi.fn(async () => ({
        body: (async function* () {
          yield new Uint8Array();
        })(),
      })),
    };

    await expect(
      new ArtifactService(repository, storage, authorizer).streamArtifactContent(
        context,
        artifact.id,
      ),
    ).rejects.toThrow("ARTIFACT_ACCESS_DENIED");
    expect(get).not.toHaveBeenCalled();
    expect(storage.stream).not.toHaveBeenCalled();
  });

  it("denies classification mismatch before object stream", async () => {
    const repository: ScopedArtifactRepository = {
      get: vi.fn(async () => artifact),
      save: vi.fn(async () => undefined),
    };
    const authorizer: ArtifactAccessAuthorizer = {
      authorizeScope: vi.fn(async () => ({ allowed: true, reason: "ALLOW" as const })),
      authorizeResource: vi.fn(async () => ({
        allowed: false,
        reason: "CLASSIFICATION_EXCEEDED" as const,
      })),
    };
    const storage = {
      stream: vi.fn(async () => ({
        body: (async function* () {
          yield new Uint8Array();
        })(),
      })),
    };
    const service = new ArtifactService(repository, storage, authorizer);

    await expect(service.streamArtifactContent(context, artifact.id)).rejects.toThrow(
      "ARTIFACT_ACCESS_DENIED",
    );
    expect(storage.stream).not.toHaveBeenCalled();
    await expect(service.getArtifactMetadata(context, artifact.id)).rejects.toThrow(
      "ARTIFACT_ACCESS_DENIED",
    );
  });

  it("returns authorized metadata without the opaque storage locator", async () => {
    const repository: ScopedArtifactRepository = {
      get: vi.fn(async () => artifact),
      save: vi.fn(async () => undefined),
    };
    const allow = vi.fn(async () => ({ allowed: true, reason: "ALLOW" as const }));
    const storage = {
      stream: vi.fn(async () => ({
        body: (async function* () {
          yield new Uint8Array();
        })(),
      })),
    };
    const metadata = await new ArtifactService(repository, storage, {
      authorizeScope: allow,
      authorizeResource: allow,
    }).getArtifactMetadata(context, artifact.id);

    expect(metadata).toMatchObject({
      id: artifact.id,
      storageProviderKind: "LEGACY_EXTERNAL",
      objectVersionOrEtag: "v1",
    });
    expect(metadata).not.toHaveProperty("storage");
    expect(JSON.stringify(metadata)).not.toContain("never-expose");
    expect(storage.stream).not.toHaveBeenCalled();
  });

  it("denies forged async scope before Broker/Connector", async () => {
    const store = InMemoryDurableCommandStore.readyFixture();
    const queue = new InMemoryRecoverableQueue();
    queue.add({ ...envelopeFromStore(store), projectId: "forged-project" });
    const broker = { invoke: vi.fn(async () => ({ receipt: "must-not-happen" })) };

    await expect(
      new CommandWorker(store, queue, broker, new DeterministicClock()).work(),
    ).rejects.toThrow("JOB_ENVELOPE_MISMATCH");
    expect(broker.invoke).not.toHaveBeenCalled();
  });
});
