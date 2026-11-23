import { createHash, randomUUID } from "node:crypto";

import type { DataSource, QueryRunner } from "typeorm";

import { dummyManifest } from "@awp/competency-dummy";
import {
  createProjectEntitlementRevision,
  type ProjectEntitlementRevision,
} from "@awp/platform-core";
import { ProjectEntitlementRepository } from "@awp/platform-persistence-typeorm";

import { sampleRecordCapabilityContract } from "../extensions/composition.ts";
import { localPersonaCatalog } from "../security/local-security.ts";

export const LOCAL_SEED_KEY = "001-local-walking-skeleton";
export const LOCAL_SEED_VERSION = 5;
export type LocalSeedResult = "applied" | "unchanged";

const ids = Object.freeze({
  workspaceFunctional: "10000000-0000-4000-8000-000000000001",
  workspaceIsolated: "10000000-0000-4000-8000-000000000002",
  alpha: "20000000-0000-4000-8000-000000000001",
  beta: "20000000-0000-4000-8000-000000000002",
  gamma: "20000000-0000-4000-8000-000000000003",
  delta: "20000000-0000-4000-8000-000000000004",
  pack: "70000000-0000-4000-8000-000000000001",
  workType: "70000000-0000-4000-8000-000000000002",
  workspaceWorkType: "70000000-0000-4000-8000-000000000003",
  connector: "71000000-0000-4000-8000-000000000001",
  capability: "71000000-0000-4000-8000-000000000002",
  connection: "72000000-0000-4000-8000-000000000001",
  mapping: "72000000-0000-4000-8000-000000000002",
  profile: "72000000-0000-4000-8000-000000000003",
  alphaBinding: "72000000-0000-4000-8000-000000000004",
  betaBinding: "72000000-0000-4000-8000-000000000005",
  workItem: "80000000-0000-4000-8000-000000000001",
  dummyRequest: "80000000-0000-4000-8000-000000000002",
  pendingApproval: "81000000-0000-4000-8000-000000000001",
  invalidatedApproval: "81000000-0000-4000-8000-000000000002",
  platformAction: "81000000-0000-4000-8000-000000000003",
  command: "82000000-0000-4000-8000-000000000001",
});

const personaIds = Object.freeze({
  "owner.local": "30000000-0000-4000-8000-000000000001",
  "integration-admin.alpha": "30000000-0000-4000-8000-000000000002",
  "requester.alpha": "30000000-0000-4000-8000-000000000003",
  "limited.alpha": "30000000-0000-4000-8000-000000000004",
  "executor.alpha": "30000000-0000-4000-8000-000000000005",
  "viewer.beta": "30000000-0000-4000-8000-000000000006",
  "executor.qa2": "30000000-0000-4000-8000-000000000011",
  "worker.local": "30000000-0000-4000-8000-000000000008",
  "outsider.delta": "30000000-0000-4000-8000-000000000009",
  "lead.alpha": "30000000-0000-4000-8000-000000000010",
} as const);

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

const retiredAuditorId = "30000000-0000-4000-8000-000000000007";
const seedActor = {
  kind: "HUMAN" as const,
  principalId: personaIds["owner.local"],
  roleKey: "system-administrator",
  authenticationContextRef: {
    id: "local-seed-bootstrap",
    version: 1,
    contentHash: digest("local-seed-bootstrap") as `sha256:${string}`,
  },
  authorizationBasisRef: {
    id: "local-team-seed",
    version: LOCAL_SEED_VERSION,
    contentHash: digest(`local-team-seed@${LOCAL_SEED_VERSION}`) as `sha256:${string}`,
  },
};

