import type { DataSource, EntityManager } from "typeorm";

import type { ResourceScope } from "@awp/platform-core";

type QuerySource = Pick<DataSource | EntityManager, "query">;

export abstract class ScopedRepositoryBase {
  constructor(protected readonly source: DataSource) {}

  protected async projectRows<TRow>(
    scope: Extract<ResourceScope, { kind: "PROJECT" }>,
    statement: string,
    parameters: readonly unknown[] = [],
    querySource: QuerySource = this.source,
  ): Promise<readonly TRow[]> {
    this.assertProjectScope(scope);
    return (await querySource.query(statement, [
      scope.workspaceId,
      scope.projectId,
      ...parameters,
    ])) as readonly TRow[];
  }

  protected async workspaceRows<TRow>(
    scope: Extract<ResourceScope, { kind: "WORKSPACE" }>,
    statement: string,
    parameters: readonly unknown[] = [],
    querySource: QuerySource = this.source,
  ): Promise<readonly TRow[]> {
    this.assertWorkspaceScope(scope);
    return (await querySource.query(statement, [
      scope.workspaceId,
      ...parameters,
    ])) as readonly TRow[];
  }

  protected assertEntityScope(
    scope: Extract<ResourceScope, { kind: "PROJECT" }>,
    entity: Readonly<{ workspaceId: string; projectId: string }>,
  ): void {
    this.assertProjectScope(scope);
    if (entity.workspaceId !== scope.workspaceId || entity.projectId !== scope.projectId)
      throw new Error("SCOPED_REPOSITORY_ENTITY_MISMATCH");
  }

  private assertProjectScope(scope: Extract<ResourceScope, { kind: "PROJECT" }>): void {
    if (scope.kind !== "PROJECT" || scope.workspaceId.length === 0 || scope.projectId.length === 0)
      throw new Error("PROJECT_SCOPE_REQUIRED");
  }

  private assertWorkspaceScope(scope: Extract<ResourceScope, { kind: "WORKSPACE" }>): void {
    if (scope.kind !== "WORKSPACE" || scope.workspaceId.length === 0)
      throw new Error("WORKSPACE_SCOPE_REQUIRED");
  }
}
