import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  QaEvidenceIntegrity20851700000002085,
  qaMigrationContributions,
  QaProjectResources20801700000002080,
} from "../../../packages/competency-qa/src/persistence/migrations/index.ts";
import {
  coreMigrationRegistry,
  createPlatformDataSource,
  migrationClasses,
} from "../../../packages/platform-persistence-typeorm/src/index.ts";
import {
  M0150ProjectOnboarding1700000000150,
  M0155ProjectBindingEntitlements1700000000155,
  M0160ArtifactRetentionExport1700000000160,
} from "../../../packages/platform-persistence-typeorm/src/migrations/core/index.ts";
import { startPostgres } from "../../../packages/platform-testkit/src/postgres.ts";
import { POSTGRES_TEST_IMAGES } from "../../testcontainers.config.ts";

async function emittedSql(
  Migration: new () => { up(runner: { query(sql: string): Promise<void> }): Promise<void> },
): Promise<string> {
  const statements: string[] = [];
  await new Migration().up({
    query: async (sql) => {
      statements.push(sql);
    },
  });
  return statements.join("\n");
}

class Feature007InjectedFailure1700000009999 {
  readonly name = "Feature007InjectedFailure1700000009999";
  async up(runner: { query(sql: string): Promise<void> }): Promise<void> {
    await runner.query("CREATE TABLE feature_007_failed_migration_probe(id integer PRIMARY KEY)");
    throw new Error("FEATURE_007_INJECTED_MIGRATION_FAILURE");
  }
  async down(runner: { query(sql: string): Promise<void> }): Promise<void> {
    await runner.query("DROP TABLE IF EXISTS feature_007_failed_migration_probe");
  }
}

