import { createHash } from "node:crypto";

import type { DataSource } from "typeorm";

import {
  qaCompetencyManifestV12,
  qaCompetencyManifestV13,
  qaValidationWorkTypeDefinitionV12,
  qaValidationWorkTypeDefinitionV13,
} from "@awp/competency-qa/node";
import {
  type GitLabConnectionConfiguration,
  gitLabConnectorManifest,
  type GitLabProfileConfiguration,
} from "@awp/connector-gitlab";

import type { RuntimeEnvironment } from "../config/environment.ts";
import { localPersonaIds, localSeedIds } from "./local-seed.ts";
import { runQaJiraLocalSeed } from "./qa-jira-local-seed.ts";
import { runQaJiraMattermostLocalSeed } from "./qa-jira-mattermost-local-seed.ts";

export const QA_JIRA_GITLAB_LOCAL_SEED_KEY = "005-qa-jira-gitlab-local";
export const QA_JIRA_GITLAB_LOCAL_SEED_VERSION = 2;

export const qaJiraGitLabLocalSeedIds = Object.freeze({
  qaPack: "95000000-0000-4000-8000-000000000001",
  qaWorkType: "95000000-0000-4000-8000-000000000002",
  qaPackV13: "95000000-0000-4000-8000-000000000013",
  qaWorkTypeV13: "95000000-0000-4000-8000-000000000014",
  connector: "95000000-0000-4000-8000-000000000003",
  connection: "88888888-8888-4888-8888-888888888888",
  connectionRevision: "95800000-0000-4000-8000-000000000001",
  profile: "77777777-7777-4777-8777-777777777777",
  profileRevision: "95700000-0000-4000-8000-000000000001",
  binding: "99999999-9999-4999-8999-999999999999",
  bindingRevision: "95900000-0000-4000-8000-000000000001",
  validation: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  discovery: "95000000-0000-4000-8000-000000000010",
  profileValidationDetail: "95000000-0000-4000-8000-000000000011",
  suiteProbe: "95000000-0000-4000-8000-000000000012",
});

