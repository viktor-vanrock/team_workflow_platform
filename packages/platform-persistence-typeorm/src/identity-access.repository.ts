import type { DataSource } from "typeorm";

import type {
  AuthorizationFacts,
  Identity,
  IdentityRepositoryPort,
  Project,
  ResourceScope,
  ScopedAccessRepositoryPort,
  Uuid,
  Workspace,
} from "@awp/platform-core";

type Row = Record<string, unknown>;
const date = (value: unknown): Date => (value instanceof Date ? value : new Date(String(value)));
const strings = (value: unknown): ReadonlySet<string> =>
  new Set(Array.isArray(value) ? value.map(String) : []);

export class TypeOrmIdentityRepository implements IdentityRepositoryPort {
  constructor(private readonly dataSource: DataSource) {}
  async findByVerifiedSubject(issuer: string, subject: string): Promise<Identity | undefined> {
    const rows = (await this.dataSource.query(
      "SELECT id,issuer,subject,kind,display_name FROM identities WHERE issuer=$1 AND subject=$2",
      [issuer, subject],
    )) as Row[];
    const row = rows[0];
    return row
      ? {
          id: String(row.id),
          issuer: String(row.issuer),
          subject: String(row.subject),
          kind: row.kind === "SERVICE" ? "SERVICE" : "HUMAN",
          displayName: String(row.display_name),
        }
      : undefined;
  }
}

export class TypeOrmScopedAccessRepository implements ScopedAccessRepositoryPort {
  constructor(private readonly dataSource: Pick<DataSource, "query">) {}

  async getWorkspace(
    scope: Extract<ResourceScope, { kind: "WORKSPACE" }>,
  ): Promise<Workspace | undefined> {
    const rows = (await this.dataSource.query(
      "SELECT id,key,name,state FROM workspaces WHERE id=$1",
      [scope.workspaceId],
    )) as Row[];
    const row = rows[0];
    return row
      ? {
          id: String(row.id),
          key: String(row.key),
          name: String(row.name),
          state: row.state === "ACTIVE" ? "ACTIVE" : "SUSPENDED",
        }
      : undefined;
  }

  async getProject(
    scope: Extract<ResourceScope, { kind: "PROJECT" }>,
  ): Promise<Project | undefined> {
    const rows = (await this.dataSource.query(
      `SELECT p.id,p.workspace_id,p.key,p.state,p.classification_key,c.rank
      FROM projects p JOIN classification_catalog c ON c.key=p.classification_key WHERE p.workspace_id=$1 AND p.id=$2`,
      [scope.workspaceId, scope.projectId],
    )) as Row[];
    return this.#project(rows[0]);
  }

