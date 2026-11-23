import { createHash, randomUUID } from "node:crypto";

import type { DataSource, EntityManager } from "typeorm";

import {
  canonicalRoleKey,
  createProjectEntitlementRevision,
  type PlatformAccessContext,
  type PlatformAccessPermission,
  platformAccessPermissions,
  type ProjectEntitlementRevision,
} from "@awp/platform-core";
import { ProjectEntitlementRepository } from "@awp/platform-persistence-typeorm";
import type { VerifiedOidcIdentity } from "@awp/platform-runtime-nest";

import { grantInitialQaAdministrator } from "../bootstrap/qa-workspace.ts";
import { workspaceRoleCatalog } from "./workspace-role-catalog.ts";

const digest = (value: unknown): `sha256:${string}` =>
  `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
const uuid = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/iu.test(value);
const live =
  "revoked_at IS NULL AND valid_from<=clock_timestamp() AND (valid_until IS NULL OR valid_until>clock_timestamp())";
export interface WorkspaceAccessView {
  workspaceId: string;
  workspaceName: string;
  workspaceKey: string;
  state: string;
  version: number;
  roleKeys: string[];
  classificationCeiling: string;
  otherRoleKeys: string[];
  requesterProjectIds: string[];
}
export interface ReplaceWorkspaceAccess {
  requesterProjectIds?: readonly string[];
  roleKeys: readonly string[];
  classificationCeiling: string;
  expectedVersion: number;
  requestKey: string;
  reason: string;
}

/** Only trusted HTTP/session adapters construct PlatformAccessContext. Every operation rechecks its durable grant. */
export class PlatformAccessService {
  constructor(private readonly source: DataSource) {}
  async authorize(
    principalId: string,
    permission: PlatformAccessPermission,
    source?: PlatformAccessContext["assignmentSource"],
    manager: EntityManager = this.source.manager,
  ): Promise<PlatformAccessContext> {
    if (!platformAccessPermissions.includes(permission)) throw new Error("PLATFORM_ACCESS_DENIED");
    const [row] = (await manager.query(
      `SELECT a.source FROM platform_role_assignments a JOIN identities i ON i.id=a.principal_id
      WHERE a.principal_id=$1 AND a.role_key='access-administrator' AND a.revoked_at IS NULL AND i.kind='HUMAN' FOR SHARE OF a`,
      [principalId],
    )) as { source: PlatformAccessContext["assignmentSource"] }[];
    if (!row || (source && source !== row.source)) throw new Error("PLATFORM_ACCESS_DENIED");
    return { principalId, permission, assignmentSource: row.source };
  }
  private check(
    actor: PlatformAccessContext,
    permission: PlatformAccessPermission,
    manager?: EntityManager,
  ) {
    return this.authorize(actor.principalId, permission, actor.assignmentSource, manager);
  }
  async own(principalId: string, platformAllowed: boolean) {
    const profile = await this.profile(this.source.manager, principalId);
    const memberships = await this.memberships(this.source.manager, principalId);
    return {
      ...profile,
      memberships,
      platformPermissions: platformAllowed ? [...platformAccessPermissions] : [],
      status:
        platformAllowed || memberships.some((m) => m.state === "ACTIVE" && m.roleKeys.length)
          ? "ACTIVE"
          : "PENDING",
    };
  }
  private async profile(manager: EntityManager, principalId: string) {
    if (!uuid(principalId)) throw new Error("ACCESS_USER_NOT_FOUND");
    const [profile] = (await manager.query(
      `SELECT p.principal_id AS "principalId",p.display_name AS "displayName",p.username,p.last_authenticated_at AS "lastAuthenticatedAt"
      FROM platform_user_profiles p JOIN identities i ON i.id=p.principal_id WHERE p.principal_id=$1 AND i.kind='HUMAN'`,
      [principalId],
    )) as {
      principalId: string;
      displayName: string;
      username: string;
      lastAuthenticatedAt: string | null;
    }[];
    if (!profile) throw new Error("ACCESS_USER_NOT_FOUND");
    return profile;
  }
  async users(actor: PlatformAccessContext, query = "", offset = 0) {
    await this.check(actor, "platform.users.read");
    if (
      typeof query !== "string" ||
      query.length > 200 ||
      !Number.isSafeInteger(offset) ||
      offset < 0
    )
      throw new Error("ACCESS_QUERY_INVALID");
    const rows = (await this.source.query(
      `SELECT p.principal_id AS "principalId",p.display_name AS "displayName",p.username,
      CASE WHEN EXISTS(SELECT 1 FROM platform_role_assignments a WHERE a.principal_id=p.principal_id AND a.revoked_at IS NULL)
        OR EXISTS(SELECT 1 FROM workspace_memberships m WHERE m.principal_id=p.principal_id AND m.state='ACTIVE' AND ${live}) THEN 'ACTIVE' ELSE 'PENDING' END AS status
      FROM platform_user_profiles p JOIN identities i ON i.id=p.principal_id AND i.kind='HUMAN'
      WHERE strpos(lower(p.display_name||' '||p.username),lower($1))>0 ORDER BY p.display_name,p.principal_id LIMIT 101 OFFSET $2`,
      [query.trim(), offset],
    )) as { principalId: string; displayName: string; username: string; status: string }[];
    return { items: rows.slice(0, 100), nextOffset: rows.length > 100 ? offset + 100 : null };
  }
  async workspaces(actor: PlatformAccessContext) {
    await this.check(actor, "platform.users.read");
    return this.workspaceCatalog(this.source.manager);
  }
  private async workspaceCatalog(manager: EntityManager) {
    const rows =
      (await manager.query(`SELECT w.id,w.key,w.name,w.state,COALESCE(jsonb_agg(t.work_type_key) FILTER(WHERE t.work_type_key IS NOT NULL),'[]') AS types
      FROM workspaces w LEFT JOIN workspace_work_types t ON t.workspace_id=w.id AND t.intake_state='ENABLED'
      GROUP BY w.id ORDER BY w.name`)) as {
        id: string;
        key: string;
        name: string;
        state: string;
        types: string[];
      }[];
    const projects = (await manager.query(
      "SELECT id,workspace_id AS \"workspaceId\",key,name FROM projects WHERE state<>'ARCHIVED' ORDER BY name,id",
    )) as { id: string; workspaceId: string; key: string; name: string }[];
    return rows.map(({ types, ...workspace }) => ({
      ...workspace,
      projects: projects
        .filter((p) => p.workspaceId === workspace.id)
        .map(({ id, key, name }) => ({ id, key, name })),
      roles: workspaceRoleCatalog.filter(
        (role) =>
          role.domain === "COMMON" ||
          (role.domain === "QA" && types.some((t) => t.startsWith("qa."))) ||
          (role.domain === "DOCS" && types.some((t) => t.startsWith("tech-writing."))),
      ),
    }));
  }
  private async memberships(
    manager: EntityManager,
    principalId: string,
  ): Promise<WorkspaceAccessView[]> {
    const rows = (await manager.query(
      `SELECT DISTINCT w.id,w.name,w.key,COALESCE(h.version,0) AS version,
      COALESCE((SELECT m.state FROM workspace_memberships m WHERE m.workspace_id=w.id AND m.principal_id=$1 AND ${live} ORDER BY m.row_version DESC LIMIT 1),'REVOKED') AS state
      FROM workspaces w LEFT JOIN workspace_access_heads h ON h.workspace_id=w.id AND h.principal_id=$1
      WHERE h.principal_id IS NOT NULL OR EXISTS(SELECT 1 FROM workspace_memberships m WHERE m.workspace_id=w.id AND m.principal_id=$1) ORDER BY w.name`,
      [principalId],
    )) as { id: string; name: string; key: string; version: number; state: string }[];
    const result: WorkspaceAccessView[] = [];
    for (const row of rows) {
      const roles = (await manager.query(
        `SELECT role_key,effect,project_id,classification_ceiling_key FROM role_assignments WHERE workspace_id=$1 AND principal_id=$2 AND ${live}`,
        [row.id, principalId],
      )) as {
        role_key: string;
        effect: string;
        project_id: string | null;
        classification_ceiling_key: string | null;
      }[];
      const keys = [
        ...new Set(
          roles.filter((r) => r.effect === "ALLOW").map((r) => canonicalRoleKey(r.role_key)),
        ),
      ].sort();
      const [ceiling] = (await manager.query(
        `SELECT e.classification_ceiling_key AS key FROM project_entitlements e JOIN classification_catalog c ON c.key=e.classification_ceiling_key
        WHERE e.workspace_id=$1 AND e.principal_id=$2 AND e.effect='ALLOW' AND ${live} ORDER BY c.rank DESC LIMIT 1`,
        [row.id, principalId],
      )) as { key: string }[];
      result.push({
        workspaceId: row.id,
        workspaceName: row.name,
        workspaceKey: row.key,
        state: row.state,
        version: row.version,
        roleKeys: keys.filter((key) => workspaceRoleCatalog.some((r) => r.key === key)),
        otherRoleKeys: keys.filter((key) => !workspaceRoleCatalog.some((r) => r.key === key)),
        requesterProjectIds: [
          ...new Set(
            roles
              .filter((r) => r.role_key === "requester" && r.effect === "ALLOW" && r.project_id)
              .map((r) => r.project_id!),
          ),
        ].sort(),
        classificationCeiling:
          ceiling?.key ??
          roles.find((r) => r.classification_ceiling_key)?.classification_ceiling_key ??
          "INTERNAL",
      });
    }
    return result;
  }
  async detail(actor: PlatformAccessContext, principalId: string) {
    await this.check(actor, "platform.users.read");
    const profile = await this.profile(this.source.manager, principalId);
    const memberships = await this.memberships(this.source.manager, principalId);
    const platformRoles = (await this.source.query(
      `SELECT role_key AS "roleKey",source,revoked_at AS "revokedAt" FROM platform_role_assignments WHERE principal_id=$1`,
      [principalId],
    )) as { roleKey: string; source: string; revokedAt: string | null }[];
    const history = (await this.source.query(
      `SELECT c.id,c.reason,c.created_at AS "createdAt",i.display_name AS "actorName",w.name AS "workspaceName",c.before_json AS "before",c.after_json AS "after"
      FROM platform_access_changes c JOIN identities i ON i.id=c.actor_id JOIN workspaces w ON w.id=c.workspace_id WHERE c.target_id=$1 ORDER BY c.created_at DESC,c.id LIMIT 30`,
      [principalId],
    )) as {
      id: string;
      reason: string;
      createdAt: string;
      actorName: string;
      workspaceName: string;
      before: WorkspaceAccessView;
      after: WorkspaceAccessView;
    }[];
    return { ...profile, memberships, platformRoles, history };
  }
  async replace(
    actor: PlatformAccessContext,
    principalId: string,
    workspaceId: string,
    input: ReplaceWorkspaceAccess,
  ): Promise<WorkspaceAccessView> {
    if (
      !uuid(principalId) ||
      !uuid(workspaceId) ||
      !input ||
      !uuid(input.requestKey) ||
      !Array.isArray(input.roleKeys) ||
      input.roleKeys.length > 20 ||
      input.roleKeys.some((k) => typeof k !== "string") ||
      (input.requesterProjectIds !== undefined &&
        (!Array.isArray(input.requesterProjectIds) ||
          input.requesterProjectIds.length > 500 ||
          input.requesterProjectIds.some((id) => !uuid(id)) ||
          new Set(input.requesterProjectIds).size !== input.requesterProjectIds.length)) ||
      new Set(input.roleKeys).size !== input.roleKeys.length ||
      !["PUBLIC", "INTERNAL", "RESTRICTED", "CONFIDENTIAL"].includes(input.classificationCeiling) ||
      !Number.isSafeInteger(input.expectedVersion) ||
      input.expectedVersion < 0 ||
      typeof input.reason !== "string" ||
      input.reason.trim().length < 3 ||
      input.reason.length > 1000 ||
      Object.keys(input).some(
        (k) =>
          ![
            "roleKeys",
            "requesterProjectIds",
            "classificationCeiling",
            "expectedVersion",
            "requestKey",
            "reason",
          ].includes(k),
      )
    )
      throw new Error("ACCESS_INPUT_INVALID");
    const body = {
      ...input,
      roleKeys: [...(input.roleKeys as readonly string[])].sort(),
      ...(input.requesterProjectIds === undefined
        ? {}
        : { requesterProjectIds: [...(input.requesterProjectIds as readonly string[])].sort() }),
      reason: input.reason.trim(),
    };
    const requestHash = digest({ actor: actor.principalId, principalId, workspaceId, body });
    return this.source.transaction(async (manager) => {
      await this.check(actor, "platform.workspace-roles.manage", manager);
      await manager.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        input.requestKey,
      ]);
      const [previous] = (await manager.query(
        "SELECT request_hash,after_json FROM platform_access_changes WHERE request_key=$1",
        [input.requestKey],
      )) as { request_hash: string; after_json: WorkspaceAccessView }[];
      if (previous) {
        if (previous.request_hash !== requestHash) throw new Error("ACCESS_REQUEST_CONFLICT");
        return previous.after_json;
      }
      await this.profile(manager, principalId);
      await manager.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [workspaceId]);
      const workspace = (await this.workspaceCatalog(manager)).find((w) => w.id === workspaceId);
      if (!workspace || workspace.state !== "ACTIVE")
        throw new Error("ACCESS_WORKSPACE_NOT_AVAILABLE");
      if (body.roleKeys.some((key) => !workspace.roles.some((role) => role.key === key)))
        throw new Error("ACCESS_ROLE_INVALID");
      await manager.query(
        "INSERT INTO workspace_access_heads(workspace_id,principal_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [workspaceId, principalId],
      );
      const [head] = (await manager.query(
        "SELECT version FROM workspace_access_heads WHERE workspace_id=$1 AND principal_id=$2 FOR UPDATE",
        [workspaceId, principalId],
      )) as { version: number }[];
      if (head!.version !== input.expectedVersion) throw new Error("ACCESS_VERSION_CONFLICT");
      const before = (await this.memberships(manager, principalId)).find(
        (m) => m.workspaceId === workspaceId,
      )!;
      const requesterProjectIds = body.roleKeys.includes("requester")
        ? (body.requesterProjectIds ?? before.requesterProjectIds)
        : [];
      if (requesterProjectIds.some((id) => !workspace.projects.some((p) => p.id === id)))
        throw new Error("ACCESS_PROJECT_INVALID");
      const knownKeys = workspaceRoleCatalog.map((r) => r.key);
      const knownPermissions = new Set(workspaceRoleCatalog.flatMap((r) => r.permissions));
      const permissions = [
        ...new Set(
          workspaceRoleCatalog
            .filter((r) => r.key !== "requester" && body.roleKeys.includes(r.key))
            .flatMap((r) => r.permissions),
        ),
      ].sort();
      await manager.query(
        `UPDATE role_assignments SET revoked_at=clock_timestamp(),row_version=row_version+1 WHERE workspace_id=$1 AND principal_id=$2 AND effect='ALLOW' AND role_key=ANY($3) AND revoked_at IS NULL`,
        [workspaceId, principalId, knownKeys],
      );
      for (const key of body.roleKeys)
        await manager.query(
          `INSERT INTO role_assignments(id,workspace_id,principal_id,role_key,effect,permissions,valid_from,project_access_scope,classification_ceiling_key)
        VALUES($1,$2,$3,$4,'ALLOW',$5,clock_timestamp(),$7,$6)`,
          [
            randomUUID(),
            workspaceId,
            principalId,
            key,
            JSON.stringify(
              key === "requester"
                ? ["project.request.create"]
                : workspaceRoleCatalog.find((r) => r.key === key)!.permissions,
            ),
            input.classificationCeiling,
            key === "requester" ? "SELECTED_PROJECTS" : "ALL_PROJECTS",
          ],
        );
      const requesterPermissions = workspaceRoleCatalog
        .find((r) => r.key === "requester")!
        .permissions.filter((p) => p !== "project.request.create");
      for (const projectId of requesterProjectIds)
        await manager.query(
          `INSERT INTO role_assignments(id,workspace_id,project_id,principal_id,role_key,effect,permissions,valid_from,classification_ceiling_key)
          VALUES($1,$2,$3,$4,'requester','ALLOW',$5,clock_timestamp(),$6)`,
          [
            randomUUID(),
            workspaceId,
            projectId,
            principalId,
            JSON.stringify(requesterPermissions),
            input.classificationCeiling,
          ],
        );
      const grants = (await manager.query(
        `SELECT * FROM project_entitlements WHERE workspace_id=$1 AND principal_id=$2 AND effect='ALLOW' AND revoked_at IS NULL FOR UPDATE`,
        [workspaceId, principalId],
      )) as {
        id: string;
        project_id: string;
        permissions: string[];
        classification_ceiling_key: string;
        valid_from: Date;
        valid_until: Date | null;
      }[];
      const at = new Date().toISOString();
      for (const grant of grants) {
        const remaining = grant.permissions.filter((p) => !knownPermissions.has(p));
        if (remaining.length === grant.permissions.length) continue;
        await this.entitlement(
          manager,
          actor,
          {
            workspaceId,
            projectId: grant.project_id,
            principalId,
            entitlementId: grant.id,
            permissions: remaining.length ? remaining : grant.permissions,
            classificationCeilingKey: grant.classification_ceiling_key,
            validFrom: grant.valid_from.toISOString(),
            ...(grant.valid_until ? { validUntil: grant.valid_until.toISOString() } : {}),
            ...(!remaining.length ? { revokedAt: at } : {}),
            operation: remaining.length ? "REPLACE" : "REVOKE",
            effect: "ALLOW",
            reason: body.reason,
          },
          input.requestKey,
        );
      }
      if (permissions.length || requesterProjectIds.length) {
        const projects = (await manager.query(
          "SELECT id FROM projects WHERE workspace_id=$1 AND state<>'ARCHIVED' ORDER BY id",
          [workspaceId],
        )) as { id: string }[];
        for (const project of projects) {
          const projectPermissions = [
            ...new Set([
              ...permissions,
              ...(requesterProjectIds.includes(project.id) ? requesterPermissions : []),
            ]),
          ].sort();
          if (!projectPermissions.length) continue;
          await this.entitlement(
            manager,
            actor,
            {
              workspaceId,
              projectId: project.id,
              principalId,
              entitlementId: randomUUID(),
              permissions: projectPermissions,
              classificationCeilingKey: input.classificationCeiling,
              validFrom: at,
              operation: "GRANT",
              effect: "ALLOW",
              reason: body.reason,
            },
            input.requestKey,
          );
        }
      }
      await manager.query(
        "UPDATE workspace_memberships SET state='REVOKED',revoked_at=clock_timestamp(),row_version=row_version+1 WHERE workspace_id=$1 AND principal_id=$2 AND revoked_at IS NULL",
        [workspaceId, principalId],
      );
      if (body.roleKeys.length)
        await manager.query(
          "INSERT INTO workspace_memberships(id,workspace_id,principal_id,state,valid_from,row_version) SELECT $1,$2,$3,'ACTIVE',clock_timestamp(),COALESCE(MAX(row_version),0)+1 FROM workspace_memberships WHERE workspace_id=$2 AND principal_id=$3",
          [randomUUID(), workspaceId, principalId],
        );
      await manager.query(
        "UPDATE workspace_access_heads SET version=version+1 WHERE workspace_id=$1 AND principal_id=$2",
        [workspaceId, principalId],
      );
      // A concurrent SERIALIZABLE project registration must retry its old snapshot
      // instead of materializing entitlements from the previous team role set.
      await manager.query("UPDATE workspaces SET row_version=row_version+1 WHERE id=$1", [
        workspaceId,
      ]);
      const after = (await this.memberships(manager, principalId)).find(
        (m) => m.workspaceId === workspaceId,
      )!;
      await manager.query(
        "INSERT INTO platform_access_changes(id,actor_id,target_id,workspace_id,request_key,request_hash,before_json,after_json,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [
          randomUUID(),
          actor.principalId,
          principalId,
          workspaceId,
          input.requestKey,
          requestHash,
          JSON.stringify(before),
          JSON.stringify(after),
          body.reason,
        ],
      );
      return after;
    });
  }
  private async entitlement(
    manager: EntityManager,
    actor: PlatformAccessContext,
    input: Omit<
      ProjectEntitlementRevision,
      "version" | "contentHash" | "revisionId" | "actor" | "correlationId" | "createdAt"
    >,
    requestKey: string,
  ) {
    const [previous] = (await manager.query(
      "SELECT r.revision_id,r.version,r.content_hash FROM project_entitlement_headers h JOIN project_entitlement_revisions r ON r.entitlement_id=h.entitlement_id AND r.version=h.current_version WHERE h.entitlement_id=$1",
      [input.entitlementId],
    )) as { revision_id: string; version: number; content_hash: `sha256:${string}` }[];
    // Adopt legacy unversioned projections into the immutable entitlement journal.
    if (!previous) {
      await manager.query("DELETE FROM project_entitlement_permissions WHERE entitlement_id=$1", [
        input.entitlementId,
      ]);
      await manager.query("DELETE FROM project_entitlements WHERE id=$1", [input.entitlementId]);
    }
    const ref = { id: requestKey, version: 1, contentHash: digest({ actor, input, requestKey }) };
    const revision = createProjectEntitlementRevision({
      ...input,
      version: previous ? previous.version + 1 : 1,
      operation: input.revokedAt ? "REVOKE" : previous ? "REPLACE" : "GRANT",
      revisionId: randomUUID(),
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
        principalId: actor.principalId,
        roleKey: "access-administrator",
        authenticationContextRef: ref,
        authorizationBasisRef: ref,
      },
      correlationId: requestKey,
      createdAt: new Date().toISOString(),
    });
    await new ProjectEntitlementRepository(this.source).appendInTransaction(manager, revision);
  }
  /** Called after a successful local persona exchange, never by seed or an authorization read. */
  async claimLocalAdministrator(principalId: string, issuer: string): Promise<boolean> {
    if (process.env.AWP_RUNTIME_PROFILE !== "local" || issuer !== process.env.AWP_IDENTITY_ISSUER)
      throw new Error("LOCAL_ADMINISTRATOR_BOOTSTRAP_FORBIDDEN");
    return this.source.transaction(async (manager) => {
      await manager.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        "platform-first-local-administrator",
      ]);
      const [principal] = (await manager.query(
        "SELECT id,display_name,subject FROM identities WHERE id=$1 AND issuer=$2 AND kind='HUMAN'",
        [principalId, issuer],
      )) as { id: string; display_name: string; subject: string }[];
      if (!principal) throw new Error("LOCAL_ADMINISTRATOR_IDENTITY_REQUIRED");
      const claimed = (await manager.query(
        "INSERT INTO local_administrator_bootstrap(singleton,principal_id) VALUES(true,$1) ON CONFLICT(singleton) DO NOTHING RETURNING principal_id",
        [principalId],
      )) as { principal_id: string }[];
      if (!claimed.length) return false;
      await manager.query(
        "INSERT INTO platform_user_profiles(principal_id,display_name,username) VALUES($1,$2,$3) ON CONFLICT(principal_id) DO NOTHING",
        [principalId, principal.display_name, principal.subject],
      );
      await manager.query(
        "INSERT INTO platform_role_assignments(principal_id,role_key,source) VALUES($1,'access-administrator','LOCAL_FIRST_LOGIN')",
        [principalId],
      );
      return true;
    });
  }

  /** Called only after verifier and configured corporate admission policy succeed. */
  async registerVerified(evidence: VerifiedOidcIdentity): Promise<void> {
    await this.source.transaction(async (manager) => {
      // Shared across API replicas and issuers in this database, including upgrades.
      await manager.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        "platform-first-corporate-administrator",
      ]);
      const name = evidence.displayName ?? evidence.username ?? evidence.subject;
      const [identity] = (await manager.query(
        `INSERT INTO identities(id,issuer,subject,kind,display_name) VALUES($1,$2,$3,'HUMAN',$4)
        ON CONFLICT(issuer,subject) DO UPDATE SET display_name=EXCLUDED.display_name WHERE identities.kind='HUMAN' RETURNING id`,
        [randomUUID(), evidence.issuer, evidence.subject, name],
      )) as { id: string }[];
      if (!identity) throw new Error("CORPORATE_IDENTITY_DENIED");
      await manager.query(
        `INSERT INTO platform_user_profiles(principal_id,display_name,username,last_authenticated_at) VALUES($1,$2,$3,clock_timestamp())
        ON CONFLICT(principal_id) DO UPDATE SET display_name=EXCLUDED.display_name,username=EXCLUDED.username,last_authenticated_at=EXCLUDED.last_authenticated_at`,
        [identity.id, name, evidence.username ?? evidence.subject],
      );
      const claimed = (await manager.query(
        `INSERT INTO platform_administrator_bootstrap(singleton,principal_id,source)
        SELECT true,$1,'CORPORATE_FIRST_LOGIN'
        WHERE NOT EXISTS(SELECT 1 FROM platform_role_assignments WHERE source NOT IN ('LOCAL_BOOTSTRAP','LOCAL_FIRST_LOGIN'))
        ON CONFLICT(singleton) DO NOTHING RETURNING principal_id`,
        [identity.id],
      )) as { principal_id: string }[];
      if (claimed.length) {
        await manager.query(
          `INSERT INTO platform_role_assignments(principal_id,role_key,source) VALUES($1,'access-administrator','CORPORATE_FIRST_LOGIN')`,
          [identity.id],
        );
        await grantInitialQaAdministrator(manager, identity.id);
      }
    });
  }
}
