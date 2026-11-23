import {
  frozenRows,
  type GitLabQueryExecutor,
  gitLabRows,
  type GitLabWorkspaceProjectScope,
} from "./repository-helpers.ts";

type JsonObject = Readonly<Record<string, unknown>>;

export interface GitLabDiscoverySnapshotWrite {
  readonly id: string;
  readonly workspaceId: string;
  readonly connectionRef: JsonObject;
  readonly connectorVersion: string;
  readonly adapterFamily: "gitlab-rest-v4";
  readonly adapterContractVersion: string;
  readonly edition: "CE" | "EE";
  readonly exactVersion: string;
  readonly exactBuild: string;
  readonly apiFamily: "v4";
  readonly tlsEndpointFingerprint: string;
  readonly numericProjectId: number;
  readonly canonicalProjectPathHash: string;
  readonly defaultBranch?: string;
  readonly exactRef: string;
  readonly refCommitSha: string;
  readonly supportedFeatures: JsonObject;
  readonly identityPermissionProbeHash: string;
  readonly runnerReadinessHash: string;
  readonly networkReadinessHash: string;
  readonly productionDenied: true;
  readonly sanitizedMetadata: JsonObject;
  readonly schemaRef: JsonObject;
  readonly schemaDigest: string;
  readonly contentHash: string;
  readonly validationStatus: "VALID" | "INVALID";
  readonly collectedAt: string;
  readonly expiresAt: string;
}

export interface GitLabProfileValidationWrite {
  readonly id: string;
  readonly workspaceId: string;
  readonly profileRef: JsonObject;
  readonly candidateContentHash: string;
  readonly discoverySnapshotId: string;
  readonly numericProjectId: number;
  readonly externalScopeHash: string;
  readonly allowedRefsHash: string;
  readonly allowedEnvironmentsHash: string;
  readonly inputMappingHash: string;
  readonly resultContractHash: string;
  readonly artifactContractHash: string;
  readonly permissionProbe: JsonObject;
  readonly ciLintProbe: JsonObject;
  readonly noDeployProbe: JsonObject;
  readonly nonProductionProbe: JsonObject;
  readonly lookupMarkerProbe: JsonObject;
  readonly status: "VALID" | "INVALID";
  readonly issues: readonly JsonObject[];
  readonly previewHash: string;
  readonly probeSetHash: string;
  readonly contentHash: string;
  readonly createdAt: string;
}

export interface GitLabSuiteContractProbeWrite {
  readonly id: string;
  readonly workspaceId: string;
  readonly profileRef: JsonObject;
  readonly discoverySnapshotId: string;
  readonly numericProjectId: number;
  readonly suiteKeyHash: string;
  readonly logicalExecutionContractHash: string;
  readonly exactRefHash: string;
  readonly resultContractHash: string;
  readonly artifactPolicyHash: string;
  readonly sourceFactSetHash: string;
  readonly dryRunHash: string;
  readonly fixtureResultHash: string;
  readonly artifactProbeHash: string;
  readonly status: "VALID" | "INVALID";
  readonly issues: readonly JsonObject[];
  readonly contentHash: string;
  readonly createdAt: string;
}

function assertScope(
  scope: GitLabWorkspaceProjectScope,
  workspaceId: string,
  numericProjectId: number,
): void {
  if (scope.workspaceId !== workspaceId || scope.numericProjectId !== numericProjectId) {
    throw new Error("GITLAB_CONFIGURATION_SCOPE_MISMATCH");
  }
}

function assertInserted(value: unknown, code: string): void {
  if (gitLabRows(value).length !== 1) throw new Error(code);
}

export class TypeOrmGitLabConfigurationRepository {
  constructor(private readonly source: GitLabQueryExecutor) {}

