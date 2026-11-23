import { createHash } from "node:crypto";

import type { DataSource, QueryRunner } from "typeorm";

import {
  publishQaProjectContext,
  publishQaRiskReviewPolicy,
  qaCompetencyManifest,
  qaValidationWorkTypeDefinition,
} from "@awp/competency-qa/node";
import { operationalMockConnectorManifest } from "@awp/connector-mock";

import {
  operationalWorkItemCapabilityContract,
  qaUs1MockProfileCapability,
  qaUs1RequestAuthorityBindingEntry,
  qaUs2MockProfileCapability,
  qaUs2RequestAuthorityBindingEntry,
  qaUs4DefectDestinationBindingEntry,
  qaUs4MockProfileCapability,
  qaUs5MockProfileCapability,
  qaUs5RequestAuthorityBindingEntry,
} from "../qa/operational-work-item.contract.ts";
import { localPersonaCatalog } from "../security/local-security.ts";
import { localPersonaIds, localSeedIds, runLocalSeed } from "./local-seed.ts";

export const QA_LOCAL_SEED_KEY = "002-qa-local";
export const QA_LOCAL_SEED_VERSION = 4;
export type QaLocalSeedResult = "applied" | "unchanged";

export const qaLocalSeedIds = Object.freeze({
  pack: "90000000-0000-4000-8000-000000000001",
  workType: "90000000-0000-4000-8000-000000000002",
  workspaceWorkType: "90000000-0000-4000-8000-000000000003",
  connector: "91000000-0000-4000-8000-000000000001",
  capability: "91000000-0000-4000-8000-000000000002",
  connection: "92000000-0000-4000-8000-000000000001",
  mapping: "92000000-0000-4000-8000-000000000002",
  profile: "92000000-0000-4000-8000-000000000003",
  alphaBinding: "92000000-0000-4000-8000-000000000004",
  profileRevision2: "92100000-0000-4000-8000-000000000013",
  alphaBindingRevision2: "92100000-0000-4000-8000-000000000014",
  profileRevision3: "92100000-0000-4000-8000-000000000023",
  alphaBindingRevision3: "92100000-0000-4000-8000-000000000024",
  profileRevision4: "92100000-0000-4000-8000-000000000033",
  alphaBindingRevision4: "92100000-0000-4000-8000-000000000034",
  context: "93000000-0000-4000-8000-000000000001",
  contextVersion: "93000000-0000-4000-8000-000000000002",
  riskPolicy: "93000000-0000-4000-8000-000000000003",
  riskPolicyVersion: "93000000-0000-4000-8000-000000000004",
  environment: "94000000-0000-4000-8000-000000000001",
  leadMembership: "94000000-0000-4000-8000-000000000002",
  leadRole: "94000000-0000-4000-8000-000000000003",
  leadEntitlement: "94000000-0000-4000-8000-000000000004",
});

export const qaLocalFixtureCatalog = Object.freeze({
  responseChannels: Object.freeze({
    "requester.alpha": Object.freeze({
      state: "CONFIRMED",
      channelKind: "PLATFORM_WEB",
      channelId: "95000000-0000-4000-8000-000000000001",
      version: 1,
    }),
    "executor.alpha": Object.freeze({
      state: "MISSING",
      reasonCode: "REQUESTER_RESPONSE_CHANNEL_MISSING",
    }),
  }),
  retest: Object.freeze({
    externalHistorical: Object.freeze({
      kind: "EXTERNAL_HISTORICAL",
      historicalSessionRef: Object.freeze({
        kind: "historical-session",
        id: "local-session-001",
        version: "1",
        contentHash: "sha256:abababababababababababababababababababababababababababababababab",
      }),
    }),
  }),
  projectRegistry: Object.freeze({ ALPHA: "CURRENT", BETA: "NEEDS_REVIEW", DELTA: "CURRENT" }),
  readiness: Object.freeze({
    incomplete: Object.freeze({
      goal: undefined,
      blockersDeclared: false,
      dependenciesDeclared: false,
      expectedState: "NEEDS_INFO",
    }),
    revisedLowRisk: Object.freeze({
      goal: "Validate the accepted outcome",
      scope: "Reference manual scope",
      acceptanceOutcome: "Expected behavior is observed",
      blockers: Object.freeze([]),
      dependencies: Object.freeze([]),
      requestRisk: "LOW",
      expectedState: "READY",
    }),
    highRisk: Object.freeze({ requestRisk: "HIGH", projectRisk: "MEDIUM", effectiveRisk: "HIGH" }),
    registryNeedsReview: Object.freeze({
      blockerCode: "PROJECT_REGISTRY_NEEDS_REVIEW",
      waivable: true,
    }),
    originalRequesterMissingChannel: Object.freeze({
      blockerCode: "RESPONSE_CHANNEL_UNCONFIRMED",
      waivable: false,
    }),
    mappingBlocked: Object.freeze({
      blockerCode: "BINDING_PROFILE_MAPPING_INVALID",
      waivable: false,
    }),
    retestLineage: Object.freeze({
      supportedNow: "EXTERNAL_HISTORICAL",
      nativeQaSessionAvailableFrom: "US3",
    }),
  }),
  completion: Object.freeze({
    distinctLeadPersona: "lead.alpha",
    failInput: Object.freeze({
      verdict: "FAIL",
      effectiveRisk: "HIGH",
      preSigned: false,
      residualRisk: "Linked product defect remains open; QA completion is not a release decision",
    }),
    profileRef: Object.freeze({ id: qaLocalSeedIds.profile, version: 4 }),
    bindingRef: Object.freeze({ id: qaLocalSeedIds.alphaBinding, version: 4 }),
    expectedExternalPredecessor: "READY",
    requestedNormalizedStatus: "DONE",
  }),
});

