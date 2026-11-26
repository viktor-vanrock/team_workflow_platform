import {
  type QaResponseChannelResolver,
  QaUs2RetestLineageResolver,
} from "@awp/competency-qa/node";
import {
  DurableQaCompletionApprovalRuntime,
  DurableQaCompletionRuntime,
  DurableQaDefectApprovalRuntime,
  DurableQaDefectPublicationRuntime,
  DurableQaDodRuntime,
  DurableQaReadinessRuntime,
  DurableQaVerdictRuntime,
  PublishedQaDodPolicy,
  PublishedQaCompletionConfiguration,
  PublishedQaDefectPublicationConfiguration,
  PublishedQaReadinessFacts,
  PublishedQaSessionRuntime,
  type QaCompletionPins,
  type QaDefectPublicationPins,
  type QaDodPolicyPins,
  type QaReadinessPins,
  type RuntimeEnvironment,
} from "@awp/runtime-composition";
import type { DataSource } from "typeorm";

import type { CoreAgentGrantAuthority } from "./core-intake-http-api.ts";
import { createCorporateQaIntakeConfiguration } from "./corporate-qa-intake-configuration.ts";
import type { CorporateQaBindings } from "./corporate-qa.module.ts";
import type { CorporateCommandAdmissionAuthority } from "./corporate-command-admission.ts";

/** The host provides approved policies and ports; this composition never invents their contents. */
export interface CorporateQaCompositionOptions {
  readonly readinessPins: readonly QaReadinessPins[];
  readonly dodPins: readonly QaDodPolicyPins[];
  readonly responseChannels: QaResponseChannelResolver;
  readonly agentAuthority: CoreAgentGrantAuthority;
  readonly commandAdmission: CorporateCommandAdmissionAuthority;
  readonly sessionAdmission: CorporateCommandAdmissionAuthority;
  readonly defectPins: readonly QaDefectPublicationPins[];
  readonly completionPins: readonly QaCompletionPins[];
  readonly stepUpPermissions: readonly string[];
}

export function createCorporateQaBindings(
  source: DataSource,
  environment: RuntimeEnvironment,
  options: CorporateQaCompositionOptions,
): CorporateQaBindings {
  const deployment = environment.deployment;
  if (
    !source.isInitialized ||
    environment.profile !== "non-local" ||
    !deployment ||
    !options?.responseChannels?.resolve ||
    !options.agentAuthority?.resolve ||
    !options.commandAdmission?.context ||
    !options.commandAdmission.guard?.assertEffectsAllowed ||
    !options.sessionAdmission?.context ||
    !options.sessionAdmission.guard?.assertEffectsAllowed ||
    !Array.isArray(options.readinessPins) ||
    !Array.isArray(options.dodPins) ||
    !Array.isArray(options.defectPins) ||
    !Array.isArray(options.completionPins) ||
    !Array.isArray(options.stepUpPermissions)
  )
    throw new Error("CORPORATE_QA_COMPOSITION_REQUIRED");
  const containsExactProjects = (pins: readonly { workspaceId: string; projectId: string }[]) =>
    pins.length === deployment.projectIds.length &&
    new Set(pins.map((pin) => pin.projectId)).size === pins.length &&
    pins.every(
      (pin) =>
        pin.workspaceId === deployment.workspaceId && deployment.projectIds.includes(pin.projectId),
    );
  if (
    !containsExactProjects(options.readinessPins) ||
    !containsExactProjects(options.dodPins) ||
    !containsExactProjects(options.defectPins) ||
    !containsExactProjects(options.completionPins)
  )
    throw new Error("CORPORATE_QA_PROJECT_PINS_INVALID");
  for (const readiness of options.readinessPins) {
    const dod = options.dodPins.find((pin) => pin.projectId === readiness.projectId);
    const defect = options.defectPins.find((pin) => pin.projectId === readiness.projectId);
    const completion = options.completionPins.find((pin) => pin.projectId === readiness.projectId);
    const same = (
      a: { id: string; version: number; contentHash: string },
      b: { id: string; version: number; contentHash: string },
    ) => a.id === b.id && a.version === b.version && a.contentHash === b.contentHash;
    if (
      !dod ||
      dod.contextRef.id !== readiness.contextRef.id ||
      dod.contextRef.version !== readiness.contextRef.version ||
      dod.contextRef.contentHash !== readiness.contextRef.contentHash ||
      !defect ||
      !completion ||
      !same(defect.bindingRef, readiness.bindingRef) ||
      !same(completion.bindingRef, readiness.bindingRef) ||
      !same(defect.requestAuthority.profileRef, readiness.profileRef) ||
      !same(defect.requestAuthority.connectionRef, readiness.connectionRef) ||
      !same(completion.profileRef, readiness.profileRef) ||
      !same(completion.connectionRef, readiness.connectionRef) ||
      !same(completion.mappingRef, defect.requestAuthority.mappingRef) ||
      defect.authorityScopeKey !== readiness.authorityScopeKey ||
      completion.authorityScopeKey !== readiness.authorityScopeKey
    )
      throw new Error("CORPORATE_QA_PROJECT_PINS_INVALID");
  }
  const policy = new PublishedQaDodPolicy(options.dodPins);
  const dod = new DurableQaDodRuntime(source, policy);
  const completion = new DurableQaCompletionRuntime(
    source,
    dod,
    new PublishedQaCompletionConfiguration(source, options.completionPins),
  );
  const defectPublication = new DurableQaDefectPublicationRuntime(
    source,
    new PublishedQaDefectPublicationConfiguration(options.defectPins),
  );
  return {
    intake: createCorporateQaIntakeConfiguration(
      source,
      environment,
      options.responseChannels,
      options.readinessPins,
    ),
    agentAuthority: options.agentAuthority,
    commandAdmission: options.commandAdmission,
    session: new PublishedQaSessionRuntime(options.readinessPins, (context) => ({
      assertEffectsAllowed: async (scope, expectedVersion) => {
        const pilot = await options.sessionAdmission.context(scope, context.actor.principalId);
        return await options.sessionAdmission.guard.assertEffectsAllowed(
          scope,
          expectedVersion,
          pilot,
        );
      },
    })),
    readiness: new DurableQaReadinessRuntime(
      source,
      new PublishedQaReadinessFacts(source, options.readinessPins),
      new QaUs2RetestLineageResolver(),
    ),
    defectPublication,
    defectApproval: new DurableQaDefectApprovalRuntime(source, defectPublication),
    dod,
    verdict: new DurableQaVerdictRuntime(source, policy),
    completion,
    completionApproval: new DurableQaCompletionApprovalRuntime(source, completion),
    stepUpPermissions: options.stepUpPermissions,
  };
}
