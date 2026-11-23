import { createHash } from "node:crypto";

import type { DataSource } from "typeorm";

import { PlatformAccessService } from "../security/platform-access.ts";

/** Enroll the elected local global administrator as a project registrar in each area. */
export async function runOwnerProjectRegistrarLocalSeed(
  source: DataSource,
  issuer: string,
): Promise<void> {
  const [owner] = (await source.query(
    `SELECT i.id FROM identities i JOIN platform_role_assignments a ON a.principal_id=i.id
    WHERE i.issuer=$1 AND i.kind='HUMAN'
      AND a.role_key='access-administrator' AND a.source='LOCAL_FIRST_LOGIN' AND a.revoked_at IS NULL`,
    [issuer],
  )) as { id: string }[];
  if (!owner) return;
  const runner = source.createQueryRunner();
  await runner.connect();
  try {
    await runner.query(
      "SELECT pg_advisory_lock(hashtextextended('021-owner-project-registrar',0))",
    );
    const exists = async (sql: string, parameters: unknown[]) =>
      ((await runner.query(sql, parameters)) as unknown[]).length > 0;
    const service = new PlatformAccessService(source);
    const actor = {
      principalId: owner.id,
      permission: "platform.workspace-roles.manage" as const,
      assignmentSource: "LOCAL_FIRST_LOGIN" as const,
    };
    const workspaces = (await service.workspaces(actor)).filter((w) => w.state === "ACTIVE");
    for (const workspace of workspaces) {
      const marker = `0230-local-administrator-project-registrar:${owner.id}:${workspace.id}`;
      if (await exists("SELECT 1 FROM local_seed_markers WHERE key=$1", [marker])) continue;
      const hex = createHash("sha256").update(`${marker}:${owner.id}`).digest("hex");
      const requestKey = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
      const completed = await exists("SELECT 1 FROM platform_access_changes WHERE request_key=$1", [
        requestKey,
      ]);
      const current = (await service.detail(actor, owner.id)).memberships.find(
        (m) => m.workspaceId === workspace.id,
      );
      // A foundation-only area can retain seeded domain roles before its pack is enabled.
      // Leave those roles intact and retry registration when the area's catalog is ready.
      if (current?.roleKeys.some((key) => !workspace.roles.some((role) => role.key === key)))
        continue;
      const revoked = await exists(
        `SELECT 1 FROM role_assignments WHERE workspace_id=$1 AND principal_id=$2 AND role_key='project-registrar' AND revoked_at IS NOT NULL
        UNION ALL SELECT 1 FROM workspace_memberships WHERE workspace_id=$1 AND principal_id=$2 AND (state='REVOKED' OR revoked_at IS NOT NULL)`,
        [workspace.id, owner.id],
      );
      const already = await exists(
        `SELECT 1 FROM role_assignments WHERE workspace_id=$1 AND principal_id=$2 AND project_id IS NULL AND effect='ALLOW'
        AND revoked_at IS NULL AND valid_from<=clock_timestamp() AND (valid_until IS NULL OR valid_until>clock_timestamp()) AND permissions ? 'project.register'`,
        [workspace.id, owner.id],
      );
      if (!completed && !revoked && !already) {
        await service.replace(actor, owner.id, workspace.id, {
          roleKeys: [...new Set([...(current?.roleKeys ?? []), "project-registrar"])],
          classificationCeiling: current?.classificationCeiling ?? "RESTRICTED",
          expectedVersion: current?.version ?? 0,
          requestKey,
          reason: "Создание проектов глобальным администратором во всех локальных рабочих областях",
        });
      }
      await runner.query(
        "INSERT INTO local_seed_markers(key,version,applied_at) VALUES($1,1,clock_timestamp()) ON CONFLICT(key) DO NOTHING",
        [marker],
      );
    }
  } finally {
    try {
      await runner.query(
        "SELECT pg_advisory_unlock(hashtextextended('021-owner-project-registrar',0))",
      );
    } finally {
      await runner.release();
    }
  }
}