function databaseUrl(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

describe("Feature 007 additive migration shapes", () => {
  it("contains complete Core Project/onboarding, entitlement/Binding and artifact/export shapes", async () => {
    const [m150, m155, m160] = await Promise.all([
      emittedSql(M0150ProjectOnboarding1700000000150),
      emittedSql(M0155ProjectBindingEntitlements1700000000155),
      emittedSql(M0160ArtifactRetentionExport1700000000160),
    ]);
    expect(m150).toContain("project_registry_revisions");
    expect(m150).toContain("project_onboarding_revisions");
    expect(m150).toContain("workspace_project_rollout_leases");
    expect(m155).toContain("project_entitlement_revisions");
    expect(m155).toContain("binding_functional_acceptances");
    expect(m155).toContain("capability_probe_results");
    expect(m160).toContain("artifact_availability_revisions");
    expect(m160).toContain("evidence_export_records");
    expect(`${m150}\n${m155}\n${m160}`).toMatch(/UPDATE platform_schema_versions[\s\S]*160/iu);
  });

  it("contains complete QA resource/evidence shapes and append-only guards", async () => {
    const [m2080, m2085] = await Promise.all([
      emittedSql(QaProjectResources20801700000002080),
      emittedSql(QaEvidenceIntegrity20851700000002085),
    ]);
    expect(m2080).toContain("qa_project_environment_revisions");
    expect(m2080).toContain("qa_test_account_leases");
    expect(m2085).toContain("qa_target_snapshots_v2");
    expect(m2085).toContain("qa_evidence_manifest_revisions_v2");
    expect(m2085).toContain("qa_evidence_signature_envelopes");
    expect(`${m2080}\n${m2085}`).toContain("qa_append_only");
    expect(m2085).toMatch(/UPDATE platform_schema_versions[\s\S]*2085/iu);
  });

  it("is schema-only and never performs provider/network work", async () => {
    const sql = (
      await Promise.all([
        emittedSql(M0150ProjectOnboarding1700000000150),
        emittedSql(M0155ProjectBindingEntitlements1700000000155),
        emittedSql(M0160ArtifactRetentionExport1700000000160),
        emittedSql(QaProjectResources20801700000002080),
        emittedSql(QaEvidenceIntegrity20851700000002085),
      ])
    ).join("\n");
    expect(sql).not.toMatch(/https?:\/\/|jira sdk|gitlab sdk|mattermost sdk/iu);
  });
});

const runPostgresMatrix =
  process.env.AWP_RUN_CONTAINER_TESTS === "true" ||
  process.env.AWP_TEST_POSTGRES_IMAGE !== undefined;
const selectedPostgresImages = process.env.AWP_TEST_POSTGRES_IMAGE
  ? POSTGRES_TEST_IMAGES.filter((image) => image === process.env.AWP_TEST_POSTGRES_IMAGE)
  : POSTGRES_TEST_IMAGES;
describe.runIf(runPostgresMatrix)("Feature 007 PostgreSQL 17/18 foundation matrix", () => {
  it.each(selectedPostgresImages)(
    "runs fresh, 0140/2070 upgrade, repeat, bootstrap and failed recovery on %s",
    async (image) => {
      const postgres = await startPostgres(image);
      try {
        const admin = createPlatformDataSource({ url: postgres.url, entities: [], migrations: [] });
        await admin.initialize();
        await admin.query("CREATE DATABASE feature_007_upgrade");
        await admin.query("CREATE DATABASE feature_007_failed");
        await admin.destroy();

        const full = migrationClasses([
          ...coreMigrationRegistry.filter(({ order }) => order <= 160),
          ...qaMigrationContributions.filter(({ order }) => order <= 2085),
        ]);
        const previous = migrationClasses([
          ...coreMigrationRegistry.filter(({ order }) => order <= 140),
          ...qaMigrationContributions.filter(({ order }) => order <= 2070),
        ]);
        const fresh = createPlatformDataSource({
          url: postgres.url,
          entities: [],
          migrations: full,
        });
        await fresh.initialize();
        await fresh.runMigrations({ transaction: "all" });
        expect(await fresh.runMigrations({ transaction: "all" })).toEqual([]);
        expect(
          await fresh.query(
            "SELECT namespace,version FROM platform_schema_versions WHERE namespace IN('core','pack:qa') ORDER BY namespace",
          ),
        ).toEqual([
          { namespace: "core", version: 160 },
          { namespace: "pack:qa", version: 2085 },
        ]);
        await fresh.destroy();

        const upgradeUrl = databaseUrl(postgres.url, "feature_007_upgrade");
        const baseline = createPlatformDataSource({
          url: upgradeUrl,
          entities: [],
          migrations: previous,
        });
        await baseline.initialize();
        await baseline.runMigrations({ transaction: "all" });
        const identityId = "00000000-0000-4000-8000-000000000725";
        const workspaceId = "00000000-0000-4000-8000-000000000701";
        const projectId = "00000000-0000-4000-8000-000000000711";
        await baseline.query(
          "INSERT INTO classification_catalog(key,rank) VALUES('INTERNAL',20) ON CONFLICT(key) DO NOTHING",
        );
        await baseline.query(
          "INSERT INTO identities(id,issuer,subject,kind,display_name,row_version,created_at) VALUES($1,'fixture','owner','HUMAN','Owner',1,clock_timestamp())",
          [identityId],
        );
        await baseline.query(
          "INSERT INTO workspaces(id,key,name,state,row_version,created_at) VALUES($1,'fixture','Fixture','ACTIVE',1,clock_timestamp())",
          [workspaceId],
        );
        await baseline.query(
          "INSERT INTO projects(id,workspace_id,key,name,state,classification_key,row_version,created_at) VALUES($1,$2,'project-a','Project A','ACTIVE','INTERNAL',1,clock_timestamp())",
          [projectId, workspaceId],
        );
        await baseline.destroy();

        const upgraded = createPlatformDataSource({
          url: upgradeUrl,
          entities: [],
          migrations: full,
        });
        await upgraded.initialize();
        expect(await upgraded.runMigrations({ transaction: "all" })).toHaveLength(5);
        const bootstrapped = (await upgraded.query(
          "SELECT onboarding_stage,qa_capability_mode,project_operational_state,gate_result_refs,content_hash FROM project_onboarding_revisions WHERE workspace_id=$1 AND project_id=$2",
          [workspaceId, projectId],
        )) as Array<Record<string, unknown>>;
        expect(bootstrapped).toHaveLength(1);
        expect(bootstrapped[0]).toMatchObject({
          onboarding_stage: "DRAFT",
          qa_capability_mode: "MANUAL_ONLY",
          project_operational_state: "ACTIVE",
          gate_result_refs: [],
        });
        expect(String(bootstrapped[0]?.content_hash)).toMatch(/^sha256:[a-f0-9]{64}$/u);
        const firstHash = createHash("sha256").update(JSON.stringify(bootstrapped)).digest("hex");
        expect(await upgraded.runMigrations({ transaction: "all" })).toEqual([]);
        const restarted = await upgraded.query(
          "SELECT onboarding_stage,qa_capability_mode,project_operational_state,gate_result_refs,content_hash FROM project_onboarding_revisions WHERE workspace_id=$1 AND project_id=$2",
          [workspaceId, projectId],
        );
        expect(createHash("sha256").update(JSON.stringify(restarted)).digest("hex")).toBe(
          firstHash,
        );
        await upgraded.destroy();

        const failedUrl = databaseUrl(postgres.url, "feature_007_failed");
        const failing = createPlatformDataSource({
          url: failedUrl,
          entities: [],
          migrations: [...full, Feature007InjectedFailure1700000009999],
        });
        await failing.initialize();
        await expect(failing.runMigrations({ transaction: "all" })).rejects.toThrow(
          "FEATURE_007_INJECTED_MIGRATION_FAILURE",
        );
        expect(
          await failing.query(
            "SELECT to_regclass('public.feature_007_failed_migration_probe') AS probe",
          ),
        ).toEqual([{ probe: null }]);
        await failing.destroy();
      } finally {
        await postgres.stop();
      }
    },
    360_000,
  );
});