  async authorizationFacts(
    scope: ResourceScope,
    principalId: Uuid,
    at: Date,
  ): Promise<AuthorizationFacts> {
    const memberships = (await this.dataSource.query(
      `SELECT id,workspace_id,principal_id,state,valid_from,valid_until,revoked_at,row_version
      FROM workspace_memberships WHERE workspace_id=$1 AND principal_id=$2 AND valid_from <= $3 ORDER BY row_version DESC LIMIT 1`,
      [scope.workspaceId, principalId, at],
    )) as Row[];
    const roleRows = (await this.dataSource.query(
      `SELECT id,workspace_id,project_id,principal_id,role_key,effect,permissions,valid_from,valid_until,revoked_at,row_version
      FROM role_assignments WHERE workspace_id=$1 AND principal_id=$2 AND (project_id IS NULL OR project_id=$3)`,
      [scope.workspaceId, principalId, scope.kind === "PROJECT" ? scope.projectId : null],
    )) as Row[];
    const entitlementRows =
      scope.kind === "PROJECT"
        ? ((await this.dataSource.query(
            `SELECT e.*,c.rank FROM project_entitlements e
      JOIN classification_catalog c ON c.key=e.classification_ceiling_key
      WHERE e.workspace_id=$1 AND e.project_id=$2 AND e.principal_id=$3`,
            [scope.workspaceId, scope.projectId, principalId],
          )) as Row[])
        : [];
    const membershipRow = memberships[0];
    return {
      ...(membershipRow
        ? {
            membership: {
              ref: { id: String(membershipRow.id), version: Number(membershipRow.row_version) },
              workspaceId: String(membershipRow.workspace_id),
              principalId: String(membershipRow.principal_id),
              state: String(membershipRow.state) as "ACTIVE" | "SUSPENDED" | "REVOKED",
              validFrom: date(membershipRow.valid_from),
              ...(membershipRow.valid_until ? { validUntil: date(membershipRow.valid_until) } : {}),
              ...(membershipRow.revoked_at ? { revokedAt: date(membershipRow.revoked_at) } : {}),
            },
          }
        : {}),
      entitlements: entitlementRows.map((row) => ({
        ref: { id: String(row.id), version: Number(row.row_version) },
        workspaceId: String(row.workspace_id),
        projectId: String(row.project_id),
        principalId: String(row.principal_id),
        effect: row.effect === "DENY" ? "DENY" : "ALLOW",
        permissions: strings(row.permissions),
        classificationCeiling: {
          key: String(row.classification_ceiling_key),
          rank: Number(row.rank),
        },
        validFrom: date(row.valid_from),
        ...(row.valid_until ? { validUntil: date(row.valid_until) } : {}),
        ...(row.revoked_at ? { revokedAt: date(row.revoked_at) } : {}),
      })),
      roleAssignments: roleRows.map((row) => ({
        ref: { id: String(row.id), version: Number(row.row_version) },
        workspaceId: String(row.workspace_id),
        ...(row.project_id ? { projectId: String(row.project_id) } : {}),
        principalId: String(row.principal_id),
        roleKey: String(row.role_key),
        effect: row.effect === "DENY" ? "DENY" : "ALLOW",
        permissions: strings(row.permissions),
        validFrom: date(row.valid_from),
        ...(row.valid_until ? { validUntil: date(row.valid_until) } : {}),
        ...(row.revoked_at ? { revokedAt: date(row.revoked_at) } : {}),
      })),
    };
  }

  async listVisibleProjects(
    workspaceId: Uuid,
    principalId: Uuid,
    at: Date,
  ): Promise<readonly Project[]> {
    const rows = (await this.dataSource.query(
      `SELECT DISTINCT p.id,p.workspace_id,p.key,p.state,p.classification_key,c.rank
      FROM projects p JOIN classification_catalog c ON c.key=p.classification_key
      JOIN project_entitlements e ON (e.workspace_id,e.project_id)=(p.workspace_id,p.id)
      WHERE p.workspace_id=$1 AND e.principal_id=$2 AND e.effect='ALLOW' AND e.revoked_at IS NULL
        AND e.valid_from <= $3 AND (e.valid_until IS NULL OR e.valid_until > $3)
        AND EXISTS (SELECT 1 FROM role_assignments r WHERE r.workspace_id=p.workspace_id AND r.principal_id=$2
          AND (r.project_id=p.id OR (r.project_id IS NULL AND r.role_key<>'requester'))
          AND r.effect='ALLOW' AND r.revoked_at IS NULL AND r.valid_from<=$3 AND (r.valid_until IS NULL OR r.valid_until>$3))
        AND NOT EXISTS (SELECT 1 FROM project_entitlements d WHERE d.workspace_id=p.workspace_id AND d.project_id=p.id AND d.principal_id=$2 AND d.effect='DENY' AND d.revoked_at IS NULL AND d.valid_from <= $3 AND (d.valid_until IS NULL OR d.valid_until > $3))`,
      [workspaceId, principalId, at],
    )) as Row[];
    return rows
      .map((row) => this.#project(row))
      .filter((project): project is Project => project !== undefined);
  }

  #project(row: Row | undefined): Project | undefined {
    if (!row) return undefined;
    return {
      id: String(row.id),
      workspaceId: String(row.workspace_id),
      key: String(row.key),
      state: String(row.state) as Project["state"],
      classification: { key: String(row.classification_key), rank: Number(row.rank) },
    };
  }
}
