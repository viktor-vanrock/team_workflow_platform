import { describe, expect, it } from "vitest";

import { InMemoryQaEvidenceArtifactService } from "../../packages/competency-qa/src/application/evidence-artifact-service.ts";

const bytes = new TextEncoder().encode("manual evidence");

describe("US3 closed evidence attachment lifecycle", () => {
  it("hands a usable changed CAS token through create, upload and finalize", async () => {
    const service = new InMemoryQaEvidenceArtifactService();
    const initiated = await service.initiate({
      workspaceId: "w",
      projectId: "p",
      workItemId: "wi",
      sessionId: "s",
      owner: { ownerType: "ATTEMPT", ownerId: "a" },
      mediaType: "text/plain",
      sizeBytes: bytes.byteLength,
      dataClassificationKey: "INTERNAL",
      actorId: "executor",
    });
    expect(initiated.etag).toBe('W/"1"');
    const uploaded = await service.upload(
      initiated.attachment.contentUploadRef,
      bytes,
      initiated.etag,
    );
    expect(uploaded.etag).toBe('W/"2"');
    await expect(
      service.finalize(
        initiated.attachment.contentUploadRef,
        {
          checksum: "sha256:bad",
          mediaType: "text/plain",
          sizeBytes: bytes.byteLength,
          dataClassificationKey: "INTERNAL",
        },
        uploaded.etag,
      ),
    ).rejects.toThrow("QA_EVIDENCE_CHECKSUM_MISMATCH");
    const finalized = await service.finalize(
      initiated.attachment.contentUploadRef,
      {
        checksum: uploaded.checksum,
        mediaType: "text/plain",
        sizeBytes: bytes.byteLength,
        dataClassificationKey: "INTERNAL",
      },
      uploaded.etag,
    );
    expect(finalized.etag).toBe('W/"3"');
    expect(finalized.evidence).not.toHaveProperty("providerLocator");
    await expect(
      service.upload(initiated.attachment.contentUploadRef, bytes, initiated.etag),
    ).rejects.toThrow("QA_EVIDENCE_ATTACHMENT_STALE_VERSION");
  });

  it("changes only live availability after expiry", async () => {
    const service = new InMemoryQaEvidenceArtifactService();
    const created = await service.attachFinalizedFixture({
      workspaceId: "w",
      projectId: "p",
      workItemId: "wi",
      sessionId: "s",
      ownerType: "SESSION",
      ownerId: "s",
      bytes,
      mediaType: "text/plain",
      classification: "INTERNAL",
      actorId: "executor",
    });
    const signed = structuredClone(created);
    service.expire(created.evidenceArtifactLinkId);
    expect(
      service.get({ workspaceId: "w", projectId: "p" }, created.evidenceArtifactLinkId),
    ).toMatchObject({ availability: "EXPIRED", checksum: signed.checksum });
    expect(signed.availabilityAtSigning).toBe("AVAILABLE");
  });
});
