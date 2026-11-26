import { afterEach, describe, expect, it, vi } from "vitest";

import { pilotContentHash } from "../../../packages/platform-core/src/index.ts";
import { PilotRepository } from "../../../packages/platform-persistence-typeorm/src/index.ts";
import { DurablePilotFenceRevocation } from "../../../packages/runtime-composition/src/pilot/fence-revocation.ts";

afterEach(() => vi.restoreAllMocks());

describe("pilot fence revocation", () => {
  it("requires a human and recent step-up before any database mutation", async () => {
    const transaction = vi.fn();
    const service = new DurablePilotFenceRevocation({ transaction } as never, () =>
      Date.parse("2026-01-01T00:10:00Z"),
    );
    const authority = {
      workspaceId: "workspace",
      projectId: "project",
      authorize: vi.fn(async () => ({
        actor: { kind: "HUMAN", principalId: "human", issuer: "issuer", subject: "subject" },
        basis: {},
        classificationCeiling: "CONFIDENTIAL",
        stepUpAt: "2026-01-01T00:00:00Z",
      })),
    };
    await expect(
      service.revoke(authority as never, {
        id: "fence",
        version: 1,
        contentHash: `sha256:${"a".repeat(64)}`,
      }),
    ).rejects.toThrow("PILOT_FENCE_REVOKE_DENIED");
    expect(transaction).not.toHaveBeenCalled();
  });

  it("revokes the exact current revision, records audit and preserves all other fields", async () => {
    const now = Date.parse("2026-01-01T00:10:00Z");
    const previous = {
      id: "fence",
      version: 1,
      schemaVersion: 1 as const,
      kind: "FENCE" as const,
      workspaceId: "workspace",
      projectId: "project",
      actorRef: "person",
      correlationId: "old",
      createdAt: "2026-01-01T00:00:00.000Z",
      body: { schemaVersion: 1, mode: "COHORT_WRITES", revoked: false },
    };
    const hash = pilotContentHash(previous);
    const query = vi.fn(async (sql: string) =>
      sql.includes("SELECT r.semantic_body")
        ? [{ semantic_body: previous, content_hash: hash, row_version: 1 }]
        : [],
    );
    const manager = { query, queryRunner: { isTransactionActive: true } };
    const source = {
      transaction: async (_isolation: string, work: (manager: object) => Promise<unknown>) =>
        await work(manager),
    };
    const publish = vi
      .spyOn(PilotRepository.prototype, "publish")
      .mockImplementation(async (record) => record);
    const authority = {
      workspaceId: "workspace",
      projectId: "project",
      authorize: vi.fn(async () => ({
        actor: { kind: "HUMAN", principalId: "person", issuer: "issuer", subject: "subject" },
        basis: {
          kind: "PROJECT",
          entitlementRefs: [{ id: "e", version: 1 }],
          roleAssignmentRefs: [{ id: "r", version: 1 }],
          membershipRef: { id: "m", version: 1 },
        },
        classificationCeiling: "CONFIDENTIAL",
        stepUpAt: "2026-01-01T00:09:00Z",
      })),
    };
    const service = new DurablePilotFenceRevocation(source as never, () => now);
    const result = await service.revoke(authority as never, {
      id: "fence",
      version: 1,
      contentHash: hash,
    });
    expect(result).toMatchObject({ id: "fence", version: 2, replayed: false });
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        version: 2,
        body: { schemaVersion: 1, mode: "COHORT_WRITES", revoked: true },
      }),
      1,
      manager,
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO audit_events"),
      expect.any(Array),
    );
    expect(authority.authorize).toHaveBeenCalledTimes(2);
  });

  it("rejects a stale fence before writing a new revision", async () => {
    const source = {
      transaction: async (_isolation: string, work: (manager: object) => Promise<unknown>) =>
        await work({ query: async () => [] }),
    };
    const authority = {
      workspaceId: "workspace",
      projectId: "project",
      authorize: async () => ({
        actor: { kind: "HUMAN", principalId: "person", issuer: "issuer", subject: "subject" },
        basis: {
          kind: "PROJECT",
          entitlementRefs: [{ id: "e", version: 1 }],
          roleAssignmentRefs: [{ id: "r", version: 1 }],
        },
        classificationCeiling: "CONFIDENTIAL",
        stepUpAt: "2026-01-01T00:09:00Z",
      }),
    };
    const publish = vi.spyOn(PilotRepository.prototype, "publish");
    const service = new DurablePilotFenceRevocation(source as never, () =>
      Date.parse("2026-01-01T00:10:00Z"),
    );
    await expect(
      service.revoke(authority as never, {
        id: "fence",
        version: 1,
        contentHash: `sha256:${"a".repeat(64)}`,
      }),
    ).rejects.toThrow("PILOT_FENCE_VERSION_CONFLICT");
    expect(publish).not.toHaveBeenCalled();
  });
});