function digest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

const actor = Object.freeze({
  kind: "HUMAN" as const,
  principalId: localPersonaIds["requester.alpha"],
  issuer: "https://fake-idp:4443/oidc",
  subject: "requester.alpha",
});
const exactRef = (kind: string, id: string, version: string) =>
  Object.freeze({ kind, id, version, contentHash: digest({ kind, id, version }) });

async function seedExtensionRegistry(runner: QueryRunner): Promise<void> {
  const now = "2026-08-30T00:00:00.000Z";
  await runner.query(
    "INSERT INTO competency_pack_registrations(id,pack_key,pack_version,manifest_schema_version,required_core_contract_range,manifest_payload,manifest_hash,registration_status,registered_at) VALUES($1,'competency-qa','1.0.0',1,'>=1.0.0 <2.0.0',$2,$3,'REGISTERED',$4) ON CONFLICT DO NOTHING",
    [qaLocalSeedIds.pack, JSON.stringify(qaCompetencyManifest), digest(qaCompetencyManifest), now],
  );
  await runner.query(
    "INSERT INTO work_type_definitions(id,pack_registration_id,work_type_key,definition_version,intake_schema,intake_schema_hash,required_capabilities,definition_payload,definition_hash,lifecycle_status,registered_at) VALUES($1,$2,'qa.validation','1.0.0',$3,$4,$5,$6,$7,'ACTIVE',$8) ON CONFLICT DO NOTHING",
    [
      qaLocalSeedIds.workType,
      qaLocalSeedIds.pack,
      JSON.stringify(qaValidationWorkTypeDefinition.intakeSchemaRef),
      qaValidationWorkTypeDefinition.intakeSchemaRef.digest,
      JSON.stringify(qaValidationWorkTypeDefinition.capabilityRequirements),
      JSON.stringify(qaValidationWorkTypeDefinition),
      digest(qaValidationWorkTypeDefinition),
      now,
    ],
  );
  await runner.query(
    "INSERT INTO workspace_work_types(id,workspace_id,work_type_key,active_definition_id,intake_state,changed_by,changed_at,reason) VALUES($1,$2,'qa.validation',$3,'ENABLED',$4,$5,'Feature 002 qa-local seed') ON CONFLICT DO NOTHING",
    [
      qaLocalSeedIds.workspaceWorkType,
      localSeedIds.workspaceFunctional,
      qaLocalSeedIds.workType,
      localPersonaIds["owner.local"],
      now,
    ],
  );
  await runner.query(
    "INSERT INTO connector_registrations(id,connector_key,connector_version,manifest_payload,manifest_hash,registration_status,registered_at) VALUES($1,'operational.mock','1.0.0',$2,$3,'REGISTERED',$4) ON CONFLICT DO NOTHING",
    [
      qaLocalSeedIds.connector,
      JSON.stringify(operationalMockConnectorManifest),
      digest(operationalMockConnectorManifest),
      now,
    ],
  );
  await runner.query(
    "INSERT INTO capability_contracts(id,capability_key,contract_version,contract_payload,schema_hash,lifecycle_status,registered_at) VALUES($1,'operational-work-item','1.0.0',$2,$3,'ACTIVE',$4) ON CONFLICT DO NOTHING",
    [
      qaLocalSeedIds.capability,
      JSON.stringify(operationalWorkItemCapabilityContract),
      digest(operationalWorkItemCapabilityContract),
      now,
    ],
  );
  await runner.query(
    "INSERT INTO connector_capability_implementations(connector_registration_id,capability_key,exact_contract_version,operation,handler_component_ref,supported_idempotency_strategies,supported_confirmation_modes) VALUES($1,'operational-work-item','1.0.0','request.create','operational.mock.request-create-handler',$2,$3) ON CONFLICT DO NOTHING",
    [
      qaLocalSeedIds.connector,
      JSON.stringify(["NATIVE_KEY"]),
      JSON.stringify(["SYNC_RECEIPT", "READ_BACK"]),
    ],
  );
  await runner.query(
    "INSERT INTO connector_capability_implementations(connector_registration_id,capability_key,exact_contract_version,operation,handler_component_ref,supported_idempotency_strategies,supported_confirmation_modes) VALUES($1,'operational-work-item','1.0.0','request.transition','operational.mock.request-transition-handler',$2,$3) ON CONFLICT DO NOTHING",
    [
      qaLocalSeedIds.connector,
      JSON.stringify(["NATIVE_KEY"]),
      JSON.stringify(["SYNC_RECEIPT", "READ_BACK"]),
    ],
  );
  await runner.query(
    "INSERT INTO connector_capability_implementations(connector_registration_id,capability_key,exact_contract_version,operation,handler_component_ref,supported_idempotency_strategies,supported_confirmation_modes) VALUES($1,'operational-work-item','1.0.0','defect.create','operational.mock.defect-create-handler',$2,$3) ON CONFLICT DO NOTHING",
    [
      qaLocalSeedIds.connector,
      JSON.stringify(["NATIVE_KEY"]),
      JSON.stringify(["SYNC_RECEIPT", "READ_BACK"]),
    ],
  );
}

