import type { VersionedReference } from "../shared/primitives.ts";
import type { ProjectScope } from "./primitives.ts";

export type ProjectOperationClass = "READ" | "MUTATE" | "EFFECT";

export interface AuthorizedProjectGrant {
  readonly projectId: string;
  readonly classificationCeilingRank: number;
  readonly operationalState: "ACTIVE" | "SUSPENDED";
  readonly entitlementRef: VersionedReference;
}

export class AuthorizedProjectQueryToken {
  readonly workspaceId: string;
  readonly principalId: string;
  readonly permission: string;
  readonly issuedAt: string;
  readonly projects: readonly AuthorizedProjectGrant[];

  private constructor(
    input: Readonly<{
      workspaceId: string;
      principalId: string;
      permission: string;
      projects: readonly AuthorizedProjectGrant[];
      issuedAt: string | Date;
    }>,
  ) {
    this.workspaceId = input.workspaceId;
    this.principalId = input.principalId;
    this.permission = input.permission;
    this.issuedAt = new Date(input.issuedAt).toISOString();
    this.projects = Object.freeze(
      [...input.projects]
        .sort((left, right) => left.projectId.localeCompare(right.projectId))
        .map((project) =>
          Object.freeze({
            ...project,
            entitlementRef: Object.freeze({ ...project.entitlementRef }),
          }),
        ),
    );
    Object.freeze(this);
  }

  static issue(
    input: Readonly<{
      workspaceId: string;
      principalId: string;
      permission: string;
      projects: readonly AuthorizedProjectGrant[];
      issuedAt: string | Date;
    }>,
  ): AuthorizedProjectQueryToken {
    if (
      !input.workspaceId ||
      !input.principalId ||
      !input.permission ||
      Number.isNaN(new Date(input.issuedAt).getTime())
    ) {
      throw new Error("AUTHORIZED_PROJECT_QUERY_TOKEN_INVALID");
    }
    const ids = input.projects.map(({ projectId }) => projectId);
    if (ids.some((id) => !id) || new Set(ids).size !== ids.length)
      throw new Error("AUTHORIZED_PROJECT_QUERY_TOKEN_INVALID");
    return new AuthorizedProjectQueryToken(input);
  }

  get projectIds(): readonly string[] {
    return this.projects.map(({ projectId }) => projectId);
  }

  get visibilityHash(): string {
    return this.projects
      .map(
        ({ projectId, entitlementRef }) =>
          `${projectId}@${entitlementRef.id}:${entitlementRef.version}`,
      )
      .join("|");
  }

  allows(
    projectId: string,
    classificationRank: number,
    operationClass: ProjectOperationClass,
  ): boolean {
    const grant = this.projects.find((candidate) => candidate.projectId === projectId);
    return (
      grant !== undefined &&
      classificationRank <= grant.classificationCeilingRank &&
      (operationClass === "READ" || grant.operationalState === "ACTIVE")
    );
  }

  assert(
    projectId: string,
    classificationRank = 0,
    operationClass: ProjectOperationClass = "READ",
  ): void {
    if (!this.allows(projectId, classificationRank, operationClass))
      throw new Error("PROJECT_RESOURCE_NOT_AVAILABLE");
  }
}

export function assertSameProjectResourceScope(
  scope: ProjectScope,
  resource: Readonly<{ workspaceId: string; projectId: string }>,
): void {
  if (resource.workspaceId !== scope.workspaceId || resource.projectId !== scope.projectId) {
    throw new Error("CROSS_PROJECT_REFERENCE_FORBIDDEN");
  }
}