async function reviseSeedEntitlement(
  source: DataSource,
  runner: QueryRunner,
  input: Omit<
    ProjectEntitlementRevision,
    "version" | "contentHash" | "revisionId" | "actor" | "correlationId" | "createdAt"
  >,
): Promise<void> {
  const [previous] = (await runner.query(
    "SELECT r.revision_id,r.version,r.content_hash FROM project_entitlement_headers h JOIN project_entitlement_revisions r ON r.entitlement_id=h.entitlement_id AND r.version=h.current_version WHERE h.entitlement_id=$1",
    [input.entitlementId],
  )) as { revision_id: string; version: number; content_hash: `sha256:${string}` }[];
  // Old post-migration local seeds have an unversioned live projection only.
  if (!previous) {
    await runner.query("DELETE FROM project_entitlement_permissions WHERE entitlement_id=$1", [
      input.entitlementId,
    ]);
    await runner.query("DELETE FROM project_entitlements WHERE id=$1", [input.entitlementId]);
  }
  const revision = createProjectEntitlementRevision({
    ...input,
    operation: input.operation === "REVOKE" ? "REVOKE" : previous ? "REPLACE" : "GRANT",
    version: previous ? previous.version + 1 : 1,
    ...(previous
      ? {
          previousRevisionRef: {
            id: previous.revision_id,
            version: previous.version,
            contentHash: previous.content_hash,
          },
        }
      : {}),
    revisionId: randomUUID(),
    actor: seedActor,
    correlationId: randomUUID(),
    createdAt: new Date().toISOString(),
  });
  await new ProjectEntitlementRepository(source).appendInTransaction(runner.manager, revision);
}

async function retireLocalPrincipals(source: DataSource, runner: QueryRunner): Promise<void> {
  const retiredIds = [retiredAuditorId, personaIds["limited.alpha"], personaIds["outsider.delta"]];
  const entitlements = (await runner.query(
    "SELECT * FROM project_entitlements WHERE principal_id=ANY($1) AND revoked_at IS NULL",
    [retiredIds],
  )) as {
    id: string;
    workspace_id: string;
    project_id: string;
    permissions: string[];
    classification_ceiling_key: string;
    principal_id: string;
    valid_from: Date;
    valid_until: Date | null;
    effect: "ALLOW" | "DENY";
  }[];
  for (const grant of entitlements) {
    await reviseSeedEntitlement(source, runner, {
      entitlementId: grant.id,
      workspaceId: grant.workspace_id,
      projectId: grant.project_id,
      principalId: grant.principal_id,
      operation: "REVOKE",
      effect: grant.effect,
      permissions: grant.permissions,
      classificationCeilingKey: grant.classification_ceiling_key,
      validFrom: grant.valid_from.toISOString(),
      ...(grant.valid_until ? { validUntil: grant.valid_until.toISOString() } : {}),
      revokedAt: new Date().toISOString(),
      reason:
        grant.principal_id === retiredAuditorId
          ? "Retire removed local auditor role"
          : "Retire diagnostic local account",
    });
  }
  await runner.query(
    "DELETE FROM role_assignments WHERE principal_id=ANY($1) OR role_key IN ('auditor','security-auditor')",
    [retiredIds],
  );
  await runner.query("DELETE FROM workspace_memberships WHERE principal_id=ANY($1)", [retiredIds]);
  // Identity is an historical attribution anchor; catalog/IdP reject it permanently.
}

async function seedSharedTeam(source: DataSource, runner: QueryRunner): Promise<void> {
  const projects = (await runner.query(
    "SELECT id FROM projects WHERE workspace_id=$1 AND state<>'ARCHIVED'",
    [ids.workspaceFunctional],
  )) as { id: string }[];
  for (const option of localPersonaCatalog.seedOptions().filter(({ key }) => key in personaIds)) {
    const persona = localPersonaCatalog.resolve(option.key);
    if (!persona.sharedTeam || persona.kind !== "HUMAN") continue;
    const principalId = personaIds[option.key as keyof typeof personaIds];
    for (const project of projects) {
      const existing = (await runner.query(
        "SELECT id,revoked_at FROM project_entitlements WHERE workspace_id=$1 AND project_id=$2 AND principal_id=$3 AND effect='ALLOW' ORDER BY id",
        [ids.workspaceFunctional, project.id, principalId],
      )) as { id: string; revoked_at: Date | null }[];
      // Do not silently re-enable grants explicitly revoked by an administrator.
      if (existing.some((grant) => grant.revoked_at)) continue;
      const grants = existing.length ? existing : [{ id: randomUUID() }];
      for (const grant of grants)
        await reviseSeedEntitlement(source, runner, {
          entitlementId: grant.id,
          workspaceId: ids.workspaceFunctional,
          projectId: project.id,
          principalId,
          operation: "GRANT",
          effect: "ALLOW",
          permissions: persona.permissions,
          classificationCeilingKey: persona.classificationCeiling,
          validFrom: "2026-01-01T00:00:00Z",
          reason: "Shared functional team across workspace projects",
        });
    }
  }
}