  async appendDiscovery(
    scope: GitLabWorkspaceProjectScope,
    snapshot: GitLabDiscoverySnapshotWrite,
  ): Promise<void> {
    assertScope(scope, snapshot.workspaceId, snapshot.numericProjectId);
    if (
      !snapshot.productionDenied ||
      Date.parse(snapshot.expiresAt) <= Date.parse(snapshot.collectedAt)
    ) {
      throw new Error("GITLAB_DISCOVERY_SNAPSHOT_INVALID");
    }
    assertInserted(
      await this.source.query(
        `
INSERT INTO gitlab_discovery_snapshots(
  discovery_snapshot_id,workspace_id,connection_ref,connector_version,adapter_family,adapter_contract_version,
  edition,exact_version,exact_build,api_family,tls_endpoint_fingerprint,numeric_project_id,
  canonical_project_path_hash,default_branch,exact_ref,ref_commit_sha,supported_features,
  identity_permission_probe_hash,runner_readiness_hash,network_readiness_hash,production_denied,
  sanitized_metadata,schema_ref,schema_digest,content_hash,validation_status,collected_at,expires_at
) VALUES(
  $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28
) RETURNING discovery_snapshot_id`,
        [
          snapshot.id,
          snapshot.workspaceId,
          JSON.stringify(snapshot.connectionRef),
          snapshot.connectorVersion,
          snapshot.adapterFamily,
          snapshot.adapterContractVersion,
          snapshot.edition,
          snapshot.exactVersion,
          snapshot.exactBuild,
          snapshot.apiFamily,
          snapshot.tlsEndpointFingerprint,
          snapshot.numericProjectId,
          snapshot.canonicalProjectPathHash,
          snapshot.defaultBranch ?? null,
          snapshot.exactRef,
          snapshot.refCommitSha,
          JSON.stringify(snapshot.supportedFeatures),
          snapshot.identityPermissionProbeHash,
          snapshot.runnerReadinessHash,
          snapshot.networkReadinessHash,
          snapshot.productionDenied,
          JSON.stringify(snapshot.sanitizedMetadata),
          JSON.stringify(snapshot.schemaRef),
          snapshot.schemaDigest,
          snapshot.contentHash,
          snapshot.validationStatus,
          snapshot.collectedAt,
          snapshot.expiresAt,
        ],
      ),
      "GITLAB_DISCOVERY_SNAPSHOT_INSERT_FAILED",
    );
  }

  async appendProfileValidation(
    scope: GitLabWorkspaceProjectScope,
    detail: GitLabProfileValidationWrite,
  ): Promise<void> {
    assertScope(scope, detail.workspaceId, detail.numericProjectId);
    assertInserted(
      await this.source.query(
        `
INSERT INTO gitlab_profile_validation_details(
  profile_validation_detail_id,workspace_id,profile_ref,candidate_content_hash,discovery_snapshot_id,
  numeric_project_id,external_scope_hash,allowed_refs_hash,allowed_environments_hash,input_mapping_hash,
  result_contract_hash,artifact_contract_hash,permission_probe,ci_lint_probe,no_deploy_probe,
  non_production_probe,lookup_marker_probe,status,issues,preview_hash,probe_set_hash,content_hash,created_at
) VALUES(
  $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23
) RETURNING profile_validation_detail_id`,
        [
          detail.id,
          detail.workspaceId,
          JSON.stringify(detail.profileRef),
          detail.candidateContentHash,
          detail.discoverySnapshotId,
          detail.numericProjectId,
          detail.externalScopeHash,
          detail.allowedRefsHash,
          detail.allowedEnvironmentsHash,
          detail.inputMappingHash,
          detail.resultContractHash,
          detail.artifactContractHash,
          JSON.stringify(detail.permissionProbe),
          JSON.stringify(detail.ciLintProbe),
          JSON.stringify(detail.noDeployProbe),
          JSON.stringify(detail.nonProductionProbe),
          JSON.stringify(detail.lookupMarkerProbe),
          detail.status,
          JSON.stringify(detail.issues),
          detail.previewHash,
          detail.probeSetHash,
          detail.contentHash,
          detail.createdAt,
        ],
      ),
      "GITLAB_PROFILE_VALIDATION_INSERT_FAILED",
    );
  }