async function seedIntegration(runner: QueryRunner): Promise<void> {
  const now = "2026-08-30T00:00:00.000Z";
  for (const [table, id, key] of [
    ["connection_headers", qaLocalSeedIds.connection, "qa-operational-local"],
    ["connector_mapping_headers", qaLocalSeedIds.mapping, "qa-operational-default"],
    ["connector_profile_headers", qaLocalSeedIds.profile, "qa-operational-us1"],
  ] as const)
    await runner.query(
      `INSERT INTO ${table}(id,workspace_id,key,current_published_version) VALUES($1,$2,$3,1) ON CONFLICT DO NOTHING`,
      [id, localSeedIds.workspaceFunctional, key],
    );
  const connection = {
    connectorKey: "operational.mock",
    endpoint: "http://mock-hub:4010",
    environmentScope: "LOCAL",
    serviceIdentitySecretRef: "secretref://local/mock-hub",
  };
  const mapping = {
    capabilityKey: "operational-work-item",
    connectorKey: "operational.mock",
    authorityScopeKey: "qa.alpha",
    fields: { summary: "payload.summary", classification: "payload.dataClassificationKey" },
  };
  const profile = {
    connectorKey: "operational.mock",
    connectionRef: { id: qaLocalSeedIds.connection, version: 1 },
    mappingRef: { id: qaLocalSeedIds.mapping, version: 1, contentHash: digest(mapping) },
    capabilityConfigurations: [qaUs1MockProfileCapability],
    dataClassificationKey: "INTERNAL",
  };
  const binding = {
    key: "qa-request-authority",
    dataClassificationKey: "INTERNAL",
    entries: [
      {
        ...qaUs1RequestAuthorityBindingEntry,
        profileRef: { id: qaLocalSeedIds.profile, version: 1 },
        externalScope: {
          schemaRef: { id: "urn:awp:schemas:operational-work-item:external-scope:v1", version: 1 },
          value: {
            authorityScopeKey: "qa.alpha",
            environmentScope: "LOCAL",
            allowedEntityKinds: ["REQUEST"],
          },
        },
      },
    ],
  };
  const profile2 = {
    ...profile,
    capabilityConfigurations: [qaUs2MockProfileCapability],
    previousRef: {
      id: "92100000-0000-4000-8000-000000000003",
      version: 1,
      contentHash: digest(profile),
    },
  };
  const binding2 = {
    ...binding,
    entries: [
      {
        ...qaUs2RequestAuthorityBindingEntry,
        profileRef: { id: qaLocalSeedIds.profile, version: 2 },
        externalScope: {
          schemaRef: { id: "urn:awp:schemas:operational-work-item:external-scope:v1", version: 1 },
          value: {
            authorityScopeKey: "qa.alpha",
            environmentScope: "LOCAL",
            allowedEntityKinds: ["REQUEST"],
          },
        },
      },
    ],
    previousRef: {
      id: "92100000-0000-4000-8000-000000000004",
      version: 1,
      contentHash: digest(binding),
    },
  };
  const profile3 = {
    ...profile,
    capabilityConfigurations: [qaUs4MockProfileCapability],
    previousRef: { id: qaLocalSeedIds.profileRevision2, version: 2, contentHash: digest(profile2) },
  };
  const binding3 = {
    ...binding,
    entries: [
      {
        ...qaUs2RequestAuthorityBindingEntry,
        profileRef: { id: qaLocalSeedIds.profile, version: 3 },
        externalScope: {
          schemaRef: { id: "urn:awp:schemas:operational-work-item:external-scope:v1", version: 1 },
          value: {
            authorityScopeKey: "qa.alpha",
            environmentScope: "LOCAL",
            allowedEntityKinds: ["REQUEST"],
          },
        },
      },
      {
        ...qaUs4DefectDestinationBindingEntry,
        profileRef: { id: qaLocalSeedIds.profile, version: 3 },
        externalScope: {
          schemaRef: { id: "urn:awp:schemas:operational-work-item:external-scope:v1", version: 1 },
          value: {
            authorityScopeKey: "qa.alpha",
            environmentScope: "LOCAL",
            allowedEntityKinds: ["DEFECT"],
          },
        },
      },
    ],
    previousRef: {
      id: qaLocalSeedIds.alphaBindingRevision2,
      version: 2,
      contentHash: digest(binding2),
    },
  };
  const profile4 = {
    ...profile,
    capabilityConfigurations: [qaUs5MockProfileCapability],
    previousRef: { id: qaLocalSeedIds.profileRevision3, version: 3, contentHash: digest(profile3) },
  };
  const binding4 = {
    ...binding,
    entries: [
      {
        ...qaUs5RequestAuthorityBindingEntry,
        profileRef: { id: qaLocalSeedIds.profile, version: 4 },
        externalScope: {
          schemaRef: { id: "urn:awp:schemas:operational-work-item:external-scope:v1", version: 1 },
          value: {
            authorityScopeKey: "qa.alpha",
            environmentScope: "LOCAL",
            allowedEntityKinds: ["REQUEST"],
          },
        },
      },
      {
        ...qaUs4DefectDestinationBindingEntry,
        profileRef: { id: qaLocalSeedIds.profile, version: 4 },
        externalScope: {
          schemaRef: { id: "urn:awp:schemas:operational-work-item:external-scope:v1", version: 1 },
          value: {
            authorityScopeKey: "qa.alpha",
            environmentScope: "LOCAL",
            allowedEntityKinds: ["DEFECT"],
          },
        },
      },
    ],
    previousRef: {
      id: qaLocalSeedIds.alphaBindingRevision3,
      version: 3,
      contentHash: digest(binding3),
    },
  };
  await runner.query(
    "INSERT INTO connection_revisions(id,workspace_id,header_id,version,status,content,content_hash,created_at) VALUES($1,$2,$3,1,'PUBLISHED',$4,$5,$6) ON CONFLICT DO NOTHING",
    [
      "92100000-0000-4000-8000-000000000001",
      localSeedIds.workspaceFunctional,
      qaLocalSeedIds.connection,
      JSON.stringify(connection),
      digest(connection),
      now,
    ],
  );
  await runner.query(
    "INSERT INTO connector_mapping_revisions(id,workspace_id,header_id,version,status,content,content_hash,created_at) VALUES($1,$2,$3,1,'PUBLISHED',$4,$5,$6) ON CONFLICT DO NOTHING",
    [
      "92100000-0000-4000-8000-000000000002",
      localSeedIds.workspaceFunctional,
      qaLocalSeedIds.mapping,
      JSON.stringify(mapping),
      digest(mapping),
      now,
    ],
  );
  await runner.query(
    "INSERT INTO connector_profile_revisions(id,workspace_id,header_id,version,status,content,content_hash,created_at) VALUES($1,$2,$3,1,'PUBLISHED',$4,$5,$6) ON CONFLICT DO NOTHING",
    [
      "92100000-0000-4000-8000-000000000003",
      localSeedIds.workspaceFunctional,
      qaLocalSeedIds.profile,
      JSON.stringify(profile),
      digest(profile),
      now,
    ],
  );
  await runner.query(
    "INSERT INTO project_integration_binding_headers(id,workspace_id,project_id,key,current_published_version) VALUES($1,$2,$3,'qa-request-authority',1) ON CONFLICT DO NOTHING",
    [qaLocalSeedIds.alphaBinding, localSeedIds.workspaceFunctional, localSeedIds.alpha],
  );
  await runner.query(
    "INSERT INTO project_integration_binding_revisions(id,workspace_id,project_id,header_id,version,status,content,content_hash,created_at) VALUES($1,$2,$3,$4,1,'PUBLISHED',$5,$6,$7) ON CONFLICT DO NOTHING",
    [
      "92100000-0000-4000-8000-000000000004",
      localSeedIds.workspaceFunctional,
      localSeedIds.alpha,
      qaLocalSeedIds.alphaBinding,
      JSON.stringify(binding),
      digest(binding),
      now,
    ],
  );
  await runner.query(
    "INSERT INTO connector_profile_revisions(id,workspace_id,header_id,version,status,content,content_hash,created_at) VALUES($1,$2,$3,2,'PUBLISHED',$4,$5,$6) ON CONFLICT DO NOTHING",
    [
      qaLocalSeedIds.profileRevision2,
      localSeedIds.workspaceFunctional,
      qaLocalSeedIds.profile,
      JSON.stringify(profile2),
      digest(profile2),
      now,
    ],
  );
  await runner.query(
    "UPDATE connector_profile_headers SET current_published_version=2 WHERE id=$1 AND current_published_version<2",
    [qaLocalSeedIds.profile],
  );
  await runner.query(
    "UPDATE project_integration_binding_revisions SET status='RETIRED' WHERE workspace_id=$1 AND project_id=$2 AND header_id=$3 AND status='PUBLISHED'",
    [localSeedIds.workspaceFunctional, localSeedIds.alpha, qaLocalSeedIds.alphaBinding],
  );
  await runner.query(
    "INSERT INTO project_integration_binding_revisions(id,workspace_id,project_id,header_id,version,status,content,content_hash,created_at) VALUES($1,$2,$3,$4,2,'PUBLISHED',$5,$6,$7) ON CONFLICT DO NOTHING",
    [
      qaLocalSeedIds.alphaBindingRevision2,
      localSeedIds.workspaceFunctional,
      localSeedIds.alpha,
      qaLocalSeedIds.alphaBinding,
      JSON.stringify(binding2),
      digest(binding2),
      now,
    ],
  );
  await runner.query(
    "UPDATE project_integration_binding_headers SET current_published_version=2 WHERE id=$1 AND current_published_version<2",
    [qaLocalSeedIds.alphaBinding],
  );
  await runner.query(
    "INSERT INTO connector_profile_revisions(id,workspace_id,header_id,version,status,content,content_hash,created_at) VALUES($1,$2,$3,3,'PUBLISHED',$4,$5,$6) ON CONFLICT DO NOTHING",
    [
      qaLocalSeedIds.profileRevision3,
      localSeedIds.workspaceFunctional,
      qaLocalSeedIds.profile,
      JSON.stringify(profile3),
      digest(profile3),
      now,
    ],
  );
  await runner.query(
    "UPDATE connector_profile_headers SET current_published_version=3 WHERE id=$1 AND current_published_version<3",
    [qaLocalSeedIds.profile],
  );
  await runner.query(
    "UPDATE project_integration_binding_revisions SET status='RETIRED' WHERE workspace_id=$1 AND project_id=$2 AND header_id=$3 AND status='PUBLISHED'",
    [localSeedIds.workspaceFunctional, localSeedIds.alpha, qaLocalSeedIds.alphaBinding],
  );
  await runner.query(
    "INSERT INTO project_integration_binding_revisions(id,workspace_id,project_id,header_id,version,status,content,content_hash,created_at) VALUES($1,$2,$3,$4,3,'PUBLISHED',$5,$6,$7) ON CONFLICT DO NOTHING",
    [
      qaLocalSeedIds.alphaBindingRevision3,
      localSeedIds.workspaceFunctional,
      localSeedIds.alpha,
      qaLocalSeedIds.alphaBinding,
      JSON.stringify(binding3),
      digest(binding3),
      now,
    ],
  );
  await runner.query(
    "UPDATE project_integration_binding_headers SET current_published_version=3 WHERE id=$1 AND current_published_version<3",
    [qaLocalSeedIds.alphaBinding],
  );
  await runner.query(
    "INSERT INTO connector_profile_revisions(id,workspace_id,header_id,version,status,content,content_hash,created_at) VALUES($1,$2,$3,4,'PUBLISHED',$4,$5,$6) ON CONFLICT DO NOTHING",
    [
      qaLocalSeedIds.profileRevision4,
      localSeedIds.workspaceFunctional,
      qaLocalSeedIds.profile,
      JSON.stringify(profile4),
      digest(profile4),
      now,
    ],
  );
  await runner.query(
    "UPDATE connector_profile_headers SET current_published_version=4 WHERE id=$1 AND current_published_version<4",
    [qaLocalSeedIds.profile],
  );
  await runner.query(
    "UPDATE project_integration_binding_revisions SET status='RETIRED' WHERE workspace_id=$1 AND project_id=$2 AND header_id=$3 AND status='PUBLISHED'",
    [localSeedIds.workspaceFunctional, localSeedIds.alpha, qaLocalSeedIds.alphaBinding],
  );
  await runner.query(
    "INSERT INTO project_integration_binding_revisions(id,workspace_id,project_id,header_id,version,status,content,content_hash,created_at) VALUES($1,$2,$3,$4,4,'PUBLISHED',$5,$6,$7) ON CONFLICT DO NOTHING",
    [
      qaLocalSeedIds.alphaBindingRevision4,
      localSeedIds.workspaceFunctional,
      localSeedIds.alpha,
      qaLocalSeedIds.alphaBinding,
      JSON.stringify(binding4),
      digest(binding4),
      now,
    ],
  );
  await runner.query(
    "UPDATE project_integration_binding_headers SET current_published_version=4 WHERE id=$1 AND current_published_version<4",
    [qaLocalSeedIds.alphaBinding],
  );
  for (const [ordinal, subject] of [
    [1, ["CONNECTION", qaLocalSeedIds.connection, digest(connection)]],
    [2, ["MAPPING", qaLocalSeedIds.mapping, digest(mapping)]],
    [3, ["PROFILE", qaLocalSeedIds.profile, digest(profile)]],
    [4, ["BINDING", qaLocalSeedIds.alphaBinding, digest(binding)]],
  ] as const)
    await runner.query(
      "INSERT INTO integration_validation_reports(id,workspace_id,project_id,subject_kind,subject_id,subject_version,outcome,content_hash,report,created_at) VALUES($1,$2,$3,$4,$5,1,'VALID',$6,$7,$8) ON CONFLICT DO NOTHING",
      [
        `92200000-0000-4000-8000-${ordinal.toString().padStart(12, "0")}`,
        localSeedIds.workspaceFunctional,
        subject[0] === "BINDING" ? localSeedIds.alpha : null,
        subject[0],
        subject[1],
        subject[2],
        JSON.stringify({ checks: [{ key: "qa-us1-create-only", outcome: "PASS" }] }),
        now,
      ],
    );
  await runner.query(
    "INSERT INTO integration_validation_reports(id,workspace_id,project_id,subject_kind,subject_id,subject_version,outcome,content_hash,report,created_at) VALUES($1,$2,$3,'PROFILE',$4,2,'VALID',$5,$6,$7) ON CONFLICT DO NOTHING",
    [
      "92200000-0000-4000-8000-000000000013",
      localSeedIds.workspaceFunctional,
      null,
      qaLocalSeedIds.profile,
      digest(profile2),
      JSON.stringify({ checks: [{ key: "qa-us2-ready-transition", outcome: "PASS" }] }),
      now,
    ],
  );
  await runner.query(
    "INSERT INTO integration_validation_reports(id,workspace_id,project_id,subject_kind,subject_id,subject_version,outcome,content_hash,report,created_at) VALUES($1,$2,$3,'BINDING',$4,2,'VALID',$5,$6,$7) ON CONFLICT DO NOTHING",
    [
      "92200000-0000-4000-8000-000000000014",
      localSeedIds.workspaceFunctional,
      localSeedIds.alpha,
      qaLocalSeedIds.alphaBinding,
      digest(binding2),
      JSON.stringify({ checks: [{ key: "qa-us2-ready-transition", outcome: "PASS" }] }),
      now,
    ],
  );
  await runner.query(
    "INSERT INTO integration_validation_reports(id,workspace_id,project_id,subject_kind,subject_id,subject_version,outcome,content_hash,report,created_at) VALUES($1,$2,$3,'PROFILE',$4,3,'VALID',$5,$6,$7) ON CONFLICT DO NOTHING",
    [
      "92200000-0000-4000-8000-000000000023",
      localSeedIds.workspaceFunctional,
      null,
      qaLocalSeedIds.profile,
      digest(profile3),
      JSON.stringify({ checks: [{ key: "qa-us4-defect-create", outcome: "PASS" }] }),
      now,
    ],
  );
  await runner.query(
    "INSERT INTO integration_validation_reports(id,workspace_id,project_id,subject_kind,subject_id,subject_version,outcome,content_hash,report,created_at) VALUES($1,$2,$3,'BINDING',$4,3,'VALID',$5,$6,$7) ON CONFLICT DO NOTHING",
    [
      "92200000-0000-4000-8000-000000000024",
      localSeedIds.workspaceFunctional,
      localSeedIds.alpha,
      qaLocalSeedIds.alphaBinding,
      digest(binding3),
      JSON.stringify({ checks: [{ key: "qa-us4-defect-destination", outcome: "PASS" }] }),
      now,
    ],
  );
  await runner.query(
    "INSERT INTO integration_validation_reports(id,workspace_id,project_id,subject_kind,subject_id,subject_version,outcome,content_hash,report,created_at) VALUES($1,$2,$3,'PROFILE',$4,4,'VALID',$5,$6,$7) ON CONFLICT DO NOTHING",
    [
      "92200000-0000-4000-8000-000000000033",
      localSeedIds.workspaceFunctional,
      null,
      qaLocalSeedIds.profile,
      digest(profile4),
      JSON.stringify({ checks: [{ key: "qa-us5-done-summary", outcome: "PASS" }] }),
      now,
    ],
  );
  await runner.query(
    "INSERT INTO integration_validation_reports(id,workspace_id,project_id,subject_kind,subject_id,subject_version,outcome,content_hash,report,created_at) VALUES($1,$2,$3,'BINDING',$4,4,'VALID',$5,$6,$7) ON CONFLICT DO NOTHING",
    [
      "92200000-0000-4000-8000-000000000034",
      localSeedIds.workspaceFunctional,
      localSeedIds.alpha,
      qaLocalSeedIds.alphaBinding,
      digest(binding4),
      JSON.stringify({ checks: [{ key: "qa-us5-done-summary", outcome: "PASS" }] }),
      now,
    ],
  );
}