async function seedIdentityAndScope(runner: QueryRunner): Promise<void> {
  const issuer = "https://fake-idp:4443/oidc";
  for (const option of localPersonaCatalog.seedOptions().filter(({ key }) => key in personaIds)) {
    const persona = localPersonaCatalog.resolve(option.key);
    const principalId = personaIds[option.key as keyof typeof personaIds];
    await runner.query(
      "INSERT INTO identities(id,issuer,subject,kind,display_name) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET display_name=EXCLUDED.display_name",
      [principalId, issuer, persona.subject, persona.kind, persona.label],
    );
  }
  await runner.query(
    "INSERT INTO workspaces(id,key,name,state) VALUES($1,'local-functional','Local Functional','ACTIVE'),($2,'local-isolated','Local Isolated','ACTIVE') ON CONFLICT DO NOTHING",
    [ids.workspaceFunctional, ids.workspaceIsolated],
  );
  const projects = [
    [ids.alpha, ids.workspaceFunctional, "ALPHA", "Alpha", "ACTIVE", "INTERNAL"],
    [ids.beta, ids.workspaceFunctional, "BETA", "Beta", "ACTIVE", "RESTRICTED"],
    [ids.gamma, ids.workspaceFunctional, "GAMMA", "Gamma", "SUSPENDED", "INTERNAL"],
    [ids.delta, ids.workspaceIsolated, "DELTA", "Delta", "ACTIVE", "INTERNAL"],
  ] as const;
  for (const project of projects) {
    await runner.query(
      "INSERT INTO projects(id,workspace_id,key,name,state,classification_key) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING",
      project,
    );
  }
  // Stable legacy assignment IDs must not depend on catalog order.
  const ordinals: Readonly<Record<string, number>> = {
    "owner.local": 1,
    "integration-admin.alpha": 2,
    "requester.alpha": 3,
    "limited.alpha": 4,
    "executor.alpha": 5,
    "lead.alpha": 6,
    "viewer.beta": 7,
    "worker.local": 9,
    "outsider.delta": 10,
    "executor.qa2": 11,
  };
  for (const option of localPersonaCatalog.seedOptions().filter(({ key }) => key in personaIds)) {
    const persona = localPersonaCatalog.resolve(option.key);
    const principalId = personaIds[option.key as keyof typeof personaIds];
    const workspaceId =
      persona.workspaceKey === "local-functional" ? ids.workspaceFunctional : ids.workspaceIsolated;
    const projectId =
      persona.projectKey === "ALPHA"
        ? ids.alpha
        : persona.projectKey === "BETA"
          ? ids.beta
          : persona.projectKey === "DELTA"
            ? ids.delta
            : null;
    const ordinal = ordinals[option.key]!;
    const memberId = `40000000-0000-4000-8000-${ordinal.toString().padStart(12, "0")}`;
    const roleId = `50000000-0000-4000-8000-${ordinal.toString().padStart(12, "0")}`;
    const entitlementId = `60000000-0000-4000-8000-${ordinal.toString().padStart(12, "0")}`;
    await runner.query(
      "INSERT INTO workspace_memberships(id,workspace_id,principal_id,state,valid_from) VALUES($1,$2,$3,'ACTIVE','2026-01-01T00:00:00Z') ON CONFLICT DO NOTHING",
      [memberId, workspaceId, principalId],
    );
    await runner.query(
      "INSERT INTO role_assignments(id,workspace_id,project_id,principal_id,role_key,effect,permissions,valid_from,project_access_scope,classification_ceiling_key) VALUES($1,$2,$3,$4,$5,'ALLOW',$6,'2026-01-01T00:00:00Z',$7,$8) ON CONFLICT(id) DO UPDATE SET project_id=EXCLUDED.project_id,role_key=EXCLUDED.role_key,permissions=EXCLUDED.permissions,project_access_scope=EXCLUDED.project_access_scope,classification_ceiling_key=EXCLUDED.classification_ceiling_key,row_version=role_assignments.row_version+1",
      [
        roleId,
        workspaceId,
        persona.sharedTeam ? null : projectId,
        principalId,
        persona.roles[0],
        JSON.stringify(persona.permissions),
        persona.sharedTeam ? "ALL_PROJECTS" : "SELECTED_PROJECTS",
        persona.classificationCeiling,
      ],
    );
    if (projectId) {
      await runner.query(
        "INSERT INTO project_entitlements(id,workspace_id,project_id,principal_id,effect,classification_ceiling_key,permissions,valid_from) VALUES($1,$2,$3,$4,'ALLOW',$5,$6,'2026-01-01T00:00:00Z') ON CONFLICT(id) DO UPDATE SET classification_ceiling_key=EXCLUDED.classification_ceiling_key,permissions=EXCLUDED.permissions",
        [
          entitlementId,
          workspaceId,
          projectId,
          principalId,
          persona.classificationCeiling,
          JSON.stringify(persona.permissions),
        ],
      );
      for (const permission of persona.permissions)
        await runner.query(
          "INSERT INTO project_entitlement_permissions(entitlement_id,permission_key) VALUES($1,$2) ON CONFLICT DO NOTHING",
          [entitlementId, permission],
        );
    }
    if (persona.roles.includes("requester"))
      await runner.query(
        `INSERT INTO role_assignments(id,workspace_id,principal_id,role_key,effect,permissions,valid_from,classification_ceiling_key)
         VALUES('50000000-0000-4000-8000-000000000103',$1,$2,'requester','ALLOW','["project.request.create"]',clock_timestamp(),$3)
         ON CONFLICT(id) DO NOTHING`,
        [workspaceId, principalId, persona.classificationCeiling],
      );
  }
  await runner.query(
    "INSERT INTO role_assignments(id,workspace_id,principal_id,role_key,effect,permissions,valid_from) VALUES('50000000-0000-4000-8000-000000000099',$1,$2,'system-administrator','ALLOW',$3,'2026-01-01T00:00:00Z') ON CONFLICT(id) DO NOTHING",
    [ids.workspaceFunctional, personaIds["owner.local"], JSON.stringify(["project.register"])],
  );
}

