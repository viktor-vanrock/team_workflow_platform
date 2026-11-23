import {
  assertOnboardingTransition,
  type CapabilityModeAssessment,
  createOnboardingRevision,
  type ExactRevisionRef,
  type HumanActorSnapshot,
  type ProjectOnboardingRevision,
} from "@awp/platform-core";

export interface EvaluateProjectOnboardingInput {
  readonly current: ProjectOnboardingRevision;
  readonly assessment: CapabilityModeAssessment;
  readonly bindingRef: ExactRevisionRef;
  readonly qaProjectContextRef: ExactRevisionRef;
  readonly gateResultRefs: readonly ExactRevisionRef[];
  readonly actor: HumanActorSnapshot;
  readonly correlationId: string;
  readonly evaluatedAt: string;
  readonly nextRevisionId: string;
}

export function evaluateProjectOnboarding(
  input: EvaluateProjectOnboardingInput,
): ProjectOnboardingRevision {
  if (input.current.stage !== "VALIDATING") throw new Error("ONBOARDING_EVALUATION_STAGE_INVALID");
  if (
    input.assessment.workspaceId !== input.current.workspaceId ||
    input.assessment.projectId !== input.current.projectId ||
    input.assessment.bindingRef.id !== input.bindingRef.id ||
    input.assessment.bindingRef.version !== input.bindingRef.version ||
    input.assessment.bindingRef.contentHash !== input.bindingRef.contentHash ||
    input.assessment.qaProjectContextRef.id !== input.qaProjectContextRef.id ||
    input.assessment.qaProjectContextRef.version !== input.qaProjectContextRef.version ||
    input.assessment.qaProjectContextRef.contentHash !== input.qaProjectContextRef.contentHash
  ) {
    throw new Error("ONBOARDING_ASSESSMENT_SCOPE_MISMATCH");
  }
  const ready =
    input.assessment.manualRequirements === "SATISFIED" &&
    input.assessment.pilotMessagingRequirement !== "UNSATISFIED" &&
    input.gateResultRefs.length >= 3;
  const next = createOnboardingRevision({
    revisionId: input.nextRevisionId,
    onboardingId: input.current.onboardingId,
    version: input.current.version + 1,
    workspaceId: input.current.workspaceId,
    projectId: input.current.projectId,
    stage: ready ? "SHADOW" : "NEEDS_FIX",
    qaCapabilityMode: input.assessment.derivedMode,
    operationalState: input.current.operationalState,
    intendedCapabilityMode: input.current.intendedCapabilityMode,
    projectRegistryRef: input.current.projectRegistryRef,
    ...(ready
      ? { bindingRef: input.bindingRef, qaProjectContextRef: input.qaProjectContextRef }
      : {}),
    starterEntitlementSetHash: input.current.starterEntitlementSetHash,
    gateResultRefs: input.gateResultRefs,
    ownerSetHash: input.current.ownerSetHash,
    reasonCode: ready ? "ONBOARDING_GATES_PASSED" : "ONBOARDING_GATES_FAILED",
    reason: ready ? "Manual onboarding gates passed" : "Manual onboarding requires fixes",
    actor: input.actor,
    correlationId: input.correlationId,
    createdAt: input.evaluatedAt,
  });
  assertOnboardingTransition(input.current, next);
  return next;
}

export function reviseProjectCapabilityMode(
  input: Readonly<{
    current: ProjectOnboardingRevision;
    assessment: CapabilityModeAssessment;
    actor: HumanActorSnapshot;
    correlationId: string;
    evaluatedAt: string;
    nextRevisionId: string;
  }>,
): ProjectOnboardingRevision {
  if (
    !input.current.bindingRef ||
    !input.current.qaProjectContextRef ||
    input.assessment.workspaceId !== input.current.workspaceId ||
    input.assessment.projectId !== input.current.projectId ||
    input.assessment.bindingRef.id !== input.current.bindingRef.id ||
    input.assessment.bindingRef.version !== input.current.bindingRef.version ||
    input.assessment.bindingRef.contentHash !== input.current.bindingRef.contentHash ||
    input.assessment.qaProjectContextRef.id !== input.current.qaProjectContextRef.id ||
    input.assessment.qaProjectContextRef.version !== input.current.qaProjectContextRef.version ||
    input.assessment.qaProjectContextRef.contentHash !==
      input.current.qaProjectContextRef.contentHash
  ) {
    throw new Error("ONBOARDING_MODE_ASSESSMENT_MISMATCH");
  }
  const changed = input.current.qaCapabilityMode !== input.assessment.derivedMode;
  const next = createOnboardingRevision({
    ...input.current,
    revisionId: input.nextRevisionId,
    version: input.current.version + 1,
    qaCapabilityMode: input.assessment.derivedMode,
    intendedCapabilityMode: input.assessment.derivedMode,
    reasonCode: changed ? "PROJECT_CAPABILITY_MODE_CHANGED" : "PROJECT_CAPABILITY_MODE_RECONFIRMED",
    reason: `${input.assessment.derivedMode} derived from exact QA capability requirement set`,
    actor: input.actor,
    correlationId: input.correlationId,
    createdAt: input.evaluatedAt,
  });
  assertOnboardingTransition(input.current, next);
  return next;
}