async function seedQaPolicies(runner: QueryRunner): Promise<void> {
  const publishedAt = "2026-08-30T00:00:00.000Z";
  const risk = publishQaRiskReviewPolicy({
    policyId: qaLocalSeedIds.riskPolicy,
    version: 1,
    scope: { workspaceId: localSeedIds.workspaceFunctional, projectId: localSeedIds.alpha },
    actor,
    publishedAt,
  });
  const targetPolicy = exactRef("target-policy", "qa-local-non-prod", "1");
  const scopePolicy = exactRef("scope-policy", "qa-local-manual", "1");
  const checklist = exactRef("checklist-policy", "qa-local-manual-smoke", "1");
  const context = publishQaProjectContext({
    contextId: qaLocalSeedIds.context,
    version: 1,
    workspaceId: localSeedIds.workspaceFunctional,
    projectId: localSeedIds.alpha,
    allowedEnvironments: [
      { environmentId: qaLocalSeedIds.environment, revision: 1, scope: "LOCAL" },
    ],
    allowedResponseChannelKinds: ["PLATFORM_WEB"],
    requestAuthorityRequirementKey: "qa-request-authority",
    defectDestinationRequirementKey: "defect-destination",
    allowedTargetPolicyRefs: [targetPolicy],
    allowedScopePolicyRefs: [scopePolicy],
    allowedChecklistPolicyRefs: [checklist],
    defaultTargetPolicyRef: targetPolicy,
    defaultScopePolicyRef: scopePolicy,
    defaultChecklistRefs: [checklist],
    projectRisk: "MEDIUM",
    maximumClassificationKey: "INTERNAL",
    dorRuleSetRef: {
      key: "qa.dor",
      version: "1.0.0",
      contentHash: digest({ key: "qa.dor", version: "1.0.0" }),
    },
    dodRuleSetRef: {
      key: "qa.dod",
      version: "1.0.0",
      contentHash: digest({ key: "qa.dod", version: "1.0.0" }),
    },
    evidencePolicyRef: {
      key: "qa.evidence",
      version: "1.0.0",
      contentHash: digest({ key: "qa.evidence", version: "1.0.0" }),
    },
    riskReviewPolicyRef: {
      id: risk.policyId,
      version: risk.version,
      contentHash: risk.contentHash,
    },
    createdBy: actor,
    publishedBy: actor,
    publishedAt,
  });
  await runner.query(
    "INSERT INTO qa_risk_review_policies(id,workspace_id,project_id,resource_version) VALUES($1,$2,$3,1) ON CONFLICT DO NOTHING",
    [risk.policyId, risk.workspaceId, risk.projectId],
  );
  await runner.query(
    "INSERT INTO qa_risk_review_policy_versions(id,workspace_id,project_id,header_id,version,content_hash,content,published_by,published_at) VALUES($1,$2,$3,$4,1,$5,$6,$7,$8) ON CONFLICT DO NOTHING",
    [
      qaLocalSeedIds.riskPolicyVersion,
      risk.workspaceId,
      risk.projectId,
      risk.policyId,
      risk.contentHash,
      JSON.stringify(risk),
      JSON.stringify(actor),
      publishedAt,
    ],
  );
  await runner.query(
    "UPDATE qa_risk_review_policies SET current_published_version_id=$1,current_published_version=1,current_published_content_hash=$2,resource_version=2 WHERE id=$3 AND current_published_version_id IS NULL",
    [qaLocalSeedIds.riskPolicyVersion, risk.contentHash, risk.policyId],
  );
  await runner.query(
    "INSERT INTO qa_project_contexts(id,workspace_id,project_id,resource_version) VALUES($1,$2,$3,1) ON CONFLICT DO NOTHING",
    [context.contextId, context.workspaceId, context.projectId],
  );
  await runner.query(
    "INSERT INTO qa_project_context_versions(id,workspace_id,project_id,header_id,version,content_hash,content,published_by,published_at) VALUES($1,$2,$3,$4,1,$5,$6,$7,$8) ON CONFLICT DO NOTHING",
    [
      qaLocalSeedIds.contextVersion,
      context.workspaceId,
      context.projectId,
      context.contextId,
      context.contentHash,
      JSON.stringify(context),
      JSON.stringify(actor),
      publishedAt,
    ],
  );
  await runner.query(
    "UPDATE qa_project_contexts SET current_published_version_id=$1,current_published_version=1,current_published_content_hash=$2,resource_version=2 WHERE id=$3 AND current_published_version_id IS NULL",
    [qaLocalSeedIds.contextVersion, context.contentHash, context.contextId],
  );
}