async function seedExtensions(runner: QueryRunner): Promise<void> {
  const now = "2026-01-01T00:00:00Z";
  await runner.query(
    "INSERT INTO competency_pack_registrations(id,pack_key,pack_version,manifest_schema_version,required_core_contract_range,manifest_payload,manifest_hash,registration_status,registered_at) VALUES($1,'dummy','1.0.0',1,'>=1.0.0 <2.0.0',$2,$3,'REGISTERED',$4) ON CONFLICT DO NOTHING",
    [ids.pack, JSON.stringify(dummyManifest), digest(dummyManifest), now],
  );
  await runner.query(
    "INSERT INTO work_type_definitions(id,pack_registration_id,work_type_key,definition_version,intake_schema,intake_schema_hash,required_capabilities,definition_payload,definition_hash,lifecycle_status,registered_at) VALUES($1,$2,'dummy.request','1.0.0',$3,$4,$5,$6,$7,'ACTIVE',$8) ON CONFLICT DO NOTHING",
    [
      ids.workType,
      ids.pack,
      JSON.stringify(dummyManifest.workTypes[0].intakeSchemaRef),
      dummyManifest.workTypes[0].intakeSchemaRef.digest,
      JSON.stringify(dummyManifest.workTypes[0].capabilityRequirements),
      JSON.stringify(dummyManifest.workTypes[0]),
      digest(dummyManifest.workTypes[0]),
      now,
    ],
  );
  await runner.query(
    "INSERT INTO workspace_work_types(id,workspace_id,work_type_key,active_definition_id,intake_state,changed_by,changed_at,reason) VALUES($1,$2,'dummy.request',$3,'ENABLED',$4,$5,'local seed') ON CONFLICT DO NOTHING",
    [ids.workspaceWorkType, ids.workspaceFunctional, ids.workType, personaIds["owner.local"], now],
  );
  const connectorManifest = {
    key: "sample.mock",
    version: "1.0.0",
    displayName: "Mock Connector",
    environmentScope: "LOCAL",
  };
  await runner.query(
    "INSERT INTO connector_registrations(id,connector_key,connector_version,manifest_payload,manifest_hash,registration_status,registered_at) VALUES($1,'sample.mock','1.0.0',$2,$3,'REGISTERED',$4) ON CONFLICT DO NOTHING",
    [ids.connector, JSON.stringify(connectorManifest), digest(connectorManifest), now],
  );
  await runner.query(
    "INSERT INTO capability_contracts(id,capability_key,contract_version,contract_payload,schema_hash,lifecycle_status,registered_at) VALUES($1,'sample.record','1.0.0',$2,$3,'ACTIVE',$4) ON CONFLICT DO NOTHING",
    [
      ids.capability,
      JSON.stringify(sampleRecordCapabilityContract),
      digest(sampleRecordCapabilityContract),
      now,
    ],
  );
  await runner.query(
    "INSERT INTO connector_capability_implementations(connector_registration_id,capability_key,exact_contract_version,operation,handler_component_ref,supported_idempotency_strategies,supported_confirmation_modes) VALUES($1,'sample.record','1.0.0','record.publish','mock.sample-record',$2,$3) ON CONFLICT DO NOTHING",
    [ids.connector, JSON.stringify(["NATIVE_KEY"]), JSON.stringify(["SYNC_RECEIPT", "READ_BACK"])],
  );
}

