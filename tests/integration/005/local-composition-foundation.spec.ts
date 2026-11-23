import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TypeOrmGitLabConfigurationRepository } from "../../../packages/connector-gitlab-persistence-typeorm/src/index.ts";
import { createPlatformDataSource } from "../../../packages/platform-persistence-typeorm/src/index.ts";
import {
  type RunningPostgres,
  startPostgres,
} from "../../../packages/platform-testkit/src/index.ts";
import { loadEnvironment } from "../../../packages/runtime-composition/src/config/environment.ts";
import {
  qaJiraGitLabLocalEntities,
  qaJiraGitLabLocalMigrations,
} from "../../../packages/runtime-composition/src/gitlab/composition.ts";
import {
  qaJiraGitLabLocalSeedIds,
  runQaJiraGitLabLocalSeed,
} from "../../../packages/runtime-composition/src/seed/qa-jira-gitlab-local-seed.ts";

describe("qa-jira-gitlab-local foundation", () => {
  let postgres: RunningPostgres;
  let source: ReturnType<typeof createPlatformDataSource>;

  beforeAll(async () => {
    postgres = await startPostgres();
    source = createPlatformDataSource({
      url: postgres.url,
      entities: qaJiraGitLabLocalEntities,
      migrations: qaJiraGitLabLocalMigrations,
    });
    await source.initialize();
    await source.runMigrations({ transaction: "all" });
  }, 120_000);

  afterAll(async () => {
    if (source?.isInitialized) await source.destroy();
    if (postgres) await postgres.stop();
  });

  it("publishes the exact GitLab foundation and remains idempotent", async () => {
    const environment = loadEnvironment({
      AWP_ENVIRONMENT: "LOCAL",
      AWP_COMPOSITION: "qa-jira-gitlab-local",
      AWP_EXTERNAL_NETWORK_MODE: "deny",
      AWP_MOCK_HUB_URL: "http://mock-hub:4010",
    });
    await expect(runQaJiraGitLabLocalSeed(source, environment)).resolves.toBe("applied");
    await expect(runQaJiraGitLabLocalSeed(source, environment)).resolves.toBe("unchanged");

    const rows = (await source.query(
      `
      SELECT
        (SELECT COUNT(*)::int FROM connector_registrations WHERE connector_key='gitlab.automated-validation' AND connector_version='1.0.0') AS connectors,
        (SELECT COUNT(*)::int FROM connector_capability_implementations WHERE connector_registration_id=$1) AS operations,
        (SELECT COUNT(*)::int FROM gitlab_discovery_snapshots WHERE discovery_snapshot_id=$2 AND validation_status='VALID') AS discoveries,
        (SELECT COUNT(*)::int FROM gitlab_profile_validation_details WHERE profile_validation_detail_id=$3 AND status='VALID') AS validations,
        (SELECT COUNT(*)::int FROM gitlab_suite_contract_probes WHERE suite_contract_probe_id=$4 AND status='VALID') AS probes
    `,
      [
        qaJiraGitLabLocalSeedIds.connector,
        qaJiraGitLabLocalSeedIds.discovery,
        qaJiraGitLabLocalSeedIds.profileValidationDetail,
        qaJiraGitLabLocalSeedIds.suiteProbe,
      ],
    )) as readonly Record<string, number>[];
    expect(rows[0]).toEqual({
      connectors: 1,
      operations: 8,
      discoveries: 1,
      validations: 1,
      probes: 1,
    });
  }, 120_000);

  it("appends and reads scoped discovery, validation, and Suite probe evidence through the repository", async () => {
    const environment = loadEnvironment({
      AWP_ENVIRONMENT: "LOCAL",
      AWP_COMPOSITION: "qa-jira-gitlab-local",
      AWP_EXTERNAL_NETWORK_MODE: "deny",
      AWP_MOCK_HUB_URL: "http://mock-hub:4010",
    });
    await runQaJiraGitLabLocalSeed(source, environment);
    const repository = new TypeOrmGitLabConfigurationRepository(source);
    const workspaceId = "11111111-1111-4111-8111-111111111111";
    const scope = Object.freeze({ workspaceId, numericProjectId: 5001 });
    const hash = (character: string) => `sha256:${character.repeat(64)}`;
    const discoveryId = "95000000-0000-4000-8000-000000000020";
    const profileRef = Object.freeze({ id: qaJiraGitLabLocalSeedIds.profile, version: 1 });
    const snapshot = Object.freeze({
      id: discoveryId,
      workspaceId,
      connectionRef: Object.freeze({ id: "95000000-0000-4000-8000-000000000021", version: 1 }),
      connectorVersion: "1.0.0",
      adapterFamily: "gitlab-rest-v4",
      adapterContractVersion: "1.0.0",
      edition: "EE",
      exactVersion: "18.1.0-mock.1",
      exactBuild: "mock-build-2",
      apiFamily: "v4",
      tlsEndpointFingerprint: hash("1"),
      numericProjectId: 5001,
      canonicalProjectPathHash: hash("2"),
      defaultBranch: "qa/smoke",
      exactRef: "refs/heads/qa/smoke",
      refCommitSha: "abcdef123456",
      supportedFeatures: Object.freeze({ projectRead: true, ciLintDryRun: true }),
      identityPermissionProbeHash: hash("3"),
      runnerReadinessHash: hash("4"),
      networkReadinessHash: hash("5"),
      productionDenied: true,
      sanitizedMetadata: Object.freeze({ jobCount: 1 }),
      schemaRef: Object.freeze({
        id: "urn:awp:schemas:005:gitlab-discovery-snapshot:v1",
        version: 1,
      }),
      schemaDigest: hash("6"),
      contentHash: hash("7"),
      validationStatus: "VALID",
      collectedAt: "2026-09-01T09:00:00.000Z",
      expiresAt: "2026-09-08T09:00:00.000Z",
    });
    await repository.appendDiscovery(scope, snapshot);
    await repository.appendSuiteProbe(scope, {
      id: "95000000-0000-4000-8000-000000000022",
      workspaceId,
      profileRef,
      discoverySnapshotId: discoveryId,
      numericProjectId: 5001,
      suiteKeyHash: hash("8"),
      logicalExecutionContractHash: hash("9"),
      exactRefHash: hash("a"),
      resultContractHash: hash("b"),
      artifactPolicyHash: hash("c"),
      sourceFactSetHash: hash("d"),
      dryRunHash: hash("e"),
      fixtureResultHash: hash("f"),
      artifactProbeHash: hash("1"),
      status: "VALID",
      issues: Object.freeze([]),
      contentHash: hash("2"),
      createdAt: "2026-09-01T09:00:01.000Z",
    });
    await repository.appendProfileValidation(scope, {
      id: "95000000-0000-4000-8000-000000000023",
      workspaceId,
      profileRef,
      candidateContentHash: hash("3"),
      discoverySnapshotId: discoveryId,
      numericProjectId: 5001,
      externalScopeHash: hash("4"),
      allowedRefsHash: hash("5"),
      allowedEnvironmentsHash: hash("6"),
      inputMappingHash: hash("7"),
      resultContractHash: hash("8"),
      artifactContractHash: hash("9"),
      permissionProbe: Object.freeze({ status: "PASS" }),
      ciLintProbe: Object.freeze({ dryRun: true, includeJobs: true, status: "PASS" }),
      noDeployProbe: Object.freeze({ status: "PASS" }),
      nonProductionProbe: Object.freeze({ status: "PASS" }),
      lookupMarkerProbe: Object.freeze({ status: "PASS" }),
      status: "VALID",
      issues: Object.freeze([]),
      previewHash: hash("a"),
      probeSetHash: hash("b"),
      contentHash: hash("c"),
      createdAt: "2026-09-01T09:00:02.000Z",
    });

    expect(
      await repository.latestValidDiscovery(scope, new Date("2026-09-02T00:00:00.000Z")),
    ).toEqual(
      expect.objectContaining({ discovery_snapshot_id: discoveryId, validation_status: "VALID" }),
    );
    expect(await repository.suiteProbes(scope, profileRef)).toHaveLength(1);
    expect(await repository.profileValidations(scope, profileRef)).toHaveLength(1);
    await expect(
      repository.appendDiscovery(
        { workspaceId, numericProjectId: 5002 },
        {
          ...snapshot,
          id: "95000000-0000-4000-8000-000000000024",
        },
      ),
    ).rejects.toThrow("GITLAB_CONFIGURATION_SCOPE_MISMATCH");
    await expect(
      source.query(
        "UPDATE gitlab_discovery_snapshots SET sanitized_metadata='{}' WHERE discovery_snapshot_id=$1",
        [discoveryId],
      ),
    ).rejects.toThrow(/GITLAB_APPEND_ONLY_MUTATION_FORBIDDEN/iu);
  }, 120_000);
});
