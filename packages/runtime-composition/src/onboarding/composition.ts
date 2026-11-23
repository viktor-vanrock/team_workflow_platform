import type { EntitySchema } from "typeorm";

import {
  EvidenceIntegrityRepository,
  EvidenceSigningUnitOfWork,
  qaEntityContributions,
  qaMigrationContributions,
  qaOnboardingOperationCatalog,
  QaProjectResourceRepository,
  TestAccountLeaseRepository,
} from "@awp/competency-qa/node";
import {
  type OnboardingOperationAuthorization,
  onboardingOperationCatalog,
} from "@awp/platform-core";
import {
  ArtifactRetentionRepository,
  coreMigrationRegistry,
  EvidenceExportRepository,
  onboardingFoundationEntities,
  type OwnedMigration,
  ProjectBindingRepository,
  ProjectEntitlementRepository,
  ProjectOnboardingRepository,
} from "@awp/platform-persistence-typeorm";

export const onboardingRuntimeOperationCatalog: readonly OnboardingOperationAuthorization[] =
  Object.freeze([
    ...onboardingOperationCatalog,
    ...qaOnboardingOperationCatalog.map(
      ([operation, permission, scope, actionClass, requiresHuman, stepUpRequired]) =>
        Object.freeze({ operation, permission, scope, actionClass, requiresHuman, stepUpRequired }),
    ),
  ]);

export interface HistoricalProjectSeed {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly key: string;
  readonly name: string;
}

export interface HistoricalOnboardingProjection extends HistoricalProjectSeed {
  readonly version: 1;
  readonly stage: "DRAFT";
  readonly qaCapabilityMode: "MANUAL_ONLY";
  readonly operationalState: "ACTIVE";
  readonly gateResultRefs: readonly [];
  readonly bootstrapReason: "HISTORICAL_BOOTSTRAP";
  readonly createdAt: string;
}

/** Deterministic, conservative projection for Projects that predate Feature 007. */
export function bootstrapHistoricalProjects(
  projects: readonly HistoricalProjectSeed[],
  now: string,
): readonly HistoricalOnboardingProjection[] {
  return Object.freeze(
    [...projects]
      .sort((left, right) =>
        `${left.workspaceId}\u0000${left.projectId}`.localeCompare(
          `${right.workspaceId}\u0000${right.projectId}`,
        ),
      )
      .map((project) =>
        Object.freeze({
          ...project,
          version: 1 as const,
          stage: "DRAFT" as const,
          qaCapabilityMode: "MANUAL_ONLY" as const,
          operationalState: "ACTIVE" as const,
          gateResultRefs: Object.freeze([]) as readonly [],
          bootstrapReason: "HISTORICAL_BOOTSTRAP" as const,
          createdAt: now,
        }),
      ),
  );
}

const coreOrders = new Set([150, 155, 160]);
const qaOrders = new Set([2080, 2085]);

export const onboardingFoundationMigrationRegistry: readonly OwnedMigration[] = Object.freeze([
  ...coreMigrationRegistry.filter(({ order }) => coreOrders.has(order)),
  ...qaMigrationContributions.filter(({ order }) => qaOrders.has(order)),
]);

export const onboardingFoundationQaEntities: readonly EntitySchema[] = Object.freeze(
  qaEntityContributions
    .filter(({ migrationOrder }) => qaOrders.has(migrationOrder))
    .map(({ entity }) => entity as EntitySchema),
);

export const onboardingLocalComposition = Object.freeze({
  key: "project-onboarding-foundation" as const,
  operations: onboardingRuntimeOperationCatalog,
  migrations: onboardingFoundationMigrationRegistry,
  entities: Object.freeze([...onboardingFoundationEntities, ...onboardingFoundationQaEntities]),
  repositories: Object.freeze({
    projectOnboarding: ProjectOnboardingRepository,
    projectEntitlement: ProjectEntitlementRepository,
    projectBinding: ProjectBindingRepository,
    artifactRetention: ArtifactRetentionRepository,
    evidenceExport: EvidenceExportRepository,
    projectResource: QaProjectResourceRepository,
    testAccountLease: TestAccountLeaseRepository,
    evidenceIntegrity: EvidenceIntegrityRepository,
    evidenceSigning: EvidenceSigningUnitOfWork,
  }),
});
