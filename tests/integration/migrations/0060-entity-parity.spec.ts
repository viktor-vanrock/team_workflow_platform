import type { QueryRunner } from "typeorm";
import { describe, expect, it } from "vitest";

import { approvalsIdempotencyEntities } from "../../../packages/platform-persistence-typeorm/src/entities/approvals-idempotency.entities.ts";
import { coreEntities } from "../../../packages/platform-persistence-typeorm/src/entities/composition.ts";
import { M0060ApprovalsIdempotency1700000000060 } from "../../../packages/platform-persistence-typeorm/src/migrations/core/0060-approvals-idempotency.ts";

describe("T071 migration 0060 entity parity", () => {
  it("registers every explicit table and exact identity columns", async () => {
    const sql: string[] = [];
    await new M0060ApprovalsIdempotency1700000000060().up({
      query: async (value: string) => {
        sql.push(value);
      },
    } as unknown as QueryRunner);
    expect(approvalsIdempotencyEntities.map((entity) => entity.options.tableName)).toEqual([
      "approvals",
      "platform_actions",
      "client_request_idempotency",
    ]);
    expect(approvalsIdempotencyEntities.every((entity) => coreEntities.includes(entity))).toBe(
      true,
    );
    expect(sql.join("\n")).toContain("UNIQUE(action_kind,action_id)");
    expect(sql.join("\n")).toContain(
      "PRIMARY KEY(workspace_id,project_id,actor_id,operation,client_key)",
    );
  });
});
