import type { DataSource, EntityManager } from "typeorm";

import type { ProjectEntitlementRevision, ProjectScope } from "@awp/platform-core";

export interface ProjectAuthorizationWitness extends ProjectScope {
  readonly principalId: string;
  readonly permission: string;
  readonly evaluatedAt: string;
  readonly entitlementRefs: readonly Readonly<{ id: string; version: number }>[];
  readonly deniedRefs: readonly Readonly<{ id: string; version: number }>[];
  readonly classificationCeilingKeys: readonly string[];
}

function permits(
  revision: ProjectEntitlementRevision,
  principalId: string,
  permission: string,
  at: Date,
): boolean {
  const validFrom = Date.parse(revision.validFrom);
  const validUntil =
    revision.validUntil === undefined ? Number.POSITIVE_INFINITY : Date.parse(revision.validUntil);
  return (
    revision.principalId === principalId &&
    validFrom <= at.getTime() &&
    validUntil > at.getTime() &&
    revision.revokedAt === undefined &&
    (revision.permissions.includes(permission) || revision.permissions.includes("*"))
  );
}

function witness(
  scope: ProjectScope,
  principalId: string,
  permission: string,
  at: Date,
  revisions: readonly ProjectEntitlementRevision[],
): ProjectAuthorizationWitness {
  const applicable = revisions.filter((revision) => permits(revision, principalId, permission, at));
  const refs = (effect: "ALLOW" | "DENY") =>
    applicable
      .filter((revision) => revision.effect === effect)
      .map(({ entitlementId: id, version }) => Object.freeze({ id, version }))
      .sort((left, right) => left.id.localeCompare(right.id));
  return Object.freeze({
    ...scope,
    principalId,
    permission,
    evaluatedAt: at.toISOString(),
    entitlementRefs: Object.freeze(refs("ALLOW")),
    deniedRefs: Object.freeze(refs("DENY")),
    classificationCeilingKeys: Object.freeze(
      [
        ...new Set(
          applicable
            .filter(({ effect }) => effect === "ALLOW")
            .map(({ classificationCeilingKey }) => classificationCeilingKey),
        ),
      ].sort(),
    ),
  });
}

