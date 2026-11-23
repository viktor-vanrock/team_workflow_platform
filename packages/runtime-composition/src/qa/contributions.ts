import type { EntityManager } from "typeorm";

import {
  createQaArtifactAuthorizationContribution,
  createQaCompletionCommandLifecycleContribution,
  createQaDefectCommandLifecycleContribution,
  createQaFindingActionContribution,
  createQaPlanItemWaiverActionContribution,
  createQaReadinessCommandLifecycleContribution,
  createQaReadinessWaiverActionContribution,
  createQaTypeOrmCompletionConfirmationHook,
  createQaTypeOrmDefectConfirmationHook,
  createQaVerdictCosignActionContribution,
  NativeQaSessionRetestLineageResolver,
  qaCompetencyManifest,
  qaCompetencyManifestV11,
  qaCompetencyManifestV12,
  qaCompetencyManifestV13,
  qaHookContributionDeclarations,
  qaPermissionDeclarations,
  type QaReadinessCommandLifecycleStore,
  QaUs2RetestLineageResolver,
  TypeOrmQaDefectCommandLifecycleStore,
} from "@awp/competency-qa/node";
import type { StaticExtensionCandidate } from "@awp/platform-core";

import type { GenericPolicyContributions } from "../extensions/generic-contributions.ts";
import type { GenericHandlerContributions } from "../extensions/generic-handlers.ts";
import { createDurableQaCompletionInvalidator } from "../pilot/completion-invalidation.ts";
import { operationalWorkItemCapabilityCandidate } from "./operational-work-item.contract.ts";

export const qaLocalExtensionContributions = Object.freeze([
  operationalWorkItemCapabilityCandidate,
  Object.freeze({
    sourceComponentRef: "competency-qa.manifest",
    manifestSchemaId: "urn:awp:contracts:extensions:competency-pack-manifest:v1",
    manifest: qaCompetencyManifest,
    required: true,
  }),
  Object.freeze({
    sourceComponentRef: "competency-qa.manifest-v1.1",
    manifestSchemaId: "urn:awp:contracts:extensions:competency-pack-manifest:v1",
    manifest: qaCompetencyManifestV11,
    required: true,
  }),
  Object.freeze({
    sourceComponentRef: "competency-qa.manifest-v1.2",
    manifestSchemaId: "urn:awp:contracts:extensions:competency-pack-manifest:v1",
    manifest: qaCompetencyManifestV12,
    required: true,
  }),
  Object.freeze({
    sourceComponentRef: "competency-qa.manifest-v1.3",
    manifestSchemaId: "urn:awp:contracts:extensions:competency-pack-manifest:v1",
    manifest: qaCompetencyManifestV13,
    required: true,
  }),
] satisfies readonly StaticExtensionCandidate[]);

/** Phase 2 has declarations only; story slices append executable handlers. */
export const qaLocalHandlerContributions: GenericHandlerContributions = Object.freeze({
  confirmationHooks: Object.freeze([]),
  externalCommandLifecycle: Object.freeze([]),
  platformActionHandlers: Object.freeze([]),
});

/** Authorization and artifact policies are installed by their owning story slices. */
export const qaLocalPolicyContributions: GenericPolicyContributions = Object.freeze({
  authorization: Object.freeze([]),
  artifactAuthorization: Object.freeze([createQaArtifactAuthorizationContribution()]),
});

export const qaLocalFoundationDeclarations = Object.freeze({
  permissions: qaPermissionDeclarations,
  hooks: qaHookContributionDeclarations,
});

export function qaUs5MutationInvalidatorContributions(manager: EntityManager) {
  return Object.freeze([createDurableQaCompletionInvalidator(manager)]);
}

export const qaLocalSessionProviders = Object.freeze({
  retestLineageResolver: new QaUs2RetestLineageResolver(),
  nativeQaSessionReviewLineage: Object.freeze({
    available: true,
    kind: "QA_SESSION" as const,
    resolver: NativeQaSessionRetestLineageResolver,
  }),
});

export function createQaUs3HandlerContributions(
  input: Parameters<typeof createQaUs2HandlerContributions>[0] &
    Parameters<typeof createQaPlanItemWaiverActionContribution>[0],
): GenericHandlerContributions {
  const us2 = createQaUs2HandlerContributions(input);
  return Object.freeze({
    ...us2,
    platformActionHandlers: Object.freeze([
      ...(us2.platformActionHandlers ?? []),
      createQaPlanItemWaiverActionContribution(input),
    ]),
  });
}

export function createQaUs4HandlerContributions(
  input: Parameters<typeof createQaUs3HandlerContributions>[0] &
    Parameters<typeof createQaFindingActionContribution>[0],
): GenericHandlerContributions {
  const us3 = createQaUs3HandlerContributions(input);
  return Object.freeze({
    confirmationHooks: Object.freeze([
      ...(us3.confirmationHooks ?? []),
      createQaTypeOrmDefectConfirmationHook(),
    ]),
    externalCommandLifecycle: Object.freeze([
      ...(us3.externalCommandLifecycle ?? []),
      createQaDefectCommandLifecycleContribution(new TypeOrmQaDefectCommandLifecycleStore()),
    ]),
    platformActionHandlers: Object.freeze([
      ...(us3.platformActionHandlers ?? []),
      createQaFindingActionContribution(input),
    ]),
  });
}

export function createQaUs5HandlerContributions(
  input: Parameters<typeof createQaUs4HandlerContributions>[0] &
    Parameters<typeof createQaVerdictCosignActionContribution>[0],
): GenericHandlerContributions {
  const us4 = createQaUs4HandlerContributions(input);
  return Object.freeze({
    confirmationHooks: Object.freeze([
      ...(us4.confirmationHooks ?? []),
      createQaTypeOrmCompletionConfirmationHook(),
    ]),
    externalCommandLifecycle: Object.freeze([
      ...(us4.externalCommandLifecycle ?? []),
      createQaCompletionCommandLifecycleContribution(),
    ]),
    platformActionHandlers: Object.freeze([
      ...(us4.platformActionHandlers ?? []),
      createQaVerdictCosignActionContribution(input),
    ]),
  });
}

export function createQaUs2HandlerContributions(
  input: Readonly<{
    readinessLifecycleStore: QaReadinessCommandLifecycleStore;
    now: () => string;
    roleFor: (approverId: string, workspaceId: string, projectId: string) => Promise<string>;
  }>,
): GenericHandlerContributions {
  return Object.freeze({
    confirmationHooks: Object.freeze([]),
    externalCommandLifecycle: Object.freeze([
      createQaReadinessCommandLifecycleContribution(input.readinessLifecycleStore),
    ]),
    platformActionHandlers: Object.freeze([
      createQaReadinessWaiverActionContribution({ now: input.now, roleFor: input.roleFor }),
    ]),
  });
}