async function seedConfiguration(runner: QueryRunner): Promise<void> {
  const now = "2026-01-01T00:00:00Z";
  const configurations = [
    ["connection_headers", ids.connection, ids.workspaceFunctional, "sample-local"],
    ["connector_mapping_headers", ids.mapping, ids.workspaceFunctional, "sample-record-default"],
    ["connector_profile_headers", ids.profile, ids.workspaceFunctional, "sample-local-profile"],
  ] as const;
  for (const [table, id, workspaceId, key] of configurations)
    await runner.query(
      `INSERT INTO ${table}(id,workspace_id,key,current_published_version) VALUES($1,$2,$3,1) ON CONFLICT DO NOTHING`,
      [id, workspaceId, key],
    );
  const connection = {
    endpoint: "http://mock-hub:4010",
    environmentScope: "LOCAL",
    credentialRef: "secret://local/mock-hub",
  };
  const mapping = {
    capabilityKey: "sample.record",
    connectorKey: "sample.mock",
    fields: { recordKey: "target.id", message: "payload.message" },
  };
  const profile = {
    connectorKey: "sample.mock",
    connectionRef: { id: ids.connection, version: 1 },
    mappingRef: { id: ids.mapping, version: 1 },
    mappingContentHash: digest(mapping),
    classificationAllowlist: ["PUBLIC", "INTERNAL"],
  };
  await runner.query(
    "INSERT INTO connection_revisions(id,workspace_id,header_id,version,status,content,content_hash,created_at) VALUES($1,$2,$3,1,'PUBLISHED',$4,$5,$6) ON CONFLICT DO NOTHING",
    [
      "72100000-0000-4000-8000-000000000001",
      ids.workspaceFunctional,
      ids.connection,
      JSON.stringify(connection),
      digest(connection),
      now,
    ],
  );
  await runner.query(
    "INSERT INTO connector_mapping_revisions(id,workspace_id,header_id,version,status,content,content_hash,created_at) VALUES($1,$2,$3,1,'PUBLISHED',$4,$5,$6) ON CONFLICT DO NOTHING",
    [
      "72100000-0000-4000-8000-000000000002",
      ids.workspaceFunctional,
      ids.mapping,
      JSON.stringify(mapping),
      digest(mapping),
      now,
    ],
  );
  await runner.query(
    "INSERT INTO connector_profile_revisions(id,workspace_id,header_id,version,status,content,content_hash,created_at) VALUES($1,$2,$3,1,'PUBLISHED',$4,$5,$6) ON CONFLICT DO NOTHING",
    [
      "72100000-0000-4000-8000-000000000003",
      ids.workspaceFunctional,
      ids.profile,
      JSON.stringify(profile),
      digest(profile),
      now,
    ],
  );
  await runner.query(
    "INSERT INTO project_integration_binding_headers(id,workspace_id,project_id,key,current_published_version) VALUES($1,$2,$3,'sample-primary',1),($4,$2,$5,'sample-invalid',NULL) ON CONFLICT DO NOTHING",
    [ids.alphaBinding, ids.workspaceFunctional, ids.alpha, ids.betaBinding, ids.beta],
  );
  const bindingV1 = {
    profileRef: { id: ids.profile, version: 1 },
    capabilityKey: "sample.record",
    logicalRole: "PRIMARY",
  };
  const bindingV2 = { ...bindingV1, note: "draft-v2" };
  const betaInvalid = { capabilityKey: "missing.required", logicalRole: "PRIMARY" };
  await runner.query(
    "INSERT INTO project_integration_binding_revisions(id,workspace_id,project_id,header_id,version,status,content,content_hash,created_at) VALUES($1,$2,$3,$4,1,'PUBLISHED',$5,$6,$7),($8,$2,$3,$4,2,'DRAFT',$9,$10,$7),($11,$2,$12,$13,1,'DRAFT',$14,$15,$7) ON CONFLICT DO NOTHING",
    [
      "72100000-0000-4000-8000-000000000004",
      ids.workspaceFunctional,
      ids.alpha,
      ids.alphaBinding,
      JSON.stringify(bindingV1),
      digest(bindingV1),
      now,
      "72100000-0000-4000-8000-000000000005",
      JSON.stringify(bindingV2),
      digest(bindingV2),
      "72100000-0000-4000-8000-000000000006",
      ids.beta,
      ids.betaBinding,
      JSON.stringify(betaInvalid),
      digest(betaInvalid),
    ],
  );
  const reports = [
    [ids.connection, "CONNECTION", digest(connection)],
    [ids.mapping, "MAPPING", digest(mapping)],
    [ids.profile, "PROFILE", digest(profile)],
    [ids.alphaBinding, "BINDING", digest(bindingV1)],
  ] as const;
  let ordinal = 1;
  for (const [subjectId, kind, contentHash] of reports) {
    await runner.query(
      "INSERT INTO integration_validation_reports(id,workspace_id,project_id,subject_kind,subject_id,subject_version,outcome,content_hash,report,created_at) VALUES($1,$2,$3,$4,$5,1,'VALID',$6,$7,$8) ON CONFLICT DO NOTHING",
      [
        `73000000-0000-4000-8000-${ordinal.toString().padStart(12, "0")}`,
        ids.workspaceFunctional,
        kind === "BINDING" ? ids.alpha : null,
        kind,
        subjectId,
        contentHash,
        JSON.stringify({ checks: [{ key: "local-endpoint", outcome: "PASS" }] }),
        now,
      ],
    );
    ordinal += 1;
  }
}

