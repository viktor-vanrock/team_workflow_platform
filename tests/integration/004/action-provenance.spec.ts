import { describe, expect, it } from "vitest";

import { InMemoryActionProvenanceRepository } from "../../../packages/platform-persistence-typeorm/src/action-provenance.repository.ts";

describe("ActionProvenance persistence", () => {
  it("is project-scoped, append-only and collision-safe", async () => {
    const repository = new InMemoryActionProvenanceRepository();
    const value = {
      id: "a",
      workspaceId: "w",
      projectId: "p",
      actor: { kind: "HUMAN" as const, principalId: "u", issuer: "i", subject: "s" },
      subject: { kind: "DRAFT" as const, id: "d", version: 1, contentHash: "sha256:x" },
      action: "draft.revise",
      effectClass: "DRAFT_MUTATION" as const,
      configuration: { kind: "DRAFT" },
      occurredAt: new Date("2026-09-01"),
    };
    await repository.append(value);
    await expect(repository.append({ ...value, projectId: "foreign" })).rejects.toThrow(
      /COLLISION/u,
    );
    expect(await repository.get("w", "p", "a")).toMatchObject({ id: "a", projectId: "p" });
  });
});
