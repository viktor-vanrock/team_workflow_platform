import { describe, expect, it } from "vitest";

import { InMemoryIntakeFoundationRepository } from "../../../packages/platform-persistence-typeorm/src/intake-draft-revision.repository.ts";

describe("Intake foundation repository", () => {
  it("keeps contiguous revisions and shadow-writes canonical legacy content", async () => {
    const repository = new InMemoryIntakeFoundationRepository();
    await repository.create("w", "p", "d", { schemaVersion: 1 });
    await repository.append("w", "p", "d", 1, { schemaVersion: 1, title: "new" });
    expect(await repository.get("w", "p", "d")).toMatchObject({
      currentRevision: 2,
      legacyPayload: { schemaVersion: 1, title: "new" },
    });
  });
});