  async appendSuiteProbe(
    scope: GitLabWorkspaceProjectScope,
    probe: GitLabSuiteContractProbeWrite,
  ): Promise<void> {
    assertScope(scope, probe.workspaceId, probe.numericProjectId);
    assertInserted(
      await this.source.query(
        `
INSERT INTO gitlab_suite_contract_probes(
  suite_contract_probe_id,workspace_id,profile_ref,discovery_snapshot_id,numeric_project_id,suite_key_hash,
  logical_execution_contract_hash,exact_ref_hash,result_contract_hash,artifact_policy_hash,source_fact_set_hash,
  dry_run_hash,fixture_result_hash,artifact_probe_hash,status,issues,content_hash,created_at
) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
RETURNING suite_contract_probe_id`,
        [
          probe.id,
          probe.workspaceId,
          JSON.stringify(probe.profileRef),
          probe.discoverySnapshotId,
          probe.numericProjectId,
          probe.suiteKeyHash,
          probe.logicalExecutionContractHash,
          probe.exactRefHash,
          probe.resultContractHash,
          probe.artifactPolicyHash,
          probe.sourceFactSetHash,
          probe.dryRunHash,
          probe.fixtureResultHash,
          probe.artifactProbeHash,
          probe.status,
          JSON.stringify(probe.issues),
          probe.contentHash,
          probe.createdAt,
        ],
      ),
      "GITLAB_SUITE_CONTRACT_PROBE_INSERT_FAILED",
    );
  }

  async discovery(
    scope: GitLabWorkspaceProjectScope,
    discoverySnapshotId: string,
  ): Promise<Readonly<Record<string, unknown>> | undefined> {
    const rows = gitLabRows<Record<string, unknown>>(
      await this.source.query(
        `
SELECT * FROM gitlab_discovery_snapshots
WHERE workspace_id=$1 AND numeric_project_id=$2 AND discovery_snapshot_id=$3`,
        [scope.workspaceId, scope.numericProjectId, discoverySnapshotId],
      ),
    );
    return rows[0] === undefined ? undefined : Object.freeze({ ...rows[0] });
  }

  async latestValidDiscovery(
    scope: GitLabWorkspaceProjectScope,
    now: Date,
  ): Promise<Readonly<Record<string, unknown>> | undefined> {
    const rows = gitLabRows<Record<string, unknown>>(
      await this.source.query(
        `
SELECT * FROM gitlab_discovery_snapshots
WHERE workspace_id=$1 AND numeric_project_id=$2 AND validation_status='VALID' AND expires_at>$3
ORDER BY collected_at DESC,discovery_snapshot_id DESC LIMIT 1`,
        [scope.workspaceId, scope.numericProjectId, now],
      ),
    );
    return rows[0] === undefined ? undefined : Object.freeze({ ...rows[0] });
  }

  async profileValidations(
    scope: GitLabWorkspaceProjectScope,
    profileRef: Readonly<Record<string, unknown>>,
  ): Promise<readonly Readonly<Record<string, unknown>>[]> {
    return frozenRows(
      await this.source.query(
        `
SELECT * FROM gitlab_profile_validation_details
WHERE workspace_id=$1 AND numeric_project_id=$2 AND profile_ref=$3::jsonb
ORDER BY created_at,profile_validation_detail_id`,
        [scope.workspaceId, scope.numericProjectId, JSON.stringify(profileRef)],
      ),
    );
  }

  async suiteProbes(
    scope: GitLabWorkspaceProjectScope,
    profileRef: Readonly<Record<string, unknown>>,
  ): Promise<readonly Readonly<Record<string, unknown>>[]> {
    return frozenRows(
      await this.source.query(
        `
SELECT * FROM gitlab_suite_contract_probes
WHERE workspace_id=$1 AND numeric_project_id=$2 AND profile_ref=$3::jsonb
ORDER BY created_at,suite_contract_probe_id`,
        [scope.workspaceId, scope.numericProjectId, JSON.stringify(profileRef)],
      ),
    );
  }
}