async function seedControl(runner: QueryRunner): Promise<void> {
  const now = "2026-01-01T00:00:00Z";
  const requester = personaIds["requester.alpha"];
  const owner = personaIds["owner.local"];
  await runner.query(
    "INSERT INTO work_items(id,workspace_id,project_id,work_type_definition_id,created_by,state,classification_key,created_at) VALUES($1,$2,$3,$4,$5,'OPEN','INTERNAL',$6) ON CONFLICT DO NOTHING",
    [ids.workItem, ids.workspaceFunctional, ids.alpha, ids.workType, requester, now],
  );
  await runner.query(
    "INSERT INTO dummy_requests(id,workspace_id,project_id,work_item_id,sample_name,message,history,created_at) VALUES($1,$2,$3,$4,'Historical request','Readable after intake disable','[]',$5) ON CONFLICT DO NOTHING",
    [ids.dummyRequest, ids.workspaceFunctional, ids.alpha, ids.workItem, now],
  );
  const approvalSubject = {
    actionKind: "EXTERNAL_COMMAND",
    actionId: ids.command,
    capabilityKey: "sample.record",
    capabilityVersion: "1.0.0",
    operation: "record.publish",
  };
  await runner.query(
    "INSERT INTO approvals(id,workspace_id,project_id,action_kind,action_id,subject,subject_hash,decision_state,effect_authorization_state,initiator_id,approver_id,expires_at,created_at) VALUES($1,$2,$3,'EXTERNAL_COMMAND',$4,$5,$6,'PENDING','PENDING',$7,NULL,'2027-01-01',$8),($9,$2,$3,'PLATFORM_ACTION',$10,$11,$12,'APPROVED','INVALIDATED',$7,$13,'2027-01-01',$8) ON CONFLICT DO NOTHING",
    [
      ids.pendingApproval,
      ids.workspaceFunctional,
      ids.alpha,
      ids.command,
      JSON.stringify(approvalSubject),
      digest(approvalSubject),
      requester,
      now,
      ids.invalidatedApproval,
      ids.platformAction,
      JSON.stringify({ actionKind: "BINDING_PUBLICATION", actionId: ids.platformAction }),
      digest({ actionKind: "BINDING_PUBLICATION", actionId: ids.platformAction }),
      owner,
    ],
  );
  await runner.query(
    "INSERT INTO platform_actions(id,workspace_id,project_id,action_kind,candidate_ref,candidate_hash,state,result,created_at) VALUES($1,$2,$3,'BINDING_PUBLICATION',$4,$5,'COMPLETED',$6,$7) ON CONFLICT DO NOTHING",
    [
      ids.platformAction,
      ids.workspaceFunctional,
      ids.alpha,
      JSON.stringify({ id: ids.alphaBinding, version: 1 }),
      digest({ id: ids.alphaBinding, version: 1 }),
      JSON.stringify({ status: "PUBLISHED" }),
      now,
    ],
  );
  await runner.query(
    "INSERT INTO connector_commands(id,workspace_id,project_id,actor,capability_key,capability_version,operation,target,payload,binding_ref,profile_ref,effect_idempotency_key,state,result,correlation_id,causation_id,created_at) VALUES($1,$2,$3,$4,'sample.record','1.0.0','record.publish',$5,$6,$7,$8,'local-seed-confirmed-effect','CONFIRMED',$9,$10,$11,$12) ON CONFLICT DO NOTHING",
    [
      ids.command,
      ids.workspaceFunctional,
      ids.alpha,
      JSON.stringify({ kind: "HUMAN", principalId: requester }),
      JSON.stringify({ id: "local-seed-record" }),
      JSON.stringify({ message: "confirmed local seed" }),
      JSON.stringify({ id: ids.alphaBinding, version: 1 }),
      JSON.stringify({ id: ids.profile, version: 1 }),
      JSON.stringify({ externalRecordId: "local-seed-record", effectCount: 1 }),
      "84000000-0000-4000-8000-000000000001",
      "84000000-0000-4000-8000-000000000002",
      now,
    ],
  );
  await runner.query(
    "INSERT INTO audit_events(id,workspace_id,project_id,occurred_at,actor,action,outcome,reason_code,correlation_id,causation_id,authorization_basis,classification_key,attributes) VALUES($1,$2,$3,$4,$5,'command.confirmed','SUCCEEDED','CONFIRMED',$6,$7,$8,'INTERNAL',$9) ON CONFLICT DO NOTHING",
    [
      "85000000-0000-4000-8000-000000000001",
      ids.workspaceFunctional,
      ids.alpha,
      now,
      JSON.stringify({ kind: "HUMAN", principalId: requester }),
      "84000000-0000-4000-8000-000000000001",
      "84000000-0000-4000-8000-000000000002",
      JSON.stringify({ kind: "PROJECT", policyVersion: "local-seed@1" }),
      JSON.stringify({ values: { commandId: ids.command }, versionRefs: [] }),
    ],
  );
}