async function ensureQaLeadPersona(runner: QueryRunner): Promise<void> {
  const persona = localPersonaCatalog.resolve("lead.alpha");
  const principalId = localPersonaIds["lead.alpha"];
  const existing = (await runner.query("SELECT id FROM identities WHERE issuer=$1 AND subject=$2", [
    "https://fake-idp:4443/oidc",
    persona.subject,
  ])) as readonly { id: string }[];
  if (existing[0]) {
    if (existing[0].id !== principalId) throw new Error("QA_LOCAL_LEAD_IDENTITY_CONFLICT");
    return;
  }
  await runner.query(
    "INSERT INTO identities(id,issuer,subject,kind,display_name) VALUES($1,$2,$3,'HUMAN',$4)",
    [principalId, "https://fake-idp:4443/oidc", persona.subject, persona.label],
  );
  await runner.query(
    "INSERT INTO workspace_memberships(id,workspace_id,principal_id,state,valid_from) VALUES($1,$2,$3,'ACTIVE','2026-01-01T00:00:00Z')",
    [qaLocalSeedIds.leadMembership, localSeedIds.workspaceFunctional, principalId],
  );
  await runner.query(
    "INSERT INTO role_assignments(id,workspace_id,project_id,principal_id,role_key,effect,permissions,valid_from) VALUES($1,$2,$3,$4,'qa-lead','ALLOW',$5,'2026-01-01T00:00:00Z')",
    [
      qaLocalSeedIds.leadRole,
      localSeedIds.workspaceFunctional,
      localSeedIds.alpha,
      principalId,
      JSON.stringify(persona.permissions),
    ],
  );
  await runner.query(
    "INSERT INTO project_entitlements(id,workspace_id,project_id,principal_id,effect,classification_ceiling_key,permissions,valid_from) VALUES($1,$2,$3,$4,'ALLOW',$5,$6,'2026-01-01T00:00:00Z')",
    [
      qaLocalSeedIds.leadEntitlement,
      localSeedIds.workspaceFunctional,
      localSeedIds.alpha,
      principalId,
      persona.classificationCeiling,
      JSON.stringify(persona.permissions),
    ],
  );
  for (const permission of persona.permissions)
    await runner.query(
      "INSERT INTO project_entitlement_permissions(entitlement_id,permission_key) VALUES($1,$2)",
      [qaLocalSeedIds.leadEntitlement, permission],
    );
}

