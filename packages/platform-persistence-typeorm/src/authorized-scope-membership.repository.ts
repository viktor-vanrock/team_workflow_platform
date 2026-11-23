import type { DataSource, EntityManager } from "typeorm";

import { authorizedProjectSetHash, type ResourceScope } from "@awp/platform-core";

export type ScopeMembershipKind = "POLICY_FACET" | "CAPACITY_PROJECTION" | "ORDER_SCOPE";

const tableByKind: Readonly<
  Record<ScopeMembershipKind, Readonly<{ head: string; members: string; id: string }>>
> = Object.freeze({
  POLICY_FACET: {
    head: "authorized_scope_queue_policy_facet_heads",
    members: "authorized_scope_queue_policy_facet_projects",
    id: "authorized_facet_id",
  },
  CAPACITY_PROJECTION: {
    head: "capacity_scope_projection_heads",
    members: "capacity_scope_projection_projects",
    id: "capacity_projection_id",
  },
  ORDER_SCOPE: {
    head: "queue_order_scope_heads",
    members: "queue_order_scope_projects",
    id: "order_scope_id",
  },
});

export class AuthorizedScopeMembershipRepository {
  constructor(private readonly source: DataSource) {}

  async ensureExactMembership(
    input: Readonly<{
      scope: Extract<ResourceScope, { kind: "WORKSPACE" }>;
      kind: ScopeMembershipKind;
      headId: string;
      projectIds: readonly string[];
    }>,
  ): Promise<Readonly<{ authorizedProjectSetHash: string; outcome: "CREATED" | "UNCHANGED" }>> {
    const projectIds = [...new Set(input.projectIds)].sort();
    const setHash = authorizedProjectSetHash(projectIds);
    return await this.source.transaction("SERIALIZABLE", async (manager) => {
      const mapping = tableByKind[input.kind];
      const heads = (await manager.query(
        `SELECT authorized_project_set_hash FROM ${mapping.head} WHERE workspace_id=$1 AND ${mapping.id}=$2 FOR UPDATE`,
        [input.scope.workspaceId, input.headId],
      )) as Array<Record<string, unknown>>;
      if (heads.length !== 1 || heads[0]?.authorized_project_set_hash !== setHash) {
        throw new Error("AUTHORIZED_SCOPE_HEAD_HASH_MISMATCH");
      }
      const existing = await this.members(manager, mapping, input.scope.workspaceId, input.headId);
      if (existing.length > 0) {
        if (
          existing.length !== projectIds.length ||
          existing.some((value, index) => value !== projectIds[index])
        ) {
          throw new Error("AUTHORIZED_SCOPE_MEMBERSHIP_HASH_MISMATCH");
        }
        return Object.freeze({ authorizedProjectSetHash: setHash, outcome: "UNCHANGED" as const });
      }
      for (const projectId of projectIds) {
        await manager.query(
          `INSERT INTO ${mapping.members}(workspace_id,${mapping.id},project_id) VALUES($1,$2,$3)`,
          [input.scope.workspaceId, input.headId, projectId],
        );
      }
      const persisted = await this.members(manager, mapping, input.scope.workspaceId, input.headId);
      if (authorizedProjectSetHash(persisted) !== setHash)
        throw new Error("AUTHORIZED_SCOPE_MEMBERSHIP_REHASH_FAILED");
      return Object.freeze({ authorizedProjectSetHash: setHash, outcome: "CREATED" as const });
    });
  }

  async projectMemberships(
    scope: Extract<ResourceScope, { kind: "WORKSPACE" }>,
    kind: ScopeMembershipKind,
    projectId: string,
  ): Promise<readonly string[]> {
    const mapping = tableByKind[kind];
    const rows = (await this.source.query(
      `SELECT ${mapping.id} AS head_id FROM ${mapping.members} WHERE workspace_id=$1 AND project_id=$2 ORDER BY ${mapping.id}`,
      [scope.workspaceId, projectId],
    )) as Array<Record<string, unknown>>;
    return Object.freeze(rows.map(({ head_id }) => String(head_id)));
  }

  private async members(
    manager: EntityManager,
    mapping: Readonly<{ members: string; id: string }>,
    workspaceId: string,
    headId: string,
  ): Promise<readonly string[]> {
    const rows = (await manager.query(
      `SELECT project_id FROM ${mapping.members} WHERE workspace_id=$1 AND ${mapping.id}=$2 ORDER BY project_id COLLATE "C"`,
      [workspaceId, headId],
    )) as Array<Record<string, unknown>>;
    return rows.map(({ project_id }) => String(project_id));
  }
}
