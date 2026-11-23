import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AuthorizedProjectQueryToken } from "../../../../packages/platform-core/src/index.ts";
import {
  coreEntities,
  coreMigrationRegistry,
  createPlatformDataSource,
  migrationClasses,
} from "../../../../packages/platform-persistence-typeorm/src/index.ts";
import {
  type RunningPostgres,
  startPostgres,
} from "../../../../packages/platform-testkit/src/postgres.ts";
import { InMemoryProjectSearchIndex } from "../../../../packages/runtime-composition/src/onboarding/project-search.ts";
import { PilotDeadLetterService } from "../../../../packages/runtime-composition/src/pilot/dead-letter-service.ts";
import { seedDeadLetterFixture } from "../../../support/008-dead-letter.ts";
import { POSTGRES_TEST_IMAGES } from "../../../testcontainers.config.ts";

describe.runIf(process.env.AWP_RUN_CONTAINER_TESTS === "true").each(POSTGRES_TEST_IMAGES)(
  "008 dead-letter access isolation on %s",
  (image) => {
    let postgres: RunningPostgres, source: ReturnType<typeof createPlatformDataSource>;
    beforeAll(async () => {
      postgres = await startPostgres(image);
      source = createPlatformDataSource({
        url: postgres.url,
        entities: coreEntities,
        migrations: migrationClasses(coreMigrationRegistry),
      });
      await source.initialize();
      await source.runMigrations({ transaction: "all" });
    }, 120000);
    afterAll(async () => {
      if (source?.isInitialized) await source.destroy();
      await postgres?.stop();
    });
    it("isolates two Workspaces and two Projects for HUMAN/SERVICE access, pagination and report projection", async () => {
      const a = await seedDeadLetterFixture(source),
        b = await seedDeadLetterFixture(source, { workspaceId: a.command.workspaceId }),
        c = await seedDeadLetterFixture(source);
      const fixtures = [a, b, c];
      const service = new PilotDeadLetterService(
        source,
        fixtures.map((value) => value.policy),
        {
          check: async (command, approval, manager, now) => {
            const fixture = fixtures.find((value) => value.command.id === command.id);
            if (!fixture) throw new Error("FIXTURE_SCOPE_DENIED");
            return fixture.guard.check(command, approval, manager, now);
          },
        },
        () => a.state.now,
      );
      for (const value of fixtures) await service.capture(value.context, value.command.id);
      for (const value of fixtures) {
        const page = await service.list(value.context, { limit: 1 });
        expect(page.items).toHaveLength(1);
        expect(page.items[0]!.commandId).toBe(value.command.id);
        expect(Object.keys(page.items[0]!).sort()).toEqual(
          [
            "attemptCount",
            "certainty",
            "commandAgeMs",
            "commandId",
            "eligibility",
            "expiresAt",
            "firstFailureAt",
            "lastFailureAt",
            "ownerRef",
            "reasonCode",
            "recordRef",
            "replayCount",
            "rowVersion",
          ].sort(),
        );
        expect(JSON.stringify(page)).not.toContain("PRIVATE_PROVIDER_PAYLOAD_CANARY");
      }
      expect((await service.list(a.context)).items.map((value) => value.commandId)).not.toContain(
        b.command.id,
      );
      await expect(service.list({ ...a.context, projectId: b.command.projectId })).rejects.toThrow(
        "ACCESS_DENIED",
      );
      await expect(
        service.list({
          ...a.context,
          workspaceId: c.command.workspaceId,
          projectId: c.command.projectId,
        }),
      ).rejects.toThrow("ACCESS_DENIED");
      const serviceRead = {
        ...a.context,
        authorize: async (permission: "pilot.replay.read" | "pilot.replay.decide") => ({
          ...(await a.context.authorize(permission)),
          actor: { kind: "SERVICE" as const, principalId: a.operator, serviceKey: "reporter" },
        }),
      };
      expect((await service.list(serviceRead)).items).toHaveLength(1);
      await expect(service.replay(serviceRead, await a.input())).rejects.toThrow("ACCESS_DENIED");
      await expect(
        service.list(a.context, { after: "00000000-0000-0000-0000-000000000000' OR true--" }),
      ).rejects.toThrow("QUERY_INVALID");
      await expect(service.list(a.context, { limit: 0 })).rejects.toThrow("QUERY_INVALID");
    });
    it("binds search cursors, cached projections and export surfaces to the exact authorized project set", () => {
      const workspaceId = "00000000-0000-4000-8000-000000000701";
      const projectA = "00000000-0000-4000-8000-000000000711",
        projectB = "00000000-0000-4000-8000-000000000712",
        projectC = "00000000-0000-4000-8000-000000000713";
      const index = new InMemoryProjectSearchIndex([
        {
          workspaceId,
          projectId: projectA,
          projectName: "Visible alpha",
          classificationRank: 10,
          workItemIds: ["work-a"],
          queueEntryIds: ["queue-a"],
        },
        {
          workspaceId,
          projectId: projectB,
          projectName: "Visible beta",
          classificationRank: 10,
          workItemIds: ["work-b"],
          queueEntryIds: ["queue-b"],
        },
        {
          workspaceId,
          projectId: projectC,
          projectName: "PRIVATE_HIDDEN_PROJECT_CANARY",
          classificationRank: 10,
          workItemIds: ["hidden-work"],
          queueEntryIds: ["hidden-queue"],
        },
      ]);
      const issue = (principalId: string, projects: readonly string[]) =>
        AuthorizedProjectQueryToken.issue({
          workspaceId,
          principalId,
          permission: "pilot.report.read",
          issuedAt: "2026-09-04T12:00:00.000Z",
          projects: projects.map((projectId, index) => ({
            projectId,
            classificationCeilingRank: 20,
            operationalState: "ACTIVE" as const,
            entitlementRef: { id: `entitlement-${principalId}-${index}`, version: 1 },
          })),
        });
      const human = issue("human", [projectA, projectB]),
        service = issue("service", [projectB]);
      const first = index.search(human, "Visible", 1),
        report = index.catalog(human),
        exports = index.catalog(service);
      expect(first.items.map((value) => value.projectId)).toEqual([projectA]);
      expect(first.nextCursor).toBeDefined();
      expect(report.map((value) => value.projectId)).toEqual([projectA, projectB]);
      expect(exports.map((value) => value.projectId)).toEqual([projectB]);
      expect(JSON.stringify({ first, report, exports })).not.toContain(
        "PRIVATE_HIDDEN_PROJECT_CANARY",
      );
      expect(() => index.search(service, "Visible", 10, first.nextCursor)).toThrow(
        "PROJECT_SEARCH_CURSOR_SCOPE_MISMATCH",
      );
      expect(index.onboarding(human, projectC)).toEqual(
        index.onboarding(human, "00000000-0000-4000-8000-000000000799"),
      );
    });
  },
);
