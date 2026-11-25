import { randomUUID } from "node:crypto";

import type { DataSource } from "typeorm";

import { upgradeSuperadminCeiling } from "../security/superadmin-ceiling.ts";
import { workspaceRoleCatalog } from "../security/workspace-role-catalog.ts";

export function devBootstrapSubjects(env: NodeJS.ProcessEnv): readonly string[] {
  if (env.AWP_SUPERADMIN_ENVIRONMENT !== "dev") return [];
  return [
    ...new Set(
      (env.AWP_BOOTSTRAP_SUPERADMIN_SUBJECT ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
}

/** Grant only; never revive a historical assignment. */
export async function bootstrapDevSuperadmins(
  source: DataSource,
  issuer: string,
  subjects: readonly string[],
): Promise<number> {
  const role = workspaceRoleCatalog.find((entry) => entry.key === "super-administrator")!;
  let missing = 0;
  await source.transaction(async (manager) => {
    await manager.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      "dev-superadmin-bootstrap",
    ]);
    const workspaces = (await manager.query(
      "SELECT id FROM workspaces WHERE state='ACTIVE' ORDER BY id",
    )) as { id: string }[];
    for (const subject of [...new Set(subjects)]) {
      const [identity] = (await manager.query(
        "SELECT id FROM identities WHERE issuer=$1 AND subject=$2 AND kind='HUMAN'",
        [issuer, subject],
      )) as { id: string }[];
      if (!identity) {
        missing++;
        continue;
      }
      const principalId = identity.id;
      const platform = (await manager.query(
        "INSERT INTO platform_role_assignments(principal_id,role_key,source) VALUES($1,'access-administrator','DEV_BOOTSTRAP') ON CONFLICT(principal_id,role_key) DO NOTHING RETURNING principal_id",
        [principalId],
      )) as unknown[];
      for (const workspace of workspaces) {
        const [existing] = (await manager.query(
          "SELECT id FROM role_assignments WHERE workspace_id=$1 AND principal_id=$2 AND role_key='super-administrator' AND effect='ALLOW' LIMIT 1",
          [workspace.id, principalId],
        )) as { id: string }[];
        let granted = false;
        if (existing) await upgradeSuperadminCeiling(manager, workspace.id, principalId);
        if (!existing) {
          await manager.query(
            "INSERT INTO workspace_memberships(id,workspace_id,principal_id,state,valid_from) SELECT $1,$2,$3,'ACTIVE',clock_timestamp() WHERE NOT EXISTS(SELECT 1 FROM workspace_memberships WHERE workspace_id=$2 AND principal_id=$3 AND revoked_at IS NULL)",
            [randomUUID(), workspace.id, principalId],
          );
          await manager.query(
            "INSERT INTO role_assignments(id,workspace_id,principal_id,role_key,effect,permissions,valid_from,project_access_scope,classification_ceiling_key) VALUES($1,$2,$3,'super-administrator','ALLOW',$4,clock_timestamp(),'ALL_PROJECTS','CONFIDENTIAL')",
            [randomUUID(), workspace.id, principalId, JSON.stringify(role.permissions)],
          );
          await manager.query(
            "INSERT INTO workspace_access_heads(workspace_id,principal_id,version) VALUES($1,$2,1) ON CONFLICT(workspace_id,principal_id) DO UPDATE SET version=workspace_access_heads.version+1",
            [workspace.id, principalId],
          );
          const projects = (await manager.query(
            "SELECT id FROM projects WHERE workspace_id=$1 AND state<>'ARCHIVED'",
            [workspace.id],
          )) as { id: string }[];
          for (const project of projects) {
            const id = randomUUID();
            await manager.query(
              "INSERT INTO project_entitlements(id,workspace_id,project_id,principal_id,effect,classification_ceiling_key,permissions,valid_from) VALUES($1,$2,$3,$4,'ALLOW','CONFIDENTIAL',$5,clock_timestamp())",
              [id, workspace.id, project.id, principalId, JSON.stringify(role.permissions)],
            );
            for (const permission of role.permissions)
              await manager.query(
                "INSERT INTO project_entitlement_permissions(entitlement_id,permission_key) VALUES($1,$2) ON CONFLICT DO NOTHING",
                [id, permission],
              );
          }
          granted = true;
        }
        if (granted || platform.length) {
          const correlation = randomUUID();
          await manager.query(
            "INSERT INTO audit_events(id,workspace_id,project_id,occurred_at,actor,action,outcome,reason_code,correlation_id,causation_id,authorization_basis,classification_key,attributes) VALUES($1,$2,NULL,clock_timestamp(),$3,'dev-superadmin.bootstrap','SUCCEEDED','DEV_BOOTSTRAP',$4,$4,NULL,'INTERNAL',$5)",
            [
              randomUUID(),
              workspace.id,
              JSON.stringify({ kind: "SERVICE", principalId: "dev-bootstrap" }),
              correlation,
              JSON.stringify({
                principalId,
                platformGranted: !!platform.length,
                workspaceGranted: granted,
              }),
            ],
          );
        }
      }
    }
  });
  return missing;
}
