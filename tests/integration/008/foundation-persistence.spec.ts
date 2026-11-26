import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  AuthorizedProjectQueryToken,
  pilotContentHash,
  type PilotRecord,
} from "../../../packages/platform-core/src/index.ts";
import {
  coreEntities,
  coreMigrationRegistry,
  createPlatformDataSource,
  migrationClasses,
  PilotRepository,
} from "../../../packages/platform-persistence-typeorm/src/index.ts";
import { startPostgres } from "../../../packages/platform-testkit/src/postgres.ts";
import { pilotFixtureIds as ids } from "../../support/008-pilot-fixture.ts";
import { POSTGRES_TEST_IMAGES } from "../../testcontainers.config.ts";

const enabled = process.env.AWP_RUN_CONTAINER_TESTS === "true";
describe.runIf(enabled)("008 actual PostgreSQL foundation", () => {
  it.each(POSTGRES_TEST_IMAGES)(
    "upgrades 007, preserves rows and enforces immutable scoped CAS on %s",
    async (image) => {
      const postgres = await startPostgres(image);
      const before = createPlatformDataSource({
        url: postgres.url,
        entities: [],
        migrations: migrationClasses(coreMigrationRegistry.filter(({ order }) => order <= 160)),
      });
      const after = createPlatformDataSource({
        url: postgres.url,
        entities: [...coreEntities],
        migrations: migrationClasses(coreMigrationRegistry),
      });
      try {
        await before.initialize();
        await before.runMigrations({ transaction: "all" });
        await before.query(
          "INSERT INTO classification_catalog(key,rank) VALUES('INTERNAL',10) ON CONFLICT DO NOTHING",
        );
        await before.query(
          "INSERT INTO identities(id,issuer,subject,kind,display_name,row_version,created_at) VALUES($1,'fixture','owner','HUMAN','Owner',1,now())",
          [ids.human],
        );
        for (const [id, key] of [
          [ids.workspaceA, "a"],
          [ids.workspaceB, "b"],
        ])
          await before.query(
            "INSERT INTO workspaces(id,key,name,state,row_version,created_at) VALUES($1,$2,$2,'ACTIVE',1,now())",
            [id, key],
          );
        for (const [id, workspace, key] of [
          [ids.projectA, ids.workspaceA, "a"],
          [ids.projectB, ids.workspaceA, "b"],
          [ids.projectOther, ids.workspaceB, "c"],
        ])
          await before.query(
            "INSERT INTO projects(id,workspace_id,key,name,state,classification_key,row_version,created_at) VALUES($1,$2,$3,$3,'ACTIVE','INTERNAL',1,now())",
            [id, workspace, key],
          );
        const baselineProjects = await before.query("SELECT * FROM projects ORDER BY id");
        await before.destroy();
        await after.initialize();
        expect(await after.runMigrations({ transaction: "all" })).toHaveLength(
          coreMigrationRegistry.filter(({ order }) => order > 160).length,
        );
        expect(
          await after.query("SELECT version FROM platform_schema_versions WHERE namespace='core'"),
        ).toEqual([{ version: 255 }]);
        expect(await after.runMigrations({ transaction: "all" })).toEqual([]);
        expect(await after.query("SELECT * FROM projects ORDER BY id")).toEqual(baselineProjects);
        const repo = new PilotRepository(after);
        const subjectRef = {
          id: randomUUID(),
          version: 1,
          contentHash: `sha256:${"a".repeat(64)}` as const,
        };
        const blocked = await repo.recordOnboardingGate(
          {
            id: randomUUID(),
            workspaceId: ids.workspaceA,
            projectId: ids.projectA,
            kind: "C1",
            subjectRef,
            evaluatorId: ids.service,
            evaluatedAt: new Date().toISOString(),
            executions: [],
          },
          { verify: async () => false },
        );
        expect(blocked.outcome).toBe("BLOCKED_INPUT");
        expect(
          await after.query(
            "SELECT gate_kind,outcome,valid_until FROM project_onboarding_gate_results WHERE gate_result_id=$1",
            [blocked.id],
          ),
        ).toEqual([{ gate_kind: "C1", outcome: "BLOCKED_INPUT", valid_until: null }]);
        const id = randomUUID();
        const record = (version = 1, value = "original"): PilotRecord => {
          const body = {
            id,
            schemaVersion: 1 as const,
            version,
            workspaceId: ids.workspaceA,
            projectId: ids.projectA,
            kind: "COHORT" as const,
            actorRef: ids.human,
            correlationId: "foundation",
            createdAt: new Date().toISOString(),
            body: { value },
          };
          return { ...body, contentHash: pilotContentHash(body) };
        };
        const first = record();
        expect(await repo.publish(first, 0)).toEqual(first);
        expect(await repo.publish(first, 0)).toEqual(first);
        await expect(repo.publish(record(), 0)).rejects.toThrow("PILOT_IMMUTABLE_CONFLICT");
        const race = await Promise.allSettled([
          repo.publish(record(2, "winner-a"), 1),
          repo.publish(record(2, "winner-b"), 1),
        ]);
        expect(race.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
        await expect(repo.publish(record(4), 3)).rejects.toThrow("PILOT_VERSION_CONFLICT");
        expect(
          await after.query("SELECT version FROM pilot_record_revisions ORDER BY version"),
        ).toEqual([{ version: 1 }, { version: 2 }]);
        const token = AuthorizedProjectQueryToken.issue({
          workspaceId: ids.workspaceA,
          principalId: ids.human,
          permission: "pilot.report.read",
          issuedAt: new Date(),
          projects: [
            {
              projectId: ids.projectA,
              classificationCeilingRank: 20,
              operationalState: "ACTIVE",
              entitlementRef: { id: "entitlement", version: 1 },
            },
          ],
        });
        expect((await repo.current(token, first, id))?.version).toBe(2);
        expect(await repo.list(token, first, "COHORT")).toHaveLength(1);
        await expect(
          repo.list(token, { workspaceId: ids.workspaceA, projectId: ids.projectB }, "COHORT"),
        ).rejects.toThrow("PROJECT_RESOURCE_NOT_AVAILABLE");
        await expect(
          repo.current(token, { workspaceId: ids.workspaceB, projectId: ids.projectOther }, id),
        ).rejects.toThrow("PROJECT_RESOURCE_NOT_AVAILABLE");
        await expect(
          after.query("UPDATE pilot_record_revisions SET content_hash=$1", [
            `sha256:${"b".repeat(64)}`,
          ]),
        ).rejects.toThrow();
        await expect(after.query("DELETE FROM pilot_record_revisions")).rejects.toThrow();
        await expect(after.query("UPDATE pilot_record_headers SET row_version=99")).rejects.toThrow(
          "PILOT_HEADER_CAS_REQUIRED",
        );
        await expect(after.query("DELETE FROM pilot_record_headers")).rejects.toThrow(
          "PILOT_HEADER_DELETE_FORBIDDEN",
        );
        const cross = { ...record(), id: randomUUID(), workspaceId: ids.workspaceB };
        await expect(
          repo.publish(
            {
              ...cross,
              contentHash: pilotContentHash(
                Object.fromEntries(Object.entries(cross).filter(([key]) => key !== "contentHash")),
              ),
            },
            0,
          ),
        ).rejects.toThrow(/foreign key/iu);
      } finally {
        if (before.isInitialized) await before.destroy();
        if (after.isInitialized) await after.destroy();
        await postgres.stop();
      }
    },
    180_000,
  );
});
