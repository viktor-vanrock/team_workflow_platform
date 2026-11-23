import type { DataSource } from "typeorm";
import { describe, expect, it, vi } from "vitest";

import { TypeOrmScopedAccessRepository } from "../../packages/platform-persistence-typeorm/src/index.ts";

describe("TypeORM live authorization facts", () => {
  it("preserves role and entitlement revocation timestamps for effect-time policy", async () => {
    const revokedAt = new Date("2026-08-31T12:00:00.000Z");
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM workspace_memberships")) {
        return [
          {
            id: "membership-1",
            workspace_id: "workspace-1",
            principal_id: "principal-1",
            state: "ACTIVE",
            valid_from: new Date("2026-01-01T00:00:00.000Z"),
            valid_until: null,
            revoked_at: revokedAt,
            row_version: 1,
          },
        ];
      }
      if (sql.includes("FROM role_assignments")) {
        return [
          {
            id: "role-1",
            workspace_id: "workspace-1",
            project_id: "project-1",
            principal_id: "principal-1",
            role_key: "requester",
            effect: "ALLOW",
            permissions: ["qa.request.confirm"],
            valid_from: new Date("2026-01-01T00:00:00.000Z"),
            valid_until: null,
            revoked_at: revokedAt,
            row_version: 4,
          },
        ];
      }
      if (sql.includes("FROM project_entitlements")) {
        return [
          {
            id: "entitlement-1",
            workspace_id: "workspace-1",
            project_id: "project-1",
            principal_id: "principal-1",
            effect: "ALLOW",
            permissions: ["qa.request.confirm"],
            classification_ceiling_key: "INTERNAL",
            rank: 10,
            valid_from: new Date("2026-01-01T00:00:00.000Z"),
            valid_until: null,
            revoked_at: revokedAt,
            row_version: 7,
          },
        ];
      }
      throw new Error(`UNEXPECTED_SQL:${sql}`);
    });
    const source = { query } as unknown as DataSource;

    const facts = await new TypeOrmScopedAccessRepository(source).authorizationFacts(
      { kind: "PROJECT", workspaceId: "workspace-1", projectId: "project-1" },
      "principal-1",
      new Date("2026-08-31T12:01:00.000Z"),
    );

    expect(facts.membership?.revokedAt).toEqual(revokedAt);
    expect(facts.roleAssignments[0]?.revokedAt).toEqual(revokedAt);
    expect(facts.entitlements[0]?.revokedAt).toEqual(revokedAt);
  });
});
