import type { DataSource } from "typeorm";

import type { Project, ResourceScope } from "@awp/platform-core";

import { TypeOrmScopedAccessRepository } from "./identity-access.repository.ts";

/** Corporate hosts install the onboarding migrations. Operational suspension has
 * its own canonical head and must narrow the older registry state immediately. */
export class TypeOrmCorporateScopedAccessRepository extends TypeOrmScopedAccessRepository {
  constructor(private readonly source: Pick<DataSource, "query">) {
    super(source);
  }
  override async getProject(
    scope: Extract<ResourceScope, { kind: "PROJECT" }>,
  ): Promise<Project | undefined> {
    const project = await super.getProject(scope);
    if (!project || project.state !== "ACTIVE") return project;
    const rows = (await this.source.query(
      "SELECT current_operational_state FROM project_onboarding_headers WHERE workspace_id=$1 AND project_id=$2",
      [scope.workspaceId, scope.projectId],
    )) as { current_operational_state: string }[];
    if (rows[0] && !["ACTIVE", "SUSPENDED"].includes(rows[0].current_operational_state))
      throw new Error("PROJECT_OPERATIONAL_STATE_INVALID");
    return rows[0]?.current_operational_state === "SUSPENDED"
      ? { ...project, state: "SUSPENDED" }
      : project;
  }
}