export async function runLocalSeed(dataSource: DataSource): Promise<LocalSeedResult> {
  if (!dataSource.isInitialized) await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await runner.query(
      "CREATE TABLE IF NOT EXISTS local_seed_markers(key text PRIMARY KEY, version integer NOT NULL, applied_at timestamptz NOT NULL)",
    );
    const marker = (await runner.query(
      "SELECT version FROM local_seed_markers WHERE key=$1 FOR UPDATE",
      [LOCAL_SEED_KEY],
    )) as readonly { version: number }[];
    if (Number(marker[0]?.version) === LOCAL_SEED_VERSION) {
      await runner.commitTransaction();
      return "unchanged";
    }
    if (marker[0] && marker[0].version > LOCAL_SEED_VERSION)
      throw new Error("LOCAL_SEED_VERSION_AHEAD");
    await retireLocalPrincipals(dataSource, runner);
    if (!marker[0] || marker[0].version < 4) {
      await seedIdentityAndScope(runner);
      await seedSharedTeam(dataSource, runner);
      await seedExtensions(runner);
      await seedConfiguration(runner);
      await seedControl(runner);
    } else {
      // Account cleanup does not rewrite retained grants or their revision history.
      await runner.query("UPDATE identities SET display_name=$1 WHERE id=$2", [
        localPersonaCatalog.resolve("viewer.beta").label,
        personaIds["viewer.beta"],
      ]);
    }
    await runner.query(
      "INSERT INTO local_seed_markers(key,version,applied_at) VALUES($1,$2,clock_timestamp()) ON CONFLICT(key) DO UPDATE SET version=EXCLUDED.version,applied_at=EXCLUDED.applied_at",
      [LOCAL_SEED_KEY, LOCAL_SEED_VERSION],
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

export const localSeedIds = ids;
export const localPersonaIds = personaIds;