function key(scope: ProjectScope, entitlementId: string): string {
  return `${scope.workspaceId}:${scope.projectId}:${entitlementId}`;
}
function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryProjectEntitlementRepository {
  readonly #revisions = new Map<string, ProjectEntitlementRevision[]>();

  async append(revision: ProjectEntitlementRevision): Promise<void> {
    const storageKey = key(revision, revision.entitlementId);
    const current = this.#revisions.get(storageKey) ?? [];
    if (
      current.some(
        ({ revisionId, version }) =>
          revisionId === revision.revisionId || version === revision.version,
      )
    ) {
      throw new Error("PROJECT_ENTITLEMENT_REVISION_IMMUTABLE");
    }
    if (revision.version !== current.length + 1) throw new Error("PROJECT_ENTITLEMENT_VERSION_GAP");
    this.#revisions.set(storageKey, [...current, clone(revision)]);
  }

  async current(
    scope: ProjectScope,
    entitlementId: string,
  ): Promise<ProjectEntitlementRevision | undefined> {
    return clone(this.#revisions.get(key(scope, entitlementId))?.at(-1));
  }

  async currentAuthorizationWitness(
    scope: ProjectScope,
    principalId: string,
    permission: string,
    at: Date,
  ): Promise<ProjectAuthorizationWitness> {
    const current = [...this.#revisions.entries()]
      .filter(([storageKey]) => storageKey.startsWith(`${scope.workspaceId}:${scope.projectId}:`))
      .flatMap(([, revisions]) => revisions.at(-1) ?? []);
    return witness(scope, principalId, permission, at, current);
  }
}

export class ProjectEntitlementRepository {
  constructor(private readonly source: DataSource) {}

  async append(revision: ProjectEntitlementRevision): Promise<void> {
    await this.source.transaction("SERIALIZABLE", (manager) =>
      this.appendInTransaction(manager, revision),
    );
  }

  async appendInTransaction(
    manager: EntityManager,
    revision: ProjectEntitlementRevision,
  ): Promise<void> {
    const rows = (await manager.query(
      "SELECT current_version FROM project_entitlement_headers WHERE workspace_id=$1 AND project_id=$2 AND entitlement_id=$3 FOR UPDATE",
      [revision.workspaceId, revision.projectId, revision.entitlementId],
    )) as readonly { current_version: number }[];
    const currentVersion = rows[0]?.current_version ?? 0;
    if (revision.version !== currentVersion + 1)
      throw new Error("PROJECT_ENTITLEMENT_VERSION_CONFLICT");
    if (currentVersion === 0) {
      await manager.query(
        `INSERT INTO project_entitlement_headers(entitlement_id,workspace_id,project_id,principal_id,current_version,current_effect,current_permissions,classification_ceiling_key,valid_from,valid_until,revoked_at,row_version)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,1)`,
        [
          revision.entitlementId,
          revision.workspaceId,
          revision.projectId,
          revision.principalId,
          revision.version,
          revision.effect,
          JSON.stringify(revision.permissions),
          revision.classificationCeilingKey,
          revision.validFrom,
          revision.validUntil ?? null,
          revision.revokedAt ?? null,
        ],
      );
      await manager.query(
        `INSERT INTO project_entitlements(id,workspace_id,project_id,principal_id,effect,classification_ceiling_key,permissions,valid_from,valid_until,revoked_at,current_version,row_version,created_at)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,1,$12)`,
        [
          revision.entitlementId,
          revision.workspaceId,
          revision.projectId,
          revision.principalId,
          revision.effect,
          revision.classificationCeilingKey,
          JSON.stringify(revision.permissions),
          revision.validFrom,
          revision.validUntil ?? null,
          revision.revokedAt ?? null,
          revision.version,
          revision.createdAt,
        ],
      );
    } else {
      await manager.query(
        `UPDATE project_entitlement_headers SET current_version=$4,current_effect=$5,current_permissions=$6,classification_ceiling_key=$7,
             valid_from=$8,valid_until=$9,revoked_at=$10,row_version=row_version+1
           WHERE workspace_id=$1 AND project_id=$2 AND entitlement_id=$3 AND current_version=$11`,
        [
          revision.workspaceId,
          revision.projectId,
          revision.entitlementId,
          revision.version,
          revision.effect,
          JSON.stringify(revision.permissions),
          revision.classificationCeilingKey,
          revision.validFrom,
          revision.validUntil ?? null,
          revision.revokedAt ?? null,
          currentVersion,
        ],
      );
      await manager.query(
        `UPDATE project_entitlements SET effect=$4,classification_ceiling_key=$5,permissions=$6,valid_from=$7,valid_until=$8,
             revoked_at=$9,current_version=$10,row_version=row_version+1
           WHERE workspace_id=$1 AND project_id=$2 AND id=$3`,
        [
          revision.workspaceId,
          revision.projectId,
          revision.entitlementId,
          revision.effect,
          revision.classificationCeilingKey,
          JSON.stringify(revision.permissions),
          revision.validFrom,
          revision.validUntil ?? null,
          revision.revokedAt ?? null,
          revision.version,
        ],
      );
      await manager.query("DELETE FROM project_entitlement_permissions WHERE entitlement_id=$1", [
        revision.entitlementId,
      ]);
    }
    await manager.query(
      `INSERT INTO project_entitlement_revisions(revision_id,entitlement_id,version,workspace_id,project_id,principal_id,operation,effect,permissions,classification_ceiling_key,valid_from,valid_until,revoked_at,previous_revision_id,previous_version,previous_content_hash,actor,reason,correlation_id,created_at,semantic_body,content_hash)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
      [
        revision.revisionId,
        revision.entitlementId,
        revision.version,
        revision.workspaceId,
        revision.projectId,
        revision.principalId,
        revision.operation,
        revision.effect,
        JSON.stringify(revision.permissions),
        revision.classificationCeilingKey,
        revision.validFrom,
        revision.validUntil ?? null,
        revision.revokedAt ?? null,
        revision.previousRevisionRef?.id ?? null,
        revision.previousRevisionRef?.version ?? null,
        revision.previousRevisionRef?.contentHash ?? null,
        JSON.stringify(revision.actor),
        revision.reason,
        revision.correlationId,
        revision.createdAt,
        JSON.stringify(revision),
        revision.contentHash,
      ],
    );
    for (const permission of revision.permissions) {
      await manager.query(
        "INSERT INTO project_entitlement_permissions(entitlement_id,permission_key) VALUES($1,$2)",
        [revision.entitlementId, permission],
      );
    }
    await manager.query(
      `INSERT INTO audit_events(id,workspace_id,project_id,occurred_at,actor,action,outcome,reason_code,correlation_id,causation_id,authorization_basis,classification_key,attributes)
         VALUES(gen_random_uuid(),$1,$2,$3,$4,'PROJECT_ENTITLEMENT_CHANGED','SUCCEEDED',$5,$6,$6,$7,$8,$9)`,
      [
        revision.workspaceId,
        revision.projectId,
        revision.createdAt,
        JSON.stringify(revision.actor),
        revision.operation,
        revision.correlationId,
        JSON.stringify(revision.actor.authorizationBasisRef),
        revision.classificationCeilingKey,
        JSON.stringify({
          entitlementId: revision.entitlementId,
          version: revision.version,
          contentHash: revision.contentHash,
        }),
      ],
    );
  }

  async current(
    scope: ProjectScope,
    entitlementId: string,
  ): Promise<ProjectEntitlementRevision | undefined> {
    const rows = (await this.source.query(
      `SELECT r.semantic_body FROM project_entitlement_headers h
       JOIN project_entitlement_revisions r ON r.workspace_id=h.workspace_id AND r.project_id=h.project_id
        AND r.entitlement_id=h.entitlement_id AND r.version=h.current_version
       WHERE h.workspace_id=$1 AND h.project_id=$2 AND h.entitlement_id=$3`,
      [scope.workspaceId, scope.projectId, entitlementId],
    )) as readonly { semantic_body: ProjectEntitlementRevision }[];
    return rows[0]?.semantic_body;
  }

  async currentAuthorizationWitness(
    scope: ProjectScope,
    principalId: string,
    permission: string,
    at: Date,
  ): Promise<ProjectAuthorizationWitness> {
    const rows = (await this.source.query(
      `SELECT r.semantic_body FROM project_entitlement_headers h
       JOIN project_entitlement_revisions r ON r.workspace_id=h.workspace_id AND r.project_id=h.project_id
        AND r.entitlement_id=h.entitlement_id AND r.version=h.current_version
       WHERE h.workspace_id=$1 AND h.project_id=$2 AND h.principal_id=$3
         AND h.valid_from<=$4 AND (h.valid_until IS NULL OR h.valid_until>$4) AND h.revoked_at IS NULL
         AND (h.current_permissions::jsonb ? $5 OR h.current_permissions::jsonb ? '*')`,
      [scope.workspaceId, scope.projectId, principalId, at.toISOString(), permission],
    )) as readonly { semantic_body: ProjectEntitlementRevision }[];
    return witness(
      scope,
      principalId,
      permission,
      at,
      rows.map(({ semantic_body }) => semantic_body),
    );
  }
}
