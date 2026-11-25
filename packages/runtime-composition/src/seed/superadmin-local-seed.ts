import { randomUUID } from "node:crypto";

import type { DataSource } from "typeorm";

import { localPersonaCatalog } from "../security/local-security.ts";
import { upgradeSuperadminCeiling } from "../security/superadmin-ceiling.ts";

/** Pilot fixture; an explicitly revoked grant is never restored. */
export async function runSuperadminLocalSeed(source: DataSource, issuer: string): Promise<void> {
  if (
    process.env.AWP_RUNTIME_PROFILE !== "local" ||
    process.env.AWP_PILOT_ADAPTER_MODE !== "development"
  )
    throw new Error("SUPERADMIN_LOCAL_PILOT_REQUIRED");
  const persona = localPersonaCatalog.resolve("superadmin.local");
  await source.transaction(async (manager) => {
    await manager.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      "superadmin-local-seed",
    ]);
    await manager.query(
      "INSERT INTO identities(id,issuer,subject,kind,display_name) VALUES($1,$2,$3,'HUMAN',$4) ON CONFLICT(issuer,subject) DO NOTHING",
      [randomUUID(), issuer, persona.subject, persona.label],
    );
    const [identity] = (await manager.query(
      "SELECT id FROM identities WHERE issuer=$1 AND subject=$2 AND kind='HUMAN'",
      [issuer, persona.subject],
    )) as { id: string }[];
    if (!identity) throw new Error("SUPERADMIN_LOCAL_IDENTITY_CONFLICT");
    await manager.query(
      "INSERT INTO platform_role_assignments(principal_id,role_key,source) VALUES($1,'access-administrator','LOCAL_BOOTSTRAP') ON CONFLICT(principal_id,role_key) DO NOTHING",
      [identity.id],
    );
    const workspaces = (await manager.query("SELECT id FROM workspaces WHERE state='ACTIVE'")) as {
      id: string;
    }[];
    for (const workspace of workspaces) {
      const [previous] = (await manager.query(
        "SELECT id FROM role_assignments WHERE workspace_id=$1 AND principal_id=$2 AND role_key='super-administrator' AND effect='ALLOW' LIMIT 1",
        [workspace.id, identity.id],
      )) as { id: string }[];
      if (previous) {
        await upgradeSuperadminCeiling(manager, workspace.id, identity.id);
        continue;
      }
      await manager.query(
        "INSERT INTO workspace_memberships(id,workspace_id,principal_id,state,valid_from) SELECT $1,$2,$3,'ACTIVE',clock_timestamp() WHERE NOT EXISTS(SELECT 1 FROM workspace_memberships WHERE workspace_id=$2 AND principal_id=$3 AND revoked_at IS NULL)",
        [randomUUID(), workspace.id, identity.id],
      );
      await manager.query(
        "INSERT INTO role_assignments(id,workspace_id,principal_id,role_key,effect,permissions,valid_from,project_access_scope,classification_ceiling_key) VALUES($1,$2,$3,'super-administrator','ALLOW',$4,clock_timestamp(),'ALL_PROJECTS','CONFIDENTIAL')",
        [randomUUID(), workspace.id, identity.id, JSON.stringify(persona.permissions)],
      );
      const projects = (await manager.query("SELECT id FROM projects WHERE workspace_id=$1", [
        workspace.id,
      ])) as { id: string }[];
      for (const project of projects) {
        const entitlementId = randomUUID();
        await manager.query(
          "INSERT INTO project_entitlements(id,workspace_id,project_id,principal_id,effect,classification_ceiling_key,permissions,valid_from) VALUES($1,$2,$3,$4,'ALLOW','CONFIDENTIAL',$5,clock_timestamp())",
          [
            entitlementId,
            workspace.id,
            project.id,
            identity.id,
            JSON.stringify(persona.permissions),
          ],
        );
        for (const permission of persona.permissions)
          await manager.query(
            "INSERT INTO project_entitlement_permissions(entitlement_id,permission_key) VALUES($1,$2) ON CONFLICT DO NOTHING",
            [entitlementId, permission],
          );
      }
    }
  });
}
