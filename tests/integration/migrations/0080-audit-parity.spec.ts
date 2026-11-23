import type { QueryRunner } from "typeorm";
import { describe, expect, it } from "vitest";

import { AuditEventEntity } from "../../../packages/platform-persistence-typeorm/src/entities/audit.entities.ts";
import { coreEntities } from "../../../packages/platform-persistence-typeorm/src/entities/composition.ts";
import { M0080Audit1700000000080 } from "../../../packages/platform-persistence-typeorm/src/migrations/core/0080-audit.ts";

describe("T073 migration 0080 audit parity", () => {
  it("keeps the entity registered while PostgreSQL owns partitioning and append-only enforcement", async () => {
    const sql: string[] = [];
    await new M0080Audit1700000000080().up({
      query: async (value: string) => {
        sql.push(value);
      },
    } as unknown as QueryRunner);
    const text = sql.join("\n");
    expect(AuditEventEntity.options.tableName).toBe("audit_events");
    expect(coreEntities).toContain(AuditEventEntity);
    expect(text).toContain("PARTITION BY RANGE");
    expect(text).toContain("audit_events_append_only");
    expect(text).toContain("REVOKE UPDATE, DELETE");
  });
});
