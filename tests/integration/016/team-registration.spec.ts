import { describe, expect, it } from "vitest";

import { localPersonaIds } from "../../../packages/runtime-composition/src/seed/local-seed.ts";
import { startBindingHttpFixture } from "../../support/007-binding-http-fixture.ts";
import { POSTGRES_TEST_IMAGES } from "../../testcontainers.config.ts";

describe("016 new project shared-team enrollment", () => {
  it("atomically includes both QA people in starter grants and replays without duplicates", async () => {
    const f = await startBindingHttpFixture(POSTGRES_TEST_IMAGES[0]!);
    try {
      const body = {
        key: "SHAREDQA",
        name: "Shared team project",
        ownerIds: Object.fromEntries(
          ["business", "technical", "qa", "security", "escalation"].map((key) => [
            key,
            localPersonaIds["owner.local"],
          ]),
        ),
        criticalityKey: "STANDARD",
        dataClassificationKey: "INTERNAL",
        reason: "Verify shared team onboarding",
      };
      const created = await f.request("", "POST", body, "owner", "shared-team-project-015");
      expect(created, f.errors.join("; ")).toMatchObject({
        status: 201,
        body: { projectId: expect.any(String) },
      });
      const projectId = created.body.projectId;
      const grants = await f.source.query(
        "SELECT principal_id FROM project_entitlement_headers WHERE project_id=$1 AND principal_id=ANY($2) ORDER BY principal_id",
        [projectId, [localPersonaIds["executor.alpha"], localPersonaIds["executor.qa2"]]],
      );
      expect(grants).toEqual([
        { principal_id: localPersonaIds["executor.alpha"] },
        { principal_id: localPersonaIds["executor.qa2"] },
      ]);
      const count = await f.source.query(
        "SELECT count(*)::int AS n FROM project_entitlement_revisions WHERE project_id=$1",
        [projectId],
      );
      expect(created.body.starterEntitlementRefs).toHaveLength(count[0].n);
      expect(await f.request("", "POST", body, "owner", "shared-team-project-015")).toEqual(
        created,
      );
      expect(
        await f.source.query(
          "SELECT count(*)::int AS n FROM project_entitlement_revisions WHERE project_id=$1",
          [projectId],
        ),
      ).toEqual(count);
    } finally {
      await f.close();
    }
  }, 120_000);
});
