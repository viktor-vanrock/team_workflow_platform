import { createHash } from "node:crypto";

import type { DataSource } from "typeorm";

import {
  qaCompetencyManifestV11,
  qaValidationWorkTypeDefinitionV11,
} from "@awp/competency-qa/node";
import { mattermostConnectorManifest } from "@awp/connector-mattermost";

import type { RuntimeEnvironment } from "../config/environment.ts";
import { localPersonaIds, localSeedIds } from "./local-seed.ts";
import { runQaJiraLocalSeed } from "./qa-jira-local-seed.ts";

export const QA_JIRA_MATTERMOST_LOCAL_SEED_KEY = "004-qa-jira-mattermost-local";
export const QA_JIRA_MATTERMOST_LOCAL_SEED_VERSION = 1;

export const qaJiraMattermostLocalSeedIds = Object.freeze({
  pack: "94000000-0000-4000-8000-000000000001",
  workType: "94000000-0000-4000-8000-000000000002",
  connector: "94000000-0000-4000-8000-000000000003",
  connection: "94000000-0000-4000-8000-000000000004",
  connectionRevision: "94000000-0000-4000-8000-000000000005",
  profile: "94000000-0000-4000-8000-000000000006",
  profileRevision: "94000000-0000-4000-8000-000000000007",
  binding: "94000000-0000-4000-8000-000000000008",
  bindingRevision: "94000000-0000-4000-8000-000000000009",
  validation: "94000000-0000-4000-8000-000000000010",
});

