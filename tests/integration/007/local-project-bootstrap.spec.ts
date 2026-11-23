import { describe, expect, it } from "vitest";

import { lockOnboarding } from "../../../apps/api/src/extensions/onboarding/durable-http.ts";
import { loadEnvironment } from "../../../packages/runtime-composition/src/config/environment.ts";
import {
  ensureLocalSeedProjectOnboarding,
  TypeOrmProjectEffectGuard,
} from "../../../packages/runtime-composition/src/index.ts";
import { localSeedIds } from "../../../packages/runtime-composition/src/seed/local-seed.ts";
import { startEvidenceHttpFixture } from "../../support/007-evidence-http-fixture.ts";
import { POSTGRES_TEST_IMAGES } from "../../testcontainers.config.ts";

describe("007 fresh local project bootstrap", () => {
  it.each(POSTGRES_TEST_IMAGES)(
    "preserves conservative scope and suspension through reseed/restart on %s",
    async (image) => {
      const f = await startEvidenceHttpFixture(image);
      try {
        const environment = {
          ...loadEnvironment(),
          profile: "local" as const,
          environmentScope: "LOCAL" as const,
          externalNetworkMode: "deny" as const,
        };
        const guard = new TypeOrmProjectEffectGuard(f.source);
        await expect(guard.assertEffectsAllowed(f.scope)).rejects.toThrow(
          "PROJECT_EFFECT_SCOPE_DENIED",
        );
        await ensureLocalSeedProjectOnboarding(f.source, environment);
        // The project page uses this verified reader; the previous partial bootstrap failed it.
        await expect(
          f.source.transaction((manager) => lockOnboarding(manager, f.scope)),
        ).resolves.toMatchObject({
          version: 2,
          stage: "DRAFT",
          qaCapabilityMode: "MANUAL_ONLY",
          gateResultRefs: [],
        });
        expect(
          await f.source.query(
            "SELECT version,semantic_body ? 'contentHash' AS canonical FROM project_onboarding_revisions WHERE project_id=$1 ORDER BY version",
            [f.scope.projectId],
          ),
        ).toEqual([
          { version: 1, canonical: false },
          { version: 2, canonical: true },
        ]);
        await expect(guard.assertEffectsAllowed(f.scope)).resolves.toMatchObject({
          operationalState: "ACTIVE",
          onboardingVersion: 2,
        });
        await expect(
          guard.assertEffectsAllowed({ ...f.scope, projectId: localSeedIds.gamma }),
        ).rejects.toThrow("PROJECT_EFFECTS_SUSPENDED");
        expect(
          await f.source.query(
            "SELECT count(*)::int AS total FROM project_onboarding_headers WHERE current_stage='DRAFT' AND current_capability_mode='MANUAL_ONLY'",
          ),
        ).toEqual([{ total: 4 }]);
        await f.source.query(
          "UPDATE project_onboarding_headers SET current_operational_state='SUSPENDED',current_version=2 WHERE project_id=$1",
          [f.scope.projectId],
        );
        const before = await f.source.query(
          "SELECT * FROM project_onboarding_headers ORDER BY project_id",
        );
        await f.source.destroy();
        await f.source.initialize();
        await ensureLocalSeedProjectOnboarding(f.source, environment);
        expect(
          await f.source.query("SELECT * FROM project_onboarding_headers ORDER BY project_id"),
        ).toEqual(before);
        await expect(guard.assertEffectsAllowed(f.scope)).rejects.toThrow(
          "PROJECT_EFFECTS_SUSPENDED",
        );
        await expect(
          ensureLocalSeedProjectOnboarding(f.source, { ...environment, profile: "non-local" }),
        ).rejects.toThrow("LOCAL_PROJECT_BOOTSTRAP_FORBIDDEN");
      } finally {
        await f.close();
      }
    },
    120000,
  );
});
