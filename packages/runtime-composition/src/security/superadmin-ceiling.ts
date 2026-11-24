import { randomUUID } from "node:crypto";

import type { EntityManager } from "typeorm";

import { createProjectEntitlementRevision } from "@awp/platform-core";
import { ProjectEntitlementRepository } from "@awp/platform-persistence-typeorm";

/** Update active grants without reviving revoked assignments. */
export async function upgradeSuperadminCeiling(
  manager: EntityManager,
  workspaceId: string,
  principalId: string,
): Promise<boolean> {
  if (
    process.env.AWP_RUNTIME_PROFILE !== "local" &&
    process.env.AWP_SUPERADMIN_ENVIRONMENT !== "dev"
  )
    return false;
  const roles = (await manager.query(
    "WITH updated AS (UPDATE role_assignments SET classification_ceiling_key='CONFIDENTIAL',row_version=row_version+1 WHERE workspace_id=$1 AND principal_id=$2 AND role_key='super-administrator' AND effect='ALLOW' AND revoked_at IS NULL AND valid_from<=clock_timestamp() AND (valid_until IS NULL OR valid_until>clock_timestamp()) AND classification_ceiling_key IS DISTINCT FROM 'CONFIDENTIAL' RETURNING id) SELECT id FROM updated",
    [workspaceId, principalId],
  )) as { id: string }[];
  const grants = (await manager.query(
    `SELECT e.id,e.project_id,e.permissions,e.valid_from,e.valid_until,h.current_version,r.revision_id,r.content_hash
     FROM project_entitlements e JOIN classification_catalog c ON c.key=e.classification_ceiling_key
     LEFT JOIN project_entitlement_headers h ON h.entitlement_id=e.id
     LEFT JOIN project_entitlement_revisions r ON r.entitlement_id=h.entitlement_id AND r.version=h.current_version
     WHERE e.workspace_id=$1 AND e.principal_id=$2 AND e.effect='ALLOW' AND e.revoked_at IS NULL
       AND e.valid_from<=clock_timestamp() AND (e.valid_until IS NULL OR e.valid_until>clock_timestamp())
       AND c.rank < (SELECT rank FROM classification_catalog WHERE key='CONFIDENTIAL')
       AND EXISTS (SELECT 1 FROM role_assignments a WHERE a.workspace_id=e.workspace_id AND a.principal_id=e.principal_id
         AND a.role_key='super-administrator' AND a.effect='ALLOW' AND a.revoked_at IS NULL
         AND a.valid_from<=clock_timestamp() AND (a.valid_until IS NULL OR a.valid_until>clock_timestamp()))
     FOR UPDATE OF e`,
    [workspaceId, principalId],
  )) as {
    id: string;
    project_id: string;
    permissions: string[];
    valid_from: Date;
    valid_until: Date | null;
    current_version: number | null;
    revision_id: string | null;
    content_hash: `sha256:${string}` | null;
  }[];
  for (const grant of grants) {
    const correlationId = randomUUID();
    if (grant.current_version) {
      if (!grant.revision_id || !grant.content_hash)
        throw new Error("SUPERADMIN_ENTITLEMENT_REVISION_MISSING");
      await new ProjectEntitlementRepository(manager.connection).appendInTransaction(
        manager,
        createProjectEntitlementRevision({
          workspaceId,
          projectId: grant.project_id,
          principalId,
          entitlementId: grant.id,
          revisionId: randomUUID(),
          version: grant.current_version + 1,
          operation: "REPLACE",
          effect: "ALLOW",
          permissions: grant.permissions,
          classificationCeilingKey: "CONFIDENTIAL",
          validFrom: grant.valid_from.toISOString(),
          ...(grant.valid_until ? { validUntil: grant.valid_until.toISOString() } : {}),
          previousRevisionRef: {
            id: grant.revision_id,
            version: grant.current_version,
            contentHash: grant.content_hash,
          },
          actor: {
            kind: "SERVICE",
            principalId: "superadmin-bootstrap",
            serviceKey: "superadmin-bootstrap",
          },
          reason: "Повышение потолка суперадминистратора",
          correlationId,
          createdAt: new Date().toISOString(),
        }),
      );
    } else {
      await manager.query(
        "UPDATE project_entitlements SET classification_ceiling_key='CONFIDENTIAL',row_version=row_version+1 WHERE id=$1",
        [grant.id],
      );
      await manager.query(
        "INSERT INTO audit_events(id,workspace_id,project_id,occurred_at,actor,action,outcome,reason_code,correlation_id,causation_id,authorization_basis,classification_key,attributes) VALUES($1,$2,$3,clock_timestamp(),$4,'PROJECT_ENTITLEMENT_CHANGED','SUCCEEDED','SUPERADMIN_CEILING_CONFIDENTIAL',$5,$5,NULL,'CONFIDENTIAL',$6)",
        [
          randomUUID(),
          workspaceId,
          grant.project_id,
          JSON.stringify({
            kind: "SERVICE",
            principalId: "superadmin-bootstrap",
            serviceKey: "superadmin-bootstrap",
          }),
          correlationId,
          JSON.stringify({
            principalId,
            entitlementId: grant.id,
            classificationCeiling: "CONFIDENTIAL",
          }),
        ],
      );
    }
  }
  if (!roles.length && !grants.length) return false;
  await manager.query(
    "UPDATE workspace_access_heads SET version=version+1 WHERE workspace_id=$1 AND principal_id=$2",
    [workspaceId, principalId],
  );
  const correlation = randomUUID();
  await manager.query(
    "INSERT INTO audit_events(id,workspace_id,project_id,occurred_at,actor,action,outcome,reason_code,correlation_id,causation_id,authorization_basis,classification_key,attributes) VALUES($1,$2,NULL,clock_timestamp(),$3,'superadmin.ceiling.upgrade','SUCCEEDED','SUPERADMIN_CEILING_CONFIDENTIAL',$4,$4,NULL,'INTERNAL',$5)",
    [
      randomUUID(),
      workspaceId,
      JSON.stringify({ kind: "SERVICE", principalId: "superadmin-bootstrap" }),
      correlation,
      JSON.stringify({ principalId, classificationCeiling: "CONFIDENTIAL" }),
    ],
  );
  return true;
}