const digest = (value: unknown): `sha256:${string}` =>
  `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;

export async function runQaJiraMattermostLocalSeed(
  source: DataSource,
  environment: RuntimeEnvironment,
): Promise<"applied" | "unchanged"> {
  if (
    !new Set(["qa-jira-mattermost-local", "qa-jira-gitlab-mattermost-local"]).has(
      environment.composition,
    ) ||
    environment.environmentScope !== "LOCAL" ||
    !environment.mockHubUrl
  ) {
    throw new Error("QA_JIRA_MATTERMOST_LOCAL_SEED_COMPOSITION_REQUIRED");
  }
  await runQaJiraLocalSeed(source, environment);
  const runner = source.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const markers = (await runner.query(
      "SELECT version FROM local_seed_markers WHERE key=$1 FOR UPDATE",
      [QA_JIRA_MATTERMOST_LOCAL_SEED_KEY],
    )) as readonly { version: number }[];
    if (Number(markers[0]?.version) === QA_JIRA_MATTERMOST_LOCAL_SEED_VERSION) {
      await runner.commitTransaction();
      return "unchanged";
    }
    const now = "2026-09-01T00:00:00.000Z";
    await runner.query(
      "INSERT INTO competency_pack_registrations(id,pack_key,pack_version,manifest_schema_version,required_core_contract_range,manifest_payload,manifest_hash,registration_status,registered_at) VALUES($1,'competency-qa','1.1.0',1,'>=1.0.0 <2.0.0',$2,$3,'REGISTERED',$4) ON CONFLICT(pack_key,pack_version) DO NOTHING",
      [
        qaJiraMattermostLocalSeedIds.pack,
        JSON.stringify(qaCompetencyManifestV11),
        digest(qaCompetencyManifestV11),
        now,
      ],
    );
    await runner.query(
      "INSERT INTO work_type_definitions(id,pack_registration_id,work_type_key,definition_version,intake_schema,intake_schema_hash,required_capabilities,definition_payload,definition_hash,lifecycle_status,registered_at) VALUES($1,$2,'qa.validation','1.1.0',$3,$4,$5,$6,$7,'ACTIVE',$8) ON CONFLICT(work_type_key,definition_version) DO NOTHING",
      [
        qaJiraMattermostLocalSeedIds.workType,
        qaJiraMattermostLocalSeedIds.pack,
        JSON.stringify(qaValidationWorkTypeDefinitionV11.intakeSchemaRef),
        qaValidationWorkTypeDefinitionV11.intakeSchemaRef.digest,
        JSON.stringify(qaValidationWorkTypeDefinitionV11.capabilityRequirements),
        JSON.stringify(qaValidationWorkTypeDefinitionV11),
        digest(qaValidationWorkTypeDefinitionV11),
        now,
      ],
    );
    await runner.query(
      "UPDATE workspace_work_types SET active_definition_id=$1,changed_by=$2,changed_at=$3,reason='Feature 004 qa-jira-mattermost-local seed' WHERE workspace_id=$4 AND work_type_key='qa.validation'",
      [
        qaJiraMattermostLocalSeedIds.workType,
        localPersonaIds["owner.local"],
        now,
        localSeedIds.workspaceFunctional,
      ],
    );
    await runner.query(
      "INSERT INTO connector_registrations(id,connector_key,connector_version,manifest_payload,manifest_hash,registration_status,registered_at) VALUES($1,$2,$3,$4,$5,'REGISTERED',$6) ON CONFLICT(connector_key,connector_version) DO NOTHING",
      [
        qaJiraMattermostLocalSeedIds.connector,
        mattermostConnectorManifest.metadata.key,
        mattermostConnectorManifest.metadata.version,
        JSON.stringify(mattermostConnectorManifest),
        digest(mattermostConnectorManifest),
        now,
      ],
    );
    for (const implemented of mattermostConnectorManifest.implements) {
      for (const operation of implemented.operations) {
        await runner.query(
          "INSERT INTO connector_capability_implementations(connector_registration_id,capability_key,exact_contract_version,operation,handler_component_ref,supported_idempotency_strategies,supported_confirmation_modes) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING",
          [
            qaJiraMattermostLocalSeedIds.connector,
            implemented.capabilityKey,
            implemented.exactContractVersions[0],
            operation,
            implemented.handlerComponentRef,
            JSON.stringify(implemented.supportedIdempotencyStrategies),
            JSON.stringify(implemented.supportedConfirmationModes),
          ],
        );
      }
    }
    const connection = Object.freeze({
      connectorKey: mattermostConnectorManifest.metadata.key,
      endpoint: environment.mockHubUrl,
      environmentScope: "LOCAL",
      botCredentialSecretRef: "secret-ref:local/mattermost/project-alpha/bot-token",
      projectId: localSeedIds.alpha,
    });
    const profile = Object.freeze({
      schemaVersion: "mattermost-profile@1.0.0",
      workspaceId: localSeedIds.workspaceFunctional,
      projectId: localSeedIds.alpha,
      connectionRef: { id: qaJiraMattermostLocalSeedIds.connection, version: 1 },
      teamId: "mm-team-project-alpha",
      botUserId: "mm-user-hermes",
      channelIds: ["mm-channel-project-alpha"],
      reconciliationMode: "EFFECT_MARKER_LOOKUP",
      dataClassificationKey: "INTERNAL",
    });
    const binding = Object.freeze({
      key: "qa-mattermost",
      dataClassificationKey: "INTERNAL",
      entries: [
        {
          logicalRole: "INTAKE_MESSAGING",
          capabilityKey: "messaging.intake",
          exactContractVersion: "1.0.0",
          operations: ["intake.present"],
          profileRef: { id: qaJiraMattermostLocalSeedIds.profile, version: 1 },
        },
        {
          logicalRole: "NOTIFICATION_MESSAGING",
          capabilityKey: "messaging.notify",
          exactContractVersion: "1.0.0",
          operations: ["notification.send"],
          profileRef: { id: qaJiraMattermostLocalSeedIds.profile, version: 1 },
        },
        {
          logicalRole: "INTERACTION_MESSAGING",
          capabilityKey: "messaging.callback",
          exactContractVersion: "1.0.0",
          operations: ["callback.present"],
          profileRef: { id: qaJiraMattermostLocalSeedIds.profile, version: 1 },
        },
      ],
    });
    await runner.query(
      "INSERT INTO connection_headers(id,workspace_id,key,current_published_version) VALUES($1,$2,'qa-mattermost-local',1) ON CONFLICT(id) DO NOTHING",
      [qaJiraMattermostLocalSeedIds.connection, localSeedIds.workspaceFunctional],
    );
    await runner.query(
      "INSERT INTO connection_revisions(id,workspace_id,header_id,version,status,content,content_hash,created_at) VALUES($1,$2,$3,1,'PUBLISHED',$4,$5,$6) ON CONFLICT(id) DO NOTHING",
      [
        qaJiraMattermostLocalSeedIds.connectionRevision,
        localSeedIds.workspaceFunctional,
        qaJiraMattermostLocalSeedIds.connection,
        JSON.stringify(connection),
        digest(connection),
        now,
      ],
    );
    await runner.query(
      "INSERT INTO connector_profile_headers(id,workspace_id,key,current_published_version) VALUES($1,$2,'qa-mattermost-local',1) ON CONFLICT(id) DO NOTHING",
      [qaJiraMattermostLocalSeedIds.profile, localSeedIds.workspaceFunctional],
    );
    await runner.query(
      "INSERT INTO connector_profile_revisions(id,workspace_id,header_id,version,status,content,content_hash,created_at) VALUES($1,$2,$3,1,'PUBLISHED',$4,$5,$6) ON CONFLICT(id) DO NOTHING",
      [
        qaJiraMattermostLocalSeedIds.profileRevision,
        localSeedIds.workspaceFunctional,
        qaJiraMattermostLocalSeedIds.profile,
        JSON.stringify(profile),
        digest(profile),
        now,
      ],
    );
    await runner.query(
      "INSERT INTO project_integration_binding_headers(id,workspace_id,project_id,key,current_published_version) VALUES($1,$2,$3,'qa-mattermost',1) ON CONFLICT(id) DO NOTHING",
      [qaJiraMattermostLocalSeedIds.binding, localSeedIds.workspaceFunctional, localSeedIds.alpha],
    );
    await runner.query(
      "INSERT INTO project_integration_binding_revisions(id,workspace_id,project_id,header_id,version,status,content,content_hash,created_at) VALUES($1,$2,$3,$4,1,'PUBLISHED',$5,$6,$7) ON CONFLICT(id) DO NOTHING",
      [
        qaJiraMattermostLocalSeedIds.bindingRevision,
        localSeedIds.workspaceFunctional,
        localSeedIds.alpha,
        qaJiraMattermostLocalSeedIds.binding,
        JSON.stringify(binding),
        digest(binding),
        now,
      ],
    );
    await runner.query(
      "INSERT INTO integration_validation_reports(id,workspace_id,project_id,subject_kind,subject_id,subject_version,outcome,content_hash,report,created_at) VALUES($1,$2,$3,'PROFILE',$4,1,'VALID',$5,$6,$7) ON CONFLICT(id) DO NOTHING",
      [
        qaJiraMattermostLocalSeedIds.validation,
        localSeedIds.workspaceFunctional,
        localSeedIds.alpha,
        qaJiraMattermostLocalSeedIds.profile,
        digest(profile),
        JSON.stringify({ checks: [{ key: "mattermost-local-profile", outcome: "PASS" }] }),
        now,
      ],
    );
    await runner.query(
      "INSERT INTO local_seed_markers(key,version,applied_at) VALUES($1,$2,clock_timestamp()) ON CONFLICT(key) DO UPDATE SET version=EXCLUDED.version,applied_at=EXCLUDED.applied_at",
      [QA_JIRA_MATTERMOST_LOCAL_SEED_KEY, QA_JIRA_MATTERMOST_LOCAL_SEED_VERSION],
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
