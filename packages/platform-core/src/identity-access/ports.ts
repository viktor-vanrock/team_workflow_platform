import type { ResourceScope, Uuid } from "../shared/primitives.ts";
import type { AuthorizationFacts, Identity, Project, Workspace } from "./model.ts";

export interface IdentityRepositoryPort {
  findByVerifiedSubject(issuer: string, subject: string): Promise<Identity | undefined>;
}

export interface ScopedAccessRepositoryPort {
  getWorkspace(
    scope: Extract<ResourceScope, { kind: "WORKSPACE" }>,
  ): Promise<Workspace | undefined>;
  getProject(scope: Extract<ResourceScope, { kind: "PROJECT" }>): Promise<Project | undefined>;
  authorizationFacts(
    scope: ResourceScope,
    principalId: Uuid,
    at: Date,
  ): Promise<AuthorizationFacts>;
  listVisibleProjects(workspaceId: Uuid, principalId: Uuid, at: Date): Promise<readonly Project[]>;
}

export interface ScopedEntityRepositoryPort<TEntity> {
  get(scope: Extract<ResourceScope, { kind: "PROJECT" }>, id: Uuid): Promise<TEntity | undefined>;
  save(scope: Extract<ResourceScope, { kind: "PROJECT" }>, entity: TEntity): Promise<void>;
}
