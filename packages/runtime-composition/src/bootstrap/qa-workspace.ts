import { createHash, randomUUID } from "node:crypto";

import type { DataSource, EntityManager } from "typeorm";

import { qaCompetencyManifest, qaValidationWorkTypeDefinition } from "@awp/competency-qa/node";

import { workspaceRoleCatalog } from "../security/workspace-role-catalog.ts";

const hash = (value: unknown) =>
  `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;

/** Explicit installation bootstrap. Never called by local seed or a read endpoint. */
export async function prepareQaWorkspace(source: DataSource): Promise<string> {
  return source.transaction(async (manager) => {
    // The same lock as first corporate login prevents installing after an election.
    await manager.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      "platform-first-corporate-administrator",
    ]);
    const configurationHash = hash({
      key: "qa",
      name: "QA",
      workType: "qa.validation",
      version: 1,
    });
    const [installed] = (await manager.query(
      "SELECT workspace_id,configuration_hash FROM qa_workspace_bootstrap",
    )) as { workspace_id: string; configuration_hash: string }[];
    if (installed) {
      if (installed.configuration_hash !== configurationHash)
        throw new Error("QA_WORKSPACE_BOOTSTRAP_CONFLICT");
      return installed.workspace_id;
    }
    const [existing] = (await manager.query(
      "SELECT EXISTS(SELECT 1 FROM workspaces) OR EXISTS(SELECT 1 FROM platform_administrator_bootstrap) AS present",
    )) as { present: boolean }[];
    if (existing?.present) throw new Error("QA_WORKSPACE_REQUIRES_EMPTY_INSTALLATION");
    const workspaceId = randomUUID(),
      serviceId = randomUUID(),
      packId = randomUUID(),
      typeId = randomUUID();
    await manager.query(
      "INSERT INTO identities(id,issuer,subject,kind,display_name) VALUES($1,'urn:awp:bootstrap','qa-workspace','SERVICE','Первоначальная настройка QA')",
      [serviceId],
    );
    await manager.query("INSERT INTO workspaces(id,key,name,state) VALUES($1,'qa','QA','ACTIVE')", [
      workspaceId,
    ]);
    await manager.query(
      "INSERT INTO competency_pack_registrations(id,pack_key,pack_version,manifest_schema_version,required_core_contract_range,manifest_payload,manifest_hash,registration_status,registered_at) VALUES($1,'competency-qa','1.0.0',1,'>=1.0.0 <2.0.0',$2,$3,'REGISTERED',clock_timestamp())",
      [packId, JSON.stringify(qaCompetencyManifest), hash(qaCompetencyManifest)],
    );
    const definition = qaValidationWorkTypeDefinition;
    await manager.query(
      "INSERT INTO work_type_definitions(id,pack_registration_id,work_type_key,definition_version,intake_schema,intake_schema_hash,required_capabilities,definition_payload,definition_hash,lifecycle_status,registered_at) VALUES($1,$2,'qa.validation','1.0.0',$3,$4,$5,$6,$7,'ACTIVE',clock_timestamp())",
      [
        typeId,
        packId,
        JSON.stringify(definition.intakeSchemaRef),
        definition.intakeSchemaRef.digest,
        JSON.stringify(definition.capabilityRequirements),
        JSON.stringify(definition),
        hash(definition),
      ],
    );
    await manager.query(
      "INSERT INTO workspace_work_types(id,workspace_id,work_type_key,active_definition_id,intake_state,changed_by,changed_at,reason) VALUES($1,$2,'qa.validation',$3,'ENABLED',$4,clock_timestamp(),'Первоначальная настройка QA')",
      [randomUUID(), workspaceId, typeId, serviceId],
    );
    await manager.query(
      "INSERT INTO qa_workspace_bootstrap(singleton,workspace_id,configuration_hash) VALUES(true,$1,$2)",
      [workspaceId, configurationHash],
    );
    return workspaceId;
  });
}

/** Runs inside the verified first-login transaction; replay and revocation never regrant roles. */
export async function grantInitialQaAdministrator(
  manager: EntityManager,
  principalId: string,
): Promise<void> {
  const [workspace] = (await manager.query(
    "SELECT b.workspace_id FROM qa_workspace_bootstrap b JOIN workspaces w ON w.id=b.workspace_id AND w.state='ACTIVE'",
  )) as { workspace_id: string }[];
  if (!workspace) return;
  const roleId = randomUUID(),
    requestKey = randomUUID();
  const role = workspaceRoleCatalog.find((r) => r.key === "system-administrator")!;
  await manager.query(
    "INSERT INTO workspace_memberships(id,workspace_id,principal_id,state,valid_from) SELECT $1,$2,$3,'ACTIVE',clock_timestamp() WHERE NOT EXISTS(SELECT 1 FROM workspace_memberships WHERE workspace_id=$2 AND principal_id=$3 AND state='ACTIVE' AND revoked_at IS NULL)",
    [randomUUID(), workspace.workspace_id, principalId],
  );
  await manager.query(
    "INSERT INTO role_assignments(id,workspace_id,principal_id,role_key,effect,permissions,valid_from,project_access_scope,classification_ceiling_key) VALUES($1,$2,$3,'system-administrator','ALLOW',$4,clock_timestamp(),'ALL_PROJECTS','CONFIDENTIAL')",
    [roleId, workspace.workspace_id, principalId, JSON.stringify(role.permissions)],
  );
  await manager.query(
    "INSERT INTO workspace_access_heads(workspace_id,principal_id,version) VALUES($1,$2,1) ON CONFLICT(workspace_id,principal_id) DO UPDATE SET version=workspace_access_heads.version+1",
    [workspace.workspace_id, principalId],
  );
  await manager.query(
    "INSERT INTO platform_access_changes(id,actor_id,target_id,workspace_id,request_key,request_hash,before_json,after_json,reason) VALUES($1,$2,$2,$3,$4,$5,$6,$7,'Первый корпоративный администратор: управление проектами QA')",
    [
      randomUUID(),
      principalId,
      workspace.workspace_id,
      requestKey,
      hash({ workspaceId: workspace.workspace_id, principalId, roleId }),
      JSON.stringify({ roleKeys: [] }),
      JSON.stringify({ roleKeys: [role.key], classificationCeiling: "CONFIDENTIAL", version: 1 }),
    ],
  );
  await manager.query(
    "INSERT INTO qa_workspace_administrator_bootstrap(singleton,workspace_id,principal_id,role_assignment_id) VALUES(true,$1,$2,$3)",
    [workspace.workspace_id, principalId, roleId],
  );
}
