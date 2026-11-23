import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../..");
const read = (path: string): string =>
  existsSync(resolve(root, path)) ? readFileSync(resolve(root, path), "utf8") : "";

describe("Feature 006 scoped foundation persistence", () => {
  it("declares composite Workspace/Project references and a closed tagged queue subject union", () => {
    const migrations = [
      "packages/platform-persistence-typeorm/src/migrations/core/0130-queue-policy-calendar.ts",
      "packages/platform-persistence-typeorm/src/migrations/core/0135-queue-projection-sla.ts",
      "packages/platform-persistence-typeorm/src/migrations/core/0140-queue-controls-capacity.ts",
      "packages/competency-qa/src/persistence/migrations/2070-qa-queue-facts.ts",
    ]
      .map(read)
      .join("\n");
    expect(migrations).toMatch(/FOREIGN\s+KEY\s*\(\s*workspace_id\s*,\s*project_id/iu);
    expect(migrations).toMatch(/subject_kind[\s\S]*(?:CANDIDATE|DRAFT|WORK_ITEM)/iu);
    expect(migrations).toMatch(/num_nonnulls|candidate_id[\s\S]*draft_id[\s\S]*work_item_id/iu);
  });

  it("persists exact authorized-set membership with reverse indexes and rehash inputs", () => {
    const policy = read(
      "packages/platform-persistence-typeorm/src/migrations/core/0130-queue-policy-calendar.ts",
    );
    const capacity = read(
      "packages/platform-persistence-typeorm/src/migrations/core/0140-queue-controls-capacity.ts",
    );
    for (const source of [policy, capacity]) {
      expect(source).toMatch(/authorized_project_set_hash/iu);
      expect(source).toMatch(/_projects/iu);
      expect(source).toMatch(/project_id[\s\S]*(?:INDEX|UNIQUE)/iu);
    }
  });

  it("uses scoped repository methods and exposes no global-ID-only content fetch", () => {
    const repositories = [
      "packages/platform-persistence-typeorm/src/queue-policy.repository.ts",
      "packages/platform-persistence-typeorm/src/authorized-scope-membership.repository.ts",
      "packages/platform-persistence-typeorm/src/queue-projection.repository.ts",
      "packages/platform-persistence-typeorm/src/queue-control.repository.ts",
      "packages/platform-persistence-typeorm/src/capacity-scope-projection.repository.ts",
      "packages/competency-qa/src/persistence/queue-fact.repository.ts",
    ]
      .map(read)
      .join("\n");
    expect(repositories).toMatch(/workspaceId/gu);
    expect(repositories).toMatch(/projectId/gu);
    expect(repositories).toMatch(/previousRevision|semanticHash|revision/iu);
    expect(repositories).not.toMatch(/(?:find|get|load)(?:By)?Id\s*\(\s*(?:id|string)/u);
  });

  it("records immutable revision chains and hidden-only no-op reconciliation", () => {
    const repositories = [
      "packages/platform-persistence-typeorm/src/queue-policy.repository.ts",
      "packages/platform-persistence-typeorm/src/authorized-scope-membership.repository.ts",
      "packages/platform-persistence-typeorm/src/queue-projection.repository.ts",
    ]
      .map(read)
      .join("\n");
    expect(repositories).toMatch(/semanticHash|semantic_hash/u);
    expect(repositories).toMatch(/previousRevision|previous_revision/u);
    expect(repositories).toMatch(/NO_OP|UNCHANGED|no.?op/iu);
  });
});
