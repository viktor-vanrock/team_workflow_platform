import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPlatformDataSource } from "../../../packages/platform-persistence-typeorm/src/index.ts";
import {
  type RunningPostgres,
  startPostgres,
} from "../../../packages/platform-testkit/src/index.ts";
import { loadEnvironment } from "../../../packages/runtime-composition/src/config/environment.ts";
import {
  qaJiraLocalEntities,
  qaJiraLocalMigrations,
} from "../../../packages/runtime-composition/src/qa/composition.ts";
import {
  qaJiraLocalBaseSeedRefs,
  qaJiraLocalSeedIds,
  qaJiraLocalSeedRefs,
  runQaJiraLocalSeed,
} from "../../../packages/runtime-composition/src/seed/qa-jira-local-seed.ts";
import {
  qaLocalSeedIds,
  runQaLocalSeed,
} from "../../../packages/runtime-composition/src/seed/qa-local-seed.ts";

describe("qa-local to qa-jira-local immutable seed transition", () => {
  let postgres: RunningPostgres;
  let source: ReturnType<typeof createPlatformDataSource>;

  beforeAll(async () => {
    postgres = await startPostgres();
    source = createPlatformDataSource({
      url: postgres.url,
      entities: qaJiraLocalEntities,
      migrations: qaJiraLocalMigrations,
    });
    await source.initialize();
    await source.runMigrations({ transaction: "all" });
  }, 120_000);

  afterAll(async () => {
    if (source?.isInitialized) await source.destroy();
    if (postgres) await postgres.stop();
  });

  const historicalRevisions = async () =>
    (await source.query(
      `
    SELECT 'CONNECTION' AS kind,id,version,content,content_hash FROM connection_revisions WHERE header_id=$1 AND version=1
    UNION ALL
    SELECT 'MAPPING' AS kind,id,version,content,content_hash FROM connector_mapping_revisions WHERE header_id=$2 AND version=1
    UNION ALL
    SELECT 'PROFILE' AS kind,id,version,content,content_hash FROM connector_profile_revisions WHERE header_id=$3 AND version<=4
    UNION ALL
    SELECT 'BINDING' AS kind,id,version,content,content_hash FROM project_integration_binding_revisions WHERE header_id=$4 AND version<=4
    ORDER BY kind,version
  `,
      [
        qaLocalSeedIds.connection,
        qaLocalSeedIds.mapping,
        qaLocalSeedIds.profile,
        qaLocalSeedIds.alphaBinding,
      ],
    )) as readonly Record<string, unknown>[];

  it("preserves every published qa-local row and appends one exact Jira chain idempotently", async () => {
    await expect(runQaLocalSeed(source)).resolves.toBe("applied");
    const original = await historicalRevisions();
    const mockRegistration = await source.query(
      "SELECT connector_key,manifest_hash,manifest_payload FROM connector_registrations WHERE id=$1",
      [qaLocalSeedIds.connector],
    );
    const environment = loadEnvironment({
      AWP_ENVIRONMENT: "LOCAL",
      AWP_COMPOSITION: "qa-jira-local",
      AWP_EXTERNAL_NETWORK_MODE: "deny",
      AWP_MOCK_HUB_URL: "http://mock-hub:4010",
    });

    await expect(runQaJiraLocalSeed(source, environment)).resolves.toBe("applied");
    expect(await historicalRevisions()).toEqual(original);
    expect(
      await source.query(
        "SELECT connector_key,manifest_hash,manifest_payload FROM connector_registrations WHERE id=$1",
        [qaLocalSeedIds.connector],
      ),
    ).toEqual(mockRegistration);

    const exactChain = (await source.query(
      `
      SELECT 'BASE_CONNECTION' AS kind,header_id,version,content_hash FROM connection_revisions WHERE id=$1
      UNION ALL
      SELECT 'BASE_MAPPING' AS kind,header_id,version,content_hash FROM connector_mapping_revisions WHERE id=$2
      UNION ALL
      SELECT 'BASE_PROFILE' AS kind,header_id,version,content_hash FROM connector_profile_revisions WHERE id=$3
      UNION ALL
      SELECT 'BASE_BINDING' AS kind,header_id,version,content_hash FROM project_integration_binding_revisions WHERE id=$4
      UNION ALL
      SELECT 'PRIMARY_PROFILE' AS kind,header_id,version,content_hash FROM connector_profile_revisions WHERE id=$5
      UNION ALL
      SELECT 'SOURCE_MAPPING' AS kind,header_id,version,content_hash FROM connector_mapping_revisions WHERE id=$6
      UNION ALL
      SELECT 'SOURCE_PROFILE' AS kind,header_id,version,content_hash FROM connector_profile_revisions WHERE id=$7
      UNION ALL
      SELECT 'SOURCE_BINDING' AS kind,header_id,version,content_hash FROM project_integration_binding_revisions WHERE id=$8
      ORDER BY kind
    `,
      [
        qaJiraLocalSeedIds.connectionRevision,
        qaJiraLocalSeedIds.mappingRevision,
        qaJiraLocalSeedIds.profileRevision,
        qaJiraLocalSeedIds.alphaBindingRevision,
        qaJiraLocalSeedIds.profileSourcePolicyRevision,
        qaJiraLocalSeedIds.sourceMappingRevision,
        qaJiraLocalSeedIds.sourceProfileRevision,
        qaJiraLocalSeedIds.alphaBindingSourceRevision,
      ],
    )) as readonly Record<string, unknown>[];
    expect(exactChain).toHaveLength(8);
    expect(exactChain).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "BASE_BINDING",
          header_id: qaJiraLocalBaseSeedRefs.binding.id,
          version: qaJiraLocalBaseSeedRefs.binding.version,
        }),
        expect.objectContaining({
          kind: "BASE_CONNECTION",
          header_id: qaJiraLocalBaseSeedRefs.connection.id,
          version: qaJiraLocalBaseSeedRefs.connection.version,
        }),
        expect.objectContaining({
          kind: "BASE_MAPPING",
          header_id: qaJiraLocalBaseSeedRefs.mapping.id,
          version: qaJiraLocalBaseSeedRefs.mapping.version,
        }),
        expect.objectContaining({
          kind: "BASE_PROFILE",
          header_id: qaJiraLocalBaseSeedRefs.profile.id,
          version: qaJiraLocalBaseSeedRefs.profile.version,
        }),
        expect.objectContaining({
          kind: "PRIMARY_PROFILE",
          header_id: qaJiraLocalSeedRefs.profile.id,
          version: qaJiraLocalSeedRefs.profile.version,
        }),
        expect.objectContaining({
          kind: "SOURCE_MAPPING",
          header_id: qaJiraLocalSeedRefs.sourceMapping.id,
          version: qaJiraLocalSeedRefs.sourceMapping.version,
        }),
        expect.objectContaining({
          kind: "SOURCE_PROFILE",
          header_id: qaJiraLocalSeedRefs.sourceProfile.id,
          version: qaJiraLocalSeedRefs.sourceProfile.version,
        }),
        expect.objectContaining({
          kind: "SOURCE_BINDING",
          header_id: qaJiraLocalSeedRefs.binding.id,
          version: qaJiraLocalSeedRefs.binding.version,
        }),
      ]),
    );

    const v4Content = (await source.query(
      `
      SELECT 'PRIMARY_PROFILE' AS kind,content,content_hash FROM connector_profile_revisions WHERE id=$1
      UNION ALL
      SELECT 'SOURCE_MAPPING' AS kind,content,content_hash FROM connector_mapping_revisions WHERE id=$2
      UNION ALL
      SELECT 'SOURCE_PROFILE' AS kind,content,content_hash FROM connector_profile_revisions WHERE id=$3
      UNION ALL
      SELECT 'SOURCE_BINDING' AS kind,content,content_hash FROM project_integration_binding_revisions WHERE id=$4
      ORDER BY kind
    `,
      [
        qaJiraLocalSeedIds.profileSourcePolicyRevision,
        qaJiraLocalSeedIds.sourceMappingRevision,
        qaJiraLocalSeedIds.sourceProfileRevision,
        qaJiraLocalSeedIds.alphaBindingSourceRevision,
      ],
    )) as readonly Readonly<{
      kind: string;
      content: Record<string, unknown>;
      content_hash: string;
    }>[];
    const primaryProfile = v4Content.find(({ kind }) => kind === "PRIMARY_PROFILE")!;
    const sourceMapping = v4Content.find(({ kind }) => kind === "SOURCE_MAPPING")!;
    const sourceProfile = v4Content.find(({ kind }) => kind === "SOURCE_PROFILE")!;
    const sourceBinding = v4Content.find(({ kind }) => kind === "SOURCE_BINDING")!;
    expect(primaryProfile.content).toMatchObject({
      sourceLinkPolicy: {
        strategy: "NATIVE_SAME_AUTHORITY",
        typeId: "10000",
        direction: "OUTWARD",
      },
      previousRef: {
        id: qaJiraLocalSeedIds.profileRevision,
        version: qaJiraLocalBaseSeedRefs.profile.version,
      },
    });
    expect(sourceMapping.content).toMatchObject({
      logicalRole: "SOURCE_CONTEXT",
      sourceReferenceMapping: {
        rules: [
          { sourceKind: "JIRA_ISSUE", subEffectKind: "LINK" },
          { sourceKind: "URL", subEffectKind: "REMOTE_LINK" },
        ],
        commentPolicy: { mode: "DISABLED" },
      },
    });
    expect(sourceProfile.content).toMatchObject({
      logicalRole: "SOURCE_CONTEXT",
      connectionRef: qaJiraLocalSeedRefs.connection,
      mappingRef: qaJiraLocalSeedRefs.sourceMapping,
      allowedProjectIds: ["200"],
      allowedIssueTypeIds: ["10002"],
      jiraLinkTypes: [{ typeId: "10000", direction: "OUTWARD" }],
    });
    const bindingEntries = sourceBinding.content.entries as readonly Readonly<
      Record<string, unknown>
    >[];
    expect(bindingEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          logicalRole: "QA_REQUEST_AUTHORITY",
          profileRef: expect.objectContaining(qaJiraLocalSeedRefs.profile),
        }),
        expect.objectContaining({
          logicalRole: "SOURCE_CONTEXT",
          profileRef: expect.objectContaining(qaJiraLocalSeedRefs.sourceProfile),
        }),
      ]),
    );

    const validationReports = (await source.query(
      "SELECT id,subject_kind,subject_id,subject_version,outcome,content_hash FROM integration_validation_reports WHERE id=ANY($1::uuid[]) ORDER BY id",
      [
        [
          qaJiraLocalSeedIds.profileSourcePolicyValidation,
          qaJiraLocalSeedIds.sourceMappingValidation,
          qaJiraLocalSeedIds.sourceProfileValidation,
          qaJiraLocalSeedIds.alphaBindingSourceValidation,
        ],
      ],
    )) as readonly Readonly<Record<string, unknown>>[];
    expect(validationReports).toHaveLength(4);
    expect(validationReports).toEqual(
      expect.arrayContaining(
        v4Content.map(({ kind, content_hash }) => {
          const expected = {
            PRIMARY_PROFILE: {
              subject_kind: "PROFILE",
              subject_id: qaJiraLocalSeedRefs.profile.id,
              subject_version: qaJiraLocalSeedRefs.profile.version,
            },
            SOURCE_MAPPING: {
              subject_kind: "MAPPING",
              subject_id: qaJiraLocalSeedRefs.sourceMapping.id,
              subject_version: qaJiraLocalSeedRefs.sourceMapping.version,
            },
            SOURCE_PROFILE: {
              subject_kind: "PROFILE",
              subject_id: qaJiraLocalSeedRefs.sourceProfile.id,
              subject_version: qaJiraLocalSeedRefs.sourceProfile.version,
            },
            SOURCE_BINDING: {
              subject_kind: "BINDING",
              subject_id: qaJiraLocalSeedRefs.binding.id,
              subject_version: qaJiraLocalSeedRefs.binding.version,
            },
          }[kind]!;
          return expect.objectContaining({ ...expected, outcome: "VALID", content_hash });
        }),
      ),
    );

    expect(
      await source.query(
        `
      SELECT 'MAPPING' AS kind,id,current_published_version FROM connector_mapping_headers WHERE id=$1
      UNION ALL
      SELECT 'PROFILE' AS kind,id,current_published_version FROM connector_profile_headers WHERE id=$2
      ORDER BY kind
    `,
        [qaJiraLocalSeedRefs.sourceMapping.id, qaJiraLocalSeedRefs.sourceProfile.id],
      ),
    ).toEqual([
      { kind: "MAPPING", id: qaJiraLocalSeedRefs.sourceMapping.id, current_published_version: 1 },
      { kind: "PROFILE", id: qaJiraLocalSeedRefs.sourceProfile.id, current_published_version: 1 },
    ]);

    const afterFirstRun = await source.query(
      `
      SELECT kind,id,version,content,content_hash FROM (
        SELECT 'CONNECTION' AS kind,id,version,content,content_hash FROM connection_revisions WHERE header_id=$1
        UNION ALL SELECT 'MAPPING',id,version,content,content_hash FROM connector_mapping_revisions WHERE header_id IN ($2,$5)
        UNION ALL SELECT 'PROFILE',id,version,content,content_hash FROM connector_profile_revisions WHERE header_id IN ($3,$6)
        UNION ALL SELECT 'BINDING',id,version,content,content_hash FROM project_integration_binding_revisions WHERE header_id=$4
      ) revisions ORDER BY kind,version
    `,
      [
        qaLocalSeedIds.connection,
        qaLocalSeedIds.mapping,
        qaLocalSeedIds.profile,
        qaLocalSeedIds.alphaBinding,
        qaJiraLocalSeedRefs.sourceMapping.id,
        qaJiraLocalSeedRefs.sourceProfile.id,
      ],
    );
    await expect(runQaJiraLocalSeed(source, environment)).resolves.toBe("unchanged");
    expect(
      await source.query(
        `
      SELECT kind,id,version,content,content_hash FROM (
        SELECT 'CONNECTION' AS kind,id,version,content,content_hash FROM connection_revisions WHERE header_id=$1
        UNION ALL SELECT 'MAPPING',id,version,content,content_hash FROM connector_mapping_revisions WHERE header_id IN ($2,$5)
        UNION ALL SELECT 'PROFILE',id,version,content,content_hash FROM connector_profile_revisions WHERE header_id IN ($3,$6)
        UNION ALL SELECT 'BINDING',id,version,content,content_hash FROM project_integration_binding_revisions WHERE header_id=$4
      ) revisions ORDER BY kind,version
    `,
        [
          qaLocalSeedIds.connection,
          qaLocalSeedIds.mapping,
          qaLocalSeedIds.profile,
          qaLocalSeedIds.alphaBinding,
          qaJiraLocalSeedRefs.sourceMapping.id,
          qaJiraLocalSeedRefs.sourceProfile.id,
        ],
      ),
    ).toEqual(afterFirstRun);
  });
});
