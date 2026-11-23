export const connectorGitLabPersistenceTypeOrmPackage = Object.freeze({
  key: "gitlab.automated-validation.persistence.typeorm",
  version: "1.0.0",
});

export * from "./entities.ts";
export * from "./migrations/index.ts";
export * from "./repositories/gitlab-artifact.repository.ts";
export * from "./repositories/gitlab-configuration.repository.ts";
export * from "./repositories/gitlab-effect.repository.ts";
export * from "./repositories/gitlab-reconciliation.repository.ts";
export * from "./repositories/repository-helpers.ts";