export async function runQaLocalSeed(dataSource: DataSource): Promise<QaLocalSeedResult> {
  await runLocalSeed(dataSource);
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await runner.query(
      "CREATE TABLE IF NOT EXISTS local_seed_markers(key text PRIMARY KEY, version integer NOT NULL, applied_at timestamptz NOT NULL)",
    );
    await ensureQaLeadPersona(runner);
    const marker = (await runner.query(
      "SELECT version FROM local_seed_markers WHERE key=$1 FOR UPDATE",
      [QA_LOCAL_SEED_KEY],
    )) as readonly { version: number }[];
    if (Number(marker[0]?.version) === QA_LOCAL_SEED_VERSION) {
      await runner.commitTransaction();
      return "unchanged";
    }
    if (marker[0] && marker[0].version > QA_LOCAL_SEED_VERSION)
      throw new Error("QA_LOCAL_SEED_VERSION_AHEAD");
    await seedExtensionRegistry(runner);
    await seedIntegration(runner);
    await seedQaPolicies(runner);
    await runner.query(
      "INSERT INTO local_seed_markers(key,version,applied_at) VALUES($1,$2,clock_timestamp()) ON CONFLICT(key) DO UPDATE SET version=EXCLUDED.version,applied_at=EXCLUDED.applied_at",
      [QA_LOCAL_SEED_KEY, QA_LOCAL_SEED_VERSION],
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
