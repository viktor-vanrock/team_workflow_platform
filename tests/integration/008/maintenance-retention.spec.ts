import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { onboardingContentHash } from "../../../packages/platform-core/src/index.ts";
import type { ArtifactRetentionDecision } from "../../../packages/platform-persistence-typeorm/src/artifact-retention.repository.ts";
import {
  ArtifactRetentionRepository,
  coreMigrationRegistry,
  createPlatformDataSource,
  migrationClasses,
} from "../../../packages/platform-persistence-typeorm/src/index.ts";
import { startPostgres } from "../../../packages/platform-testkit/src/postgres.ts";
import { createArtifactRetentionMaintenanceWorker } from "../../../packages/runtime-composition/src/pilot/maintenance-workers.ts";
import { pilotFixtureIds as ids } from "../../support/008-pilot-fixture.ts";
import { POSTGRES_TEST_IMAGES } from "../../testcontainers.config.ts";

const now = "2026-09-04T12:00:00.000Z";
const earlier = "2026-09-04T11:00:00.000Z";
const scope = { workspaceId: ids.workspaceA, projectId: ids.projectA };
const ref = () => ({
  id: randomUUID(),
  version: 1,
  contentHash: `sha256:${"a".repeat(64)}` as const,
});

describe.runIf(process.env.AWP_RUN_CONTAINER_TESTS === "true").each(POSTGRES_TEST_IMAGES)(
  "008 retention maintenance on %s",
  (image) => {
    let postgres: Awaited<ReturnType<typeof startPostgres>>;
    let source: ReturnType<typeof createPlatformDataSource>;
    let repo: ArtifactRetentionRepository;
    beforeAll(async () => {
      postgres = await startPostgres(image);
      source = createPlatformDataSource({
        url: postgres.url,
        entities: [],
        migrations: migrationClasses(coreMigrationRegistry),
      });
      await source.initialize();
      await source.runMigrations({ transaction: "all" });
      repo = new ArtifactRetentionRepository(source);
      await source.query(
        "INSERT INTO classification_catalog(key,rank) VALUES('INTERNAL',10) ON CONFLICT DO NOTHING",
      );
      await source.query(
        "INSERT INTO identities(id,issuer,subject,kind,display_name,row_version,created_at) VALUES($1,'fixture','owner','HUMAN','Owner',1,now())",
        [ids.human],
      );
      await source.query(
        "INSERT INTO workspaces(id,key,name,state,row_version,created_at) VALUES($1,'retention','retention','ACTIVE',1,now())",
        [ids.workspaceA],
      );
      for (const [id, key] of [
        [ids.projectA, "a"],
        [ids.projectB, "b"],
      ])
        await source.query(
          "INSERT INTO projects(id,workspace_id,key,name,state,classification_key,row_version,created_at) VALUES($1,$2,$3,$3,'ACTIVE','INTERNAL',1,now())",
          [id, ids.workspaceA, key],
        );
    }, 180_000);
    afterAll(async () => {
      if (source?.isInitialized) await source.destroy();
      if (postgres) await postgres.stop();
    });

    async function artifact(): Promise<string> {
      const id = randomUUID();
      await source.query(
        `INSERT INTO artifact_references(id,workspace_id,project_id,owner_entity_type,owner_entity_id,artifact_kind,storage_provider_kind,opaque_locator,object_version_or_etag,file_name,media_type,size_bytes,checksum_algorithm,checksum,classification_key,availability,created_by,created_at,expires_at)
      VALUES($1,$2,$3,'session',$4,'ATTACHMENT','fixture','private-never-in-report','v1','attachment.txt','text/plain',3,'SHA256',$5,'INTERNAL','AVAILABLE',$6,$7,$8)`,
        [
          id,
          scope.workspaceId,
          scope.projectId,
          randomUUID(),
          ref().contentHash,
          ids.human,
          earlier,
          now,
        ],
      );
      return id;
    }
    function decision(
      artifactId: string,
      overrides: Partial<ArtifactRetentionDecision> = {},
    ): ArtifactRetentionDecision {
      const body = {
        decisionId: randomUUID(),
        version: 1 as const,
        ...scope,
        artifactId,
        retentionPolicyRef: ref(),
        decision: "EXPIRE" as const,
        eligibleAt: earlier,
        ownerPrincipalId: ids.human,
        reasonCode: "RETENTION_PERIOD_ENDED",
        createdAt: earlier,
        ...overrides,
      };
      return { ...body, contentHash: onboardingContentHash(body as never) };
    }

    it("executes due work, persists linked history and makes a restarted worker idempotent", async () => {
      const id = await artifact();
      const original = (
        await source.query("SELECT * FROM artifact_references WHERE id=$1", [id])
      )[0];
      const instruction = decision(id);
      await repo.appendDecision(instruction);
      const before = await repo.dueExpirations(now);
      expect(before.some((item) => item.artifactId === id)).toBe(true);
      const worker = createArtifactRetentionMaintenanceWorker(source, () => now);
      expect((await worker.run()).expired).toBeGreaterThanOrEqual(1);
      expect(
        (
          await source.query(
            "SELECT availability,checksum,opaque_locator FROM artifact_references WHERE id=$1",
            [id],
          )
        )[0],
      ).toEqual({
        availability: "EXPIRED",
        checksum: original.checksum,
        opaque_locator: original.opaque_locator,
      });
      const rows = (await source.query(
        "SELECT version,state,semantic_body FROM artifact_availability_revisions WHERE artifact_id=$1 ORDER BY version",
        [id],
      )) as {
        version: number;
        state: string;
        semantic_body: {
          previousRevisionRef?: { contentHash: string };
          contentHash: string;
          retentionDecisionRef?: unknown;
        };
      }[];
      expect(rows.map((row: { state: string }) => row.state)).toEqual(["AVAILABLE", "EXPIRED"]);
      expect(rows[1]!.semantic_body.previousRevisionRef!.contentHash).toBe(
        rows[0]!.semantic_body.contentHash,
      );
      expect(rows[1]!.semantic_body.retentionDecisionRef).toEqual({
        id: instruction.decisionId,
        version: 1,
        contentHash: instruction.contentHash,
      });
      expect(JSON.stringify(rows)).not.toContain("private-never-in-report");
      expect(await createArtifactRetentionMaintenanceWorker(source, () => now).run()).toEqual({
        inspected: 0,
        expired: 0,
      });
      await expect(
        source.query("DELETE FROM artifact_availability_revisions WHERE artifact_id=$1", [id]),
      ).rejects.toThrow();
    });

    it("does not infer permission to expire from object expiry or a future decision", async () => {
      const without = await artifact();
      const future = await artifact();
      await repo.appendDecision(decision(future, { eligibleAt: "2026-09-05T12:00:00.000Z" }));
      const due = await repo.dueExpirations(now);
      expect(due.map((item) => item.artifactId)).not.toContain(without);
      expect(due.map((item) => item.artifactId)).not.toContain(future);
    });

    it("rechecks a legal hold or replacement decision after discovery", async () => {
      const id = await artifact();
      await repo.appendDecision(decision(id));
      const candidate = (await repo.dueExpirations(now)).find((item) => item.artifactId === id)!;
      await repo.appendDecision(
        decision(id, { decision: "RETAIN", legalHoldRef: ref(), createdAt: now }),
      );
      expect(await repo.expireDue(candidate, now)).toBe(false);
      expect((await repo.dueExpirations(now)).map((item) => item.artifactId)).not.toContain(id);
      expect(
        (await source.query("SELECT availability FROM artifact_references WHERE id=$1", [id]))[0]
          .availability,
      ).toBe("AVAILABLE");
    });

    it("denies cross-project candidates and altered decision hashes", async () => {
      const id = await artifact();
      await repo.appendDecision(decision(id));
      const candidate = (await repo.dueExpirations(now)).find((item) => item.artifactId === id)!;
      expect(await repo.expireDue({ ...candidate, projectId: ids.projectB }, now)).toBe(false);
      expect(await repo.expireDue({ ...candidate, decisionRef: ref() }, now)).toBe(false);
      const invalid = decision(id, { projectId: ids.projectB });
      await expect(repo.appendDecision(invalid)).rejects.toThrow("ARTIFACT_NOT_FOUND");
      await expect(repo.appendDecision({ ...decision(id), reasonCode: "ALTERED" })).rejects.toThrow(
        "RETENTION_DECISION_INVALID",
      );
      await repo.expireDue(candidate, now);
    });

    it("serializes overlapping workers and never appends duplicate expiry revisions", async () => {
      const id = await artifact();
      await repo.appendDecision(decision(id));
      const candidate = (await repo.dueExpirations(now)).find((item) => item.artifactId === id)!;
      expect(
        (
          await Promise.all([repo.expireDue(candidate, now), repo.expireDue(candidate, now)])
        ).sort(),
      ).toEqual([false, true]);
      expect(
        (
          await source.query(
            "SELECT count(*)::int count FROM artifact_availability_revisions WHERE artifact_id=$1 AND state='EXPIRED'",
            [id],
          )
        )[0].count,
      ).toBe(1);
    });

    it("preserves quarantine and validates bounded batch/time inputs", async () => {
      const id = await artifact();
      await repo.appendDecision(decision(id));
      await source.query("UPDATE artifact_references SET availability='QUARANTINED' WHERE id=$1", [
        id,
      ]);
      expect((await repo.dueExpirations(now)).map((item) => item.artifactId)).not.toContain(id);
      await expect(repo.dueExpirations("invalid")).rejects.toThrow("RETENTION_QUERY_INVALID");
      await expect(repo.dueExpirations(now, 0)).rejects.toThrow("RETENTION_QUERY_INVALID");
    });
  },
);