const at = "2026-09-01T07:45:00.000Z";
const digest = (value: unknown): `sha256:${string}` =>
  `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
const resultSchemaRef = Object.freeze({
  id: "urn:awp:schemas:005:gitlab-pipeline-result:v1",
  version: 1,
  digest: "sha256:d668c14c37a8636b71d9c03405312b7d01586a2e7e6a51996e3b067855bcb678" as const,
});

export function buildQaJiraGitLabLocalSeedConfiguration(mockHubUrl: string) {
  const endpoint = new URL(mockHubUrl);
  if (
    endpoint.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "mock-hub"].includes(endpoint.hostname)
  ) {
    throw new Error("QA_JIRA_GITLAB_LOCAL_ENDPOINT_FORBIDDEN");
  }
  const common = Object.freeze({
    ownerRef: "team:qa-platform",
    rotationPolicyRef: "policy:credentials:local-30d:v1",
    revocationRunbookRef: "runbook:gitlab-credential-revoke:v1",
  });
  const connection: GitLabConnectionConfiguration = Object.freeze({
    schemaVersion: "gitlab-connection-configuration@1.0.0",
    identityReferences: Object.freeze({
      read: Object.freeze({
        ...common,
        identityKind: "NON_HUMAN_PROJECT",
        scope: "read_api",
        nonHumanIdentityEvidenceRef: "evidence:gitlab:project-5001:read-non-human:v1",
        reference: "secretref://local/gitlab/project-5001/read",
        referenceFingerprint: `sha256:${"1".repeat(64)}`,
      }),
      trigger: Object.freeze({
        ...common,
        identityKind: "NON_HUMAN_PROJECT",
        scope: "pipeline_trigger",
        nonHumanIdentityEvidenceRef: "evidence:gitlab:project-5001:trigger-non-human:v1",
        reference: "secretref://local/gitlab/project-5001/trigger",
        referenceFingerprint: `sha256:${"2".repeat(64)}`,
      }),
      webhook: Object.freeze({
        ...common,
        identityMaterialKind: "STANDARD_WEBHOOK_HMAC_KEY",
        keyVersionRef: "key-version:gitlab-webhook:project-5001:v1",
        reference: "secretref://local/gitlab/project-5001/webhook",
        referenceFingerprint: `sha256:${"3".repeat(64)}`,
      }),
    }),
    operationIdentityRouting: Object.freeze({
      mergeRequestRead: "READ",
      commitRead: "READ",
      buildRead: "READ",
      pipelineTrigger: "TRIGGER",
      pipelineRead: "READ",
      pipelineLookup: "READ",
      artifactMetadata: "READ",
      artifactStream: "READ",
      webhookVerify: "WEBHOOK",
    }),
    identitySeparationEvidenceHash: `sha256:${"4".repeat(64)}`,
  });
  const inputMappings = Object.freeze([
    Object.freeze({
      logicalField: "REQUEST_MARKER",
      providerInputName: "AWP_REQUEST_MARKER",
      inputType: "STRING",
      source: "SERVER_CONTEXT",
    }),
    Object.freeze({
      logicalField: "SUITE_KEY",
      providerInputName: "AWP_SUITE_KEY",
      inputType: "STRING",
      source: "SERVER_CONTEXT",
    }),
    Object.freeze({
      logicalField: "ENVIRONMENT_REF",
      providerInputName: "AWP_ENVIRONMENT_REF",
      inputType: "STRING",
      source: "SERVER_CONTEXT",
    }),
    Object.freeze({
      logicalField: "COMMIT_SHA",
      providerInputName: "AWP_COMMIT_SHA",
      inputType: "STRING",
      source: "SERVER_CONTEXT",
    }),
  ] as const);
  const profile: GitLabProfileConfiguration = Object.freeze({
    schemaVersion: "gitlab-profile-configuration@1.0.0",
    numericGitLabProjectId: 5001,
    apiFamily: "v4",
    credentialRoutingMode: "NAMED_CONNECTION_SLOTS_V1",
    allowedRefs: Object.freeze(["refs/heads/qa/smoke"]),
    sourceContext: Object.freeze({ mergeRequestRead: true, commitRead: true, buildRead: true }),
    trigger: Object.freeze({
      logicalPipelineKey: "qa.validation",
      sourceRefPolicyRef: "policy:source-ref:qa-smoke:v1",
      dialect: "TYPED_INPUTS",
      ref: "refs/heads/qa/smoke",
      pipelineNameTemplate: "awp:{attemptId}:{requestHash}",
      markerInputName: "AWP_REQUEST_MARKER",
      allowedInputNames: Object.freeze([
        "AWP_REQUEST_MARKER",
        "AWP_SUITE_KEY",
        "AWP_ENVIRONMENT_REF",
        "AWP_COMMIT_SHA",
      ]),
      inputMappings,
      inputMappingHash: digest(inputMappings),
    }),
    suiteMappings: Object.freeze([
      Object.freeze({
        suiteKey: "smoke",
        logicalPipelineKey: "qa.validation",
        sourceRefPolicyRef: "policy:source-ref:qa-smoke:v1",
        resultJobKey: "machine-result",
        logicalExecutionContractHash: `sha256:${"5".repeat(64)}`,
        resultJobName: "awp:result",
        resultArtifactPath: "awp/results/result.json",
        allowedEnvironmentRefs: Object.freeze(["environment:test:qa-1@17"]),
      }),
    ]),
    resultContract: Object.freeze({ schemaRef: resultSchemaRef, maxBytes: 1_048_576 }),
    artifactPolicy: Object.freeze({
      policyRef: "policy:artifact:qa-local:v1",
      maxArtifactBytes: 104_857_600,
      allowedClassifications: Object.freeze(["INTERNAL"]),
      checksumAlgorithm: "SHA-256",
    }),
    webhook: Object.freeze({
      verificationMode: "STANDARD_WEBHOOKS_HMAC_SHA256",
      deliverySemantics: "AT_LEAST_ONCE_SIGNAL_ONLY",
      eventKinds: Object.freeze(["PIPELINE_HOOK", "JOB_HOOK"] as const),
      freshnessSeconds: 300,
      dedupeHorizonSeconds: 86_400,
    }),
    reconciliation: Object.freeze({
      webhookGraceSeconds: 30,
      pollIntervalSeconds: 30,
      lookupConsistencyWindowSeconds: 120,
      freshnessTargetSeconds: 120,
      executionTimeoutSeconds: 3600,
      maxConcurrentReads: 4,
    }),
    ratePolicy: Object.freeze({
      rateBudgetPerMinute: 120,
      maxConcurrentRequests: 4,
      requestTimeoutMs: 10_000,
      costBudgetRef: "budget:gitlab:qa-local:v1",
    }),
    normalizedInfrastructureCodes: Object.freeze([
      "RUNNER_UNAVAILABLE",
      "SERVICE_DEPENDENCY_TIMEOUT",
    ]),
    transportRetry: Object.freeze({
      maxPreEffectTransportRetries: 1,
      retryableHttpStatuses: Object.freeze([429, 500, 502, 503, 504]),
      minimumBackoffMs: 1000,
      maximumBackoffMs: 30_000,
    }),
    productionDenied: true,
  });
  const profileHash = digest(profile);
  const connectionHash = digest(connection);
  const binding = Object.freeze({
    schemaVersion: "gitlab-project-binding@1.0.0",
    key: "qa-gitlab-automation",
    numericGitLabProjectId: 5001,
    environmentScope: "LOCAL",
    entries: Object.freeze(
      gitLabConnectorManifest.implements.map((implementation, index) =>
        Object.freeze({
          logicalRole: (["SOURCE_CONTEXT", "TEST_EXECUTION", "ARTIFACT_SOURCE"] as const)[index],
          capabilityKey: implementation.capabilityKey,
          exactContractVersion: implementation.exactContractVersions[0],
          operations: implementation.operations,
          profileRef: Object.freeze({
            id: qaJiraGitLabLocalSeedIds.profile,
            version: 1,
            contentHash: profileHash,
          }),
          connectionRef: Object.freeze({
            id: qaJiraGitLabLocalSeedIds.connection,
            version: 1,
            contentHash: connectionHash,
          }),
        }),
      ),
    ),
  });
  return Object.freeze({
    endpoint: endpoint.origin,
    connection,
    connectionHash,
    profile,
    profileHash,
    binding,
    bindingHash: digest(binding),
  });
}

async function seedGitLabFoundation(
  dataSource: DataSource,
  environment: RuntimeEnvironment,
): Promise<"applied" | "unchanged"> {
  const configuration = buildQaJiraGitLabLocalSeedConfiguration(environment.mockHubUrl!);
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const markers = (await runner.query(
      "SELECT version FROM local_seed_markers WHERE key=$1 FOR UPDATE",
      [QA_JIRA_GITLAB_LOCAL_SEED_KEY],
    )) as readonly { version: number }[];
    const markerVersion = markers[0]?.version ?? 0;
    if (markerVersion === QA_JIRA_GITLAB_LOCAL_SEED_VERSION) {
      await runner.commitTransaction();
      return "unchanged";
    }
    if (markerVersion > QA_JIRA_GITLAB_LOCAL_SEED_VERSION)
      throw new Error("QA_JIRA_GITLAB_LOCAL_SEED_VERSION_AHEAD");

    await runner.query(
      "INSERT INTO competency_pack_registrations(id,pack_key,pack_version,manifest_schema_version,required_core_contract_range,manifest_payload,manifest_hash,registration_status,registered_at) VALUES($1,'competency-qa','1.2.0',1,'>=1.0.0 <2.0.0',$2,$3,'REGISTERED',$4) ON CONFLICT(pack_key,pack_version) DO NOTHING",
      [
        qaJiraGitLabLocalSeedIds.qaPack,
        JSON.stringify(qaCompetencyManifestV12),
        digest(qaCompetencyManifestV12),
        at,
      ],
    );
    await runner.query(
      "INSERT INTO work_type_definitions(id,pack_registration_id,work_type_key,definition_version,intake_schema,intake_schema_hash,required_capabilities,definition_payload,definition_hash,lifecycle_status,registered_at) VALUES($1,$2,'qa.validation','1.2.0',$3,$4,$5,$6,$7,'ACTIVE',$8) ON CONFLICT(work_type_key,definition_version) DO NOTHING",
      [
        qaJiraGitLabLocalSeedIds.qaWorkType,
        qaJiraGitLabLocalSeedIds.qaPack,
        JSON.stringify(qaValidationWorkTypeDefinitionV12.intakeSchemaRef),
        qaValidationWorkTypeDefinitionV12.intakeSchemaRef.digest,
        JSON.stringify(qaValidationWorkTypeDefinitionV12.capabilityRequirements),
        JSON.stringify(qaValidationWorkTypeDefinitionV12),
        digest(qaValidationWorkTypeDefinitionV12),
        at,
      ],
    );
    await runner.query(
      "INSERT INTO competency_pack_registrations(id,pack_key,pack_version,manifest_schema_version,required_core_contract_range,manifest_payload,manifest_hash,registration_status,registered_at) VALUES($1,'competency-qa','1.3.0',1,'>=1.0.0 <2.0.0',$2,$3,'REGISTERED',$4) ON CONFLICT(pack_key,pack_version) DO NOTHING",
      [
        qaJiraGitLabLocalSeedIds.qaPackV13,
        JSON.stringify(qaCompetencyManifestV13),
        digest(qaCompetencyManifestV13),
        at,
      ],
    );
    await runner.query(
      "INSERT INTO work_type_definitions(id,pack_registration_id,work_type_key,definition_version,intake_schema,intake_schema_hash,required_capabilities,definition_payload,definition_hash,lifecycle_status,registered_at) VALUES($1,$2,'qa.validation','1.3.0',$3,$4,$5,$6,$7,'ACTIVE',$8) ON CONFLICT(work_type_key,definition_version) DO NOTHING",
      [
        qaJiraGitLabLocalSeedIds.qaWorkTypeV13,
        qaJiraGitLabLocalSeedIds.qaPackV13,
        JSON.stringify(qaValidationWorkTypeDefinitionV13.intakeSchemaRef),
        qaValidationWorkTypeDefinitionV13.intakeSchemaRef.digest,
        JSON.stringify(qaValidationWorkTypeDefinitionV13.capabilityRequirements),
        JSON.stringify(qaValidationWorkTypeDefinitionV13),
        digest(qaValidationWorkTypeDefinitionV13),
        at,
      ],
    );
    await runner.query(
      "UPDATE workspace_work_types SET active_definition_id=$1,changed_by=$2,changed_at=$3,reason='Feature 006 qa-jira-gitlab-local seed',row_version=row_version+1 WHERE workspace_id=$4 AND work_type_key='qa.validation' AND active_definition_id<>$1",
      [
        qaJiraGitLabLocalSeedIds.qaWorkTypeV13,
        localPersonaIds["owner.local"],
        at,
        localSeedIds.workspaceFunctional,
      ],
    );

    await runner.query(
      "INSERT INTO connector_registrations(id,connector_key,connector_version,manifest_payload,manifest_hash,registration_status,registered_at) VALUES($1,$2,$3,$4,$5,'REGISTERED',$6) ON CONFLICT(connector_key,connector_version) DO NOTHING",
      [
        qaJiraGitLabLocalSeedIds.connector,
        gitLabConnectorManifest.metadata.key,
        gitLabConnectorManifest.metadata.version,
        JSON.stringify(gitLabConnectorManifest),
        digest(gitLabConnectorManifest),
        at,
      ],
    );
    for (const implementation of gitLabConnectorManifest.implements)
      for (const operation of implementation.operations) {
        await runner.query(
          "INSERT INTO connector_capability_implementations(connector_registration_id,capability_key,exact_contract_version,operation,handler_component_ref,supported_idempotency_strategies,supported_confirmation_modes) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING",
          [
            qaJiraGitLabLocalSeedIds.connector,
            implementation.capabilityKey,
            implementation.exactContractVersions[0],
            operation,
            implementation.handlerComponentRef,
            JSON.stringify(implementation.supportedIdempotencyStrategies),
            JSON.stringify(implementation.supportedConfirmationModes),
          ],
        );
      }
    await runner.query(
      "INSERT INTO connection_headers(id,workspace_id,key,current_published_version) VALUES($1,$2,'qa-gitlab-local',1) ON CONFLICT(id) DO NOTHING",
      [qaJiraGitLabLocalSeedIds.connection, localSeedIds.workspaceFunctional],
    );
    await runner.query(
      "INSERT INTO connection_revisions(id,workspace_id,header_id,version,status,content,content_hash,created_at) VALUES($1,$2,$3,1,'PUBLISHED',$4,$5,$6) ON CONFLICT(id) DO NOTHING",
      [
        qaJiraGitLabLocalSeedIds.connectionRevision,
        localSeedIds.workspaceFunctional,
        qaJiraGitLabLocalSeedIds.connection,
        JSON.stringify(configuration.connection),
        configuration.connectionHash,
        at,
      ],
    );
    await runner.query(
      "INSERT INTO connector_profile_headers(id,workspace_id,key,current_published_version) VALUES($1,$2,'qa-gitlab-local',1) ON CONFLICT(id) DO NOTHING",
      [qaJiraGitLabLocalSeedIds.profile, localSeedIds.workspaceFunctional],
    );
    await runner.query(
      "INSERT INTO connector_profile_revisions(id,workspace_id,header_id,version,status,content,content_hash,created_at) VALUES($1,$2,$3,1,'PUBLISHED',$4,$5,$6) ON CONFLICT(id) DO NOTHING",
      [
        qaJiraGitLabLocalSeedIds.profileRevision,
        localSeedIds.workspaceFunctional,
        qaJiraGitLabLocalSeedIds.profile,
        JSON.stringify(configuration.profile),
        configuration.profileHash,
        at,
      ],
    );
    await runner.query(
      "INSERT INTO project_integration_binding_headers(id,workspace_id,project_id,key,current_published_version) VALUES($1,$2,$3,'qa-gitlab-automation',1) ON CONFLICT(id) DO NOTHING",
      [qaJiraGitLabLocalSeedIds.binding, localSeedIds.workspaceFunctional, localSeedIds.alpha],
    );
    await runner.query(
      "INSERT INTO project_integration_binding_revisions(id,workspace_id,project_id,header_id,version,status,content,content_hash,created_at) VALUES($1,$2,$3,$4,1,'PUBLISHED',$5,$6,$7) ON CONFLICT(id) DO NOTHING",
      [
        qaJiraGitLabLocalSeedIds.bindingRevision,
        localSeedIds.workspaceFunctional,
        localSeedIds.alpha,
        qaJiraGitLabLocalSeedIds.binding,
        JSON.stringify(configuration.binding),
        configuration.bindingHash,
        at,
      ],
    );

    const discoveryHash = digest({
      project: 5001,
      ref: "refs/heads/qa/smoke",
      commit: "abcdef123456",
      jobs: ["awp:result"],
    });
    const discoveryRef = Object.freeze({
      id: qaJiraGitLabLocalSeedIds.discovery,
      version: 1,
      contentHash: discoveryHash,
    });
    await runner.query(
      `INSERT INTO gitlab_discovery_snapshots(discovery_snapshot_id,workspace_id,connection_ref,connector_version,adapter_family,adapter_contract_version,edition,exact_version,exact_build,api_family,tls_endpoint_fingerprint,numeric_project_id,canonical_project_path_hash,default_branch,exact_ref,ref_commit_sha,supported_features,identity_permission_probe_hash,runner_readiness_hash,network_readiness_hash,production_denied,sanitized_metadata,schema_ref,schema_digest,content_hash,validation_status,collected_at,expires_at) VALUES($1,$2,$3,'1.0.0','gitlab-rest-v4','1.0.0','EE','18.1.0-mock.1','mock-build-2026.09.01.1','v4',$4,5001,$5,'qa/smoke','refs/heads/qa/smoke','abcdef123456',$6,$7,$8,$9,true,$10,$11,$12,$13,'VALID',$14,$15)`,
      [
        qaJiraGitLabLocalSeedIds.discovery,
        localSeedIds.workspaceFunctional,
        JSON.stringify({
          id: qaJiraGitLabLocalSeedIds.connection,
          version: 1,
          contentHash: configuration.connectionHash,
        }),
        digest(configuration.endpoint),
        digest("local/qa-smoke"),
        JSON.stringify({
          projectRead: true,
          sourceRead: true,
          ciLintDryRun: true,
          ciLintIncludeJobs: true,
          pipelineRead: true,
          pipelineTrigger: true,
          artifactRead: true,
          standardWebhookHmacSha256: true,
        }),
        digest("read-api:project-5001"),
        digest("runner:ready"),
        digest("network:local"),
        JSON.stringify({
          projectPathHash: digest("local/qa-smoke"),
          jobSetHash: digest(["awp:result"]),
        }),
        JSON.stringify({ id: "urn:awp:schemas:005:gitlab-discovery-snapshot:v1", version: 1 }),
        digest("gitlab-discovery-snapshot@1.0.0"),
        discoveryHash,
        at,
        "2026-09-08T07:45:00.000Z",
      ],
    );
    const probeHash = digest({
      suite: "smoke",
      resultJob: "awp:result",
      artifactPath: "awp/results/result.json",
    });
    await runner.query(
      `INSERT INTO gitlab_suite_contract_probes(suite_contract_probe_id,workspace_id,profile_ref,discovery_snapshot_id,numeric_project_id,suite_key_hash,logical_execution_contract_hash,exact_ref_hash,result_contract_hash,artifact_policy_hash,source_fact_set_hash,dry_run_hash,fixture_result_hash,artifact_probe_hash,status,issues,content_hash,created_at) VALUES($1,$2,$3,$4,5001,$5,$6,$7,$8,$9,$10,$11,$12,$13,'VALID','[]',$14,$15)`,
      [
        qaJiraGitLabLocalSeedIds.suiteProbe,
        localSeedIds.workspaceFunctional,
        JSON.stringify({
          id: qaJiraGitLabLocalSeedIds.profile,
          version: 1,
          contentHash: configuration.profileHash,
        }),
        qaJiraGitLabLocalSeedIds.discovery,
        digest("smoke"),
        digest("logical:qa.validation:smoke"),
        digest("refs/heads/qa/smoke"),
        digest(resultSchemaRef),
        digest(configuration.profile.artifactPolicy),
        digest([]),
        digest("ci-lint:valid"),
        digest("fixture:valid"),
        digest("artifact:verified"),
        probeHash,
        at,
      ],
    );
    const validationHash = digest({
      profileHash: configuration.profileHash,
      discoveryHash,
      probeHash,
      status: "VALID",
    });
    await runner.query(
      `INSERT INTO gitlab_profile_validation_details(profile_validation_detail_id,workspace_id,profile_ref,candidate_content_hash,discovery_snapshot_id,numeric_project_id,external_scope_hash,allowed_refs_hash,allowed_environments_hash,input_mapping_hash,result_contract_hash,artifact_contract_hash,permission_probe,ci_lint_probe,no_deploy_probe,non_production_probe,lookup_marker_probe,status,issues,preview_hash,probe_set_hash,content_hash,created_at) VALUES($1,$2,$3,$4,$5,5001,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'VALID','[]',$17,$18,$19,$20)`,
      [
        qaJiraGitLabLocalSeedIds.profileValidationDetail,
        localSeedIds.workspaceFunctional,
        JSON.stringify({ id: qaJiraGitLabLocalSeedIds.profile, version: 1 }),
        configuration.profileHash,
        qaJiraGitLabLocalSeedIds.discovery,
        digest({ project: 5001 }),
        digest(configuration.profile.allowedRefs),
        digest(["environment:test:qa-1@17"]),
        configuration.profile.trigger.inputMappingHash,
        digest(configuration.profile.resultContract),
        digest(configuration.profile.artifactPolicy),
        JSON.stringify({ status: "PASS" }),
        JSON.stringify({ dryRun: true, includeJobs: true, status: "PASS" }),
        JSON.stringify({ status: "PASS" }),
        JSON.stringify({ status: "PASS" }),
        JSON.stringify({ marker: "AWP_REQUEST_MARKER", status: "PASS" }),
        digest({ profile: configuration.profileHash, discovery: discoveryHash }),
        digest([probeHash]),
        validationHash,
        at,
      ],
    );
    await runner.query(
      "INSERT INTO integration_validation_reports(id,workspace_id,project_id,subject_kind,subject_id,subject_version,outcome,content_hash,report,created_at) VALUES($1,$2,$3,'PROFILE',$4,1,'VALID',$5,$6,$7) ON CONFLICT(id) DO NOTHING",
      [
        qaJiraGitLabLocalSeedIds.validation,
        localSeedIds.workspaceFunctional,
        localSeedIds.alpha,
        qaJiraGitLabLocalSeedIds.profile,
        configuration.profileHash,
        JSON.stringify({
          checks: [{ key: "gitlab-profile-discovery", outcome: "PASS" }],
          discoveryRef,
          validationDetailRef: {
            id: qaJiraGitLabLocalSeedIds.profileValidationDetail,
            contentHash: validationHash,
          },
          suiteProbeRef: { id: qaJiraGitLabLocalSeedIds.suiteProbe, contentHash: probeHash },
        }),
        at,
      ],
    );

    const stored = (await runner.query(
      "SELECT content_hash FROM connector_profile_revisions WHERE header_id=$1 AND version=1",
      [qaJiraGitLabLocalSeedIds.profile],
    )) as readonly { content_hash: string }[];
    if (stored.length !== 1 || stored[0]?.content_hash !== configuration.profileHash)
      throw new Error("QA_JIRA_GITLAB_LOCAL_SEED_CONFLICT");
    await runner.query(
      "INSERT INTO local_seed_markers(key,version,applied_at) VALUES($1,$2,clock_timestamp()) ON CONFLICT(key) DO UPDATE SET version=EXCLUDED.version,applied_at=EXCLUDED.applied_at",
      [QA_JIRA_GITLAB_LOCAL_SEED_KEY, QA_JIRA_GITLAB_LOCAL_SEED_VERSION],
    );
    await runner.commitTransaction();
    return "applied";
  } catch (error) {
    await runner.rollbackTransaction();
    throw error;
  } finally {
    await runner.release();
  }
}

export async function runQaJiraGitLabLocalSeed(
  dataSource: DataSource,
  environment: RuntimeEnvironment,
): Promise<"applied" | "unchanged"> {
  if (
    !new Set(["qa-jira-gitlab-local", "qa-jira-gitlab-mattermost-local"]).has(
      environment.composition,
    ) ||
    environment.environmentScope !== "LOCAL" ||
    environment.externalNetworkMode !== "deny" ||
    !environment.mockHubUrl
  )
    throw new Error("QA_JIRA_GITLAB_LOCAL_SEED_COMPOSITION_REQUIRED");
  if (environment.composition === "qa-jira-gitlab-mattermost-local")
    await runQaJiraMattermostLocalSeed(dataSource, environment);
  else await runQaJiraLocalSeed(dataSource, environment);
  return await seedGitLabFoundation(dataSource, environment);
}
