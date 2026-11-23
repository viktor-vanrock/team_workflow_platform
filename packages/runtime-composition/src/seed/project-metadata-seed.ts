import { randomUUID } from "node:crypto";

import type { DataSource } from "typeorm";

import {
  createProjectEntitlementRevision,
  type ExactRevisionRef,
  onboardingContentHash,
} from "@awp/platform-core";
import { ProjectEntitlementRepository } from "@awp/platform-persistence-typeorm";

const marker = "022-project-metadata-permission";
const permission = "project.metadata.update";
/** One-time local capability upgrade. Only existing live grants are extended. */
export async function runProjectMetadataLocalSeed(
  source: DataSource,
  issuer: string,
): Promise<void> {
  if (!["local", "test"].includes(process.env.AWP_RUNTIME_PROFILE ?? ""))
    throw new Error("PROJECT_METADATA_LOCAL_ONLY");
  await source.transaction("SERIALIZABLE", async (manager) => {
    await manager.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [marker]);
    if (
      (
        (await manager.query("SELECT 1 FROM local_seed_markers WHERE key=$1", [
          marker,
        ])) as unknown[]
      ).length
    )
      return;
    const [owner] = (await manager.query(
      "SELECT i.id FROM identities i JOIN platform_role_assignments a ON a.principal_id=i.id WHERE i.issuer=$1 AND i.kind='HUMAN' AND a.role_key='access-administrator' AND a.source='LOCAL_FIRST_LOGIN' AND a.revoked_at IS NULL",
      [issuer],
    )) as { id: string }[];
    if (!owner) return;
    const workspaces = (await manager.query(
      "SELECT id FROM workspaces WHERE state='ACTIVE' ORDER BY id FOR UPDATE",
    )) as { id: string }[];
    for (const workspace of workspaces) {
      const roles = (await manager.query(
        `SELECT r.id,r.principal_id,r.project_id FROM role_assignments r JOIN workspace_memberships m ON m.workspace_id=r.workspace_id AND m.principal_id=r.principal_id JOIN identities i ON i.id=r.principal_id WHERE r.workspace_id=$1 AND i.issuer=$2 AND i.kind='HUMAN' AND m.state='ACTIVE' AND m.revoked_at IS NULL AND m.valid_from<=clock_timestamp() AND (m.valid_until IS NULL OR m.valid_until>clock_timestamp()) AND r.role_key IN('system-administrator','project-registrar') AND r.effect='ALLOW' AND r.revoked_at IS NULL AND r.valid_from<=clock_timestamp() AND (r.valid_until IS NULL OR r.valid_until>clock_timestamp()) AND r.permissions ? 'project.register' ORDER BY r.id FOR UPDATE OF r`,
        [workspace.id, issuer],
      )) as { id: string; principal_id: string; project_id: string | null }[];
      for (const role of roles) {
        await manager.query(
          "UPDATE role_assignments SET permissions=permissions || $2::jsonb,row_version=row_version+1 WHERE id=$1 AND NOT(permissions ? $3)",
          [role.id, JSON.stringify([permission]), permission],
        );
        const grants = (await manager.query(
          `SELECT e.* FROM project_entitlements e WHERE e.workspace_id=$1 AND e.principal_id=$2 AND ($3::uuid IS NULL OR e.project_id=$3) AND e.effect='ALLOW' AND e.revoked_at IS NULL AND e.valid_from<=clock_timestamp() AND (e.valid_until IS NULL OR e.valid_until>clock_timestamp()) AND e.permissions ? 'project.catalog.read' AND NOT(e.permissions ? $4 OR e.permissions ? '*') ORDER BY e.id FOR UPDATE`,
          [workspace.id, role.principal_id, role.project_id, permission],
        )) as {
          id: string;
          workspace_id: string;
          project_id: string;
          principal_id: string;
          permissions: string[];
          classification_ceiling_key: string;
          valid_from: Date;
          valid_until: Date | null;
          created_at: Date;
          row_version: number;
        }[];
        for (const grant of grants) {
          const [previous] = (await manager.query(
            "SELECT r.revision_id,r.version,r.content_hash FROM project_entitlement_headers h JOIN project_entitlement_revisions r ON r.entitlement_id=h.entitlement_id AND r.version=h.current_version WHERE h.entitlement_id=$1",
            [grant.id],
          )) as {
            revision_id: string;
            version: number;
            content_hash: ExactRevisionRef["contentHash"];
          }[];
          if (!previous) {
            await manager.query(
              "DELETE FROM project_entitlement_permissions WHERE entitlement_id=$1",
              [grant.id],
            );
            await manager.query("DELETE FROM project_entitlements WHERE id=$1", [grant.id]);
          }
          const auditRef = {
            id: marker,
            version: 1,
            contentHash: onboardingContentHash({
              marker,
              roleId: role.id,
              entitlementId: grant.id,
            }),
          };
          const revision = createProjectEntitlementRevision({
            revisionId: randomUUID(),
            entitlementId: grant.id,
            workspaceId: grant.workspace_id,
            projectId: grant.project_id,
            principalId: grant.principal_id,
            version: previous ? previous.version + 1 : 1,
            operation: previous ? "REPLACE" : "GRANT",
            effect: "ALLOW",
            permissions: [...grant.permissions, permission],
            classificationCeilingKey: grant.classification_ceiling_key,
            validFrom: grant.valid_from.toISOString(),
            ...(grant.valid_until ? { validUntil: grant.valid_until.toISOString() } : {}),
            ...(previous
              ? {
                  previousRevisionRef: {
                    id: previous.revision_id,
                    version: previous.version,
                    contentHash: previous.content_hash,
                  },
                }
              : {}),
            actor: {
              kind: "HUMAN",
              principalId: owner.id,
              roleKey: "access-administrator",
              authorizationBasisRef: auditRef,
              authenticationContextRef: auditRef,
            },
            reason:
              "Локальное обновление: редактирование карточек для существующих администраторов проектов",
            correlationId: randomUUID(),
            createdAt: new Date().toISOString(),
          });
          await new ProjectEntitlementRepository(source).appendInTransaction(manager, revision);
          if (!previous)
            await manager.query(
              "UPDATE project_entitlements SET row_version=$2,created_at=$3 WHERE id=$1",
              [grant.id, grant.row_version + 1, grant.created_at],
            );
        }
      }
    }
    await manager.query(
      "INSERT INTO local_seed_markers(key,version,applied_at) VALUES($1,1,clock_timestamp())",
      [marker],
    );
  });
}
