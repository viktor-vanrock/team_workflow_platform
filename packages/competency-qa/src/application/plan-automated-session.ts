import { createAutomatedPlanItem, type QaAutomatedPlanItem } from "../domain/plan-item.ts";
import {
  type QaContentHash,
  QaDomainError,
  type QaExactReference,
  type QaHumanActor,
} from "../domain/primitives.ts";
import type { QaExternalImmutableRef } from "../domain/qa-project-context.ts";
import {
  type QaAutomatedRequiredSession,
  qaAutomationRequiredCapabilities,
} from "../domain/required-session-plan.ts";
import {
  createAutomatedTargetSnapshot,
  type QaAutomatedConfigurationPin,
  type QaAutomatedTargetSnapshot,
  type QaAutomationTarget,
  type QaScopeSnapshot,
} from "../domain/snapshots.ts";
import type { QaTargetSnapshotV2 } from "../domain/snapshots-v2.ts";
import type { QaAutomationSuiteVersion } from "../domain/suite-binding.ts";
import {
  createPlannedAutomatedTestSession,
  type QaAutomatedTestSession,
} from "../domain/test-session.ts";

export interface AutomatedSessionPlanningGuardInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly capabilityMode: "MANUAL_ONLY" | "FULL_QA";
  readonly bindingRef: QaExactReference;
  readonly acceptedSuiteRef: QaExactReference;
  readonly requestedSuiteRef: QaExactReference;
  readonly targetSnapshot: QaTargetSnapshotV2;
}

export function assertAutomatedSessionPlanningAllowed(
  input: AutomatedSessionPlanningGuardInput,
): QaTargetSnapshotV2 {
  if (input.capabilityMode !== "FULL_QA") throw new QaDomainError("QA_AUTOMATION_FULL_QA_REQUIRED");
  if (!sameExact(input.acceptedSuiteRef, input.requestedSuiteRef))
    throw new QaDomainError("QA_AUTOMATION_SUITE_ACCEPTANCE_MISMATCH");
  const snapshot = input.targetSnapshot;
  if (
    snapshot.schemaVersion !== "qa-target-snapshot@2.0.0" ||
    snapshot.mode !== "AUTOMATED" ||
    snapshot.workspaceId !== input.workspaceId ||
    snapshot.projectId !== input.projectId ||
    !snapshot.definitionRefs.some((ref) => sameExact(ref, input.requestedSuiteRef)) ||
    snapshot.configurationPins.some((pin) => !sameExact(pin.bindingRef, input.bindingRef))
  ) {
    throw new QaDomainError("QA_AUTOMATION_TARGET_SNAPSHOT_V2_REQUIRED");
  }
  const requiredRoles = ["SOURCE_CONTEXT", "TEST_EXECUTION", "ARTIFACT_SOURCE"];
  if (
    requiredRoles.some(
      (role) => snapshot.configurationPins.filter((pin) => pin.logicalRole === role).length !== 1,
    )
  ) {
    throw new QaDomainError("QA_AUTOMATION_TARGET_SNAPSHOT_PINS_INVALID");
  }
  return snapshot;
}

export interface PlannedAutomatedSession {
  readonly session: QaAutomatedTestSession;
  readonly planItem: QaAutomatedPlanItem;
  readonly targetSnapshot: QaAutomatedTargetSnapshot;
  readonly scopeSnapshot: QaScopeSnapshot;
  readonly configurationPins: readonly QaAutomatedConfigurationPin[];
}

function sameExact(left: QaExactReference, right: QaExactReference): boolean {
  return (
    left.id === right.id && left.version === right.version && left.contentHash === right.contentHash
  );
}

export function planAutomatedSession(
  input: Readonly<{
    sessionId: string;
    planRef: QaExactReference;
    requirement: QaAutomatedRequiredSession;
    suite: QaAutomationSuiteVersion;
    configurationPins: readonly QaAutomatedConfigurationPin[];
    existingSessionOrdinals: readonly number[];
    ownerId: string;
    sourceIssueKey: string;
    target: QaAutomationTarget;
    environment: Readonly<{
      environmentRef: string;
      revision: number;
      class: "LOCAL" | "DEVELOPMENT" | "TEST";
    }>;
    acceptedParameters: Readonly<Record<string, unknown>>;
    parameterValidation: Readonly<{ valid: boolean; schemaRef: QaExactReference }>;
    browser?: "chromium" | "firefox" | "webkit";
    testDataRefs: readonly QaExternalImmutableRef[];
    accountLeaseRefs: readonly QaExternalImmutableRef[];
    scopeSnapshot: QaScopeSnapshot;
    parentSession?: Readonly<{ id: string; targetSnapshotHash: QaContentHash }>;
    replacementReason?: "TARGET_CHANGED" | "REVIEW_FROZEN";
    actor: QaHumanActor;
    createdAt: string;
  }>,
): PlannedAutomatedSession {
  const requirement = input.requirement;
  const suite = input.suite;
  if (
    !input.sessionId ||
    requirement.workspaceId !== suite.workspaceId ||
    requirement.projectId !== suite.projectId ||
    input.planRef.id !== requirement.requiredSessionPlanId ||
    input.planRef.version !== requirement.planVersion ||
    suite.state !== "PUBLISHED" ||
    suite.suiteKey !== requirement.suiteBindingKey ||
    !input.ownerId ||
    input.ownerId !== suite.content.ownerPrincipalId ||
    !input.parameterValidation.valid ||
    !sameExact(input.parameterValidation.schemaRef, suite.content.parameterSchemaRef) ||
    (input.parentSession === undefined) !== (input.replacementReason === undefined)
  )
    throw new QaDomainError("QA_AUTOMATED_SESSION_SELECTION_INVALID");
  if (
    !requirement.allowedTargetTypes.includes(input.target.type) ||
    !suite.content.allowedTargetTypes.includes(input.target.type)
  ) {
    throw new QaDomainError("QA_AUTOMATED_SESSION_TARGET_FORBIDDEN");
  }
  if (
    !requirement.allowedEnvironmentRefs.includes(input.environment.environmentRef) ||
    !suite.content.allowedEnvironmentRefs.includes(input.environment.environmentRef)
  ) {
    throw new QaDomainError("QA_AUTOMATED_SESSION_ENVIRONMENT_FORBIDDEN");
  }
  if (input.existingSessionOrdinals.some((ordinal) => !Number.isInteger(ordinal) || ordinal < 1)) {
    throw new QaDomainError("QA_AUTOMATED_SESSION_ORDINALS_INVALID");
  }
  const targetSnapshot = createAutomatedTargetSnapshot({
    workspaceId: requirement.workspaceId,
    projectId: requirement.projectId,
    workItemId: requirement.workItemId,
    testSessionId: input.sessionId,
    sourceIssueKey: input.sourceIssueKey,
    target: input.target,
    environment: input.environment,
    suite: Object.freeze({
      suiteKey: suite.suiteKey,
      suiteBindingRef: Object.freeze({ id: suite.suiteBindingId, version: suite.version }),
      suiteBindingHash: suite.contentHash,
      parameterSchemaRef: suite.content.parameterSchemaRef,
      acceptedParameters: input.acceptedParameters,
      ...(input.browser === undefined ? {} : { browser: input.browser }),
    }),
    configurationPins: input.configurationPins,
    executionPolicies: Object.freeze({
      resultSchemaRef: suite.content.resultSchemaRef,
      artifactPolicyRef: suite.content.artifactPolicyRef,
      retryPolicyRef: suite.content.retryPolicyRef,
      quarantinePolicyRef: suite.content.quarantinePolicyRef,
    }),
    testDataRefs: input.testDataRefs,
    accountLeaseRefs: input.accountLeaseRefs,
    capturedAt: input.createdAt,
  });
  const suiteBindingRef = Object.freeze({
    id: suite.suiteBindingId,
    version: suite.version,
    contentHash: suite.contentHash,
  });
  const planItem = createAutomatedPlanItem({
    id: `${input.sessionId}:item:1`,
    workspaceId: requirement.workspaceId,
    projectId: requirement.projectId,
    workItemId: requirement.workItemId,
    sessionId: input.sessionId,
    suiteBindingRef,
    scopeSnapshotHash: input.scopeSnapshot.contentHash,
    targetSnapshotHash: targetSnapshot.snapshotHash,
    createdBy: input.actor,
    createdAt: input.createdAt,
  });
  const session = createPlannedAutomatedTestSession({
    id: input.sessionId,
    workspaceId: requirement.workspaceId,
    projectId: requirement.projectId,
    workItemId: requirement.workItemId,
    ordinal: Math.max(0, ...input.existingSessionOrdinals) + 1,
    ...(input.parentSession === undefined
      ? {}
      : {
          parentSessionId: input.parentSession.id,
          replacement: Object.freeze({
            reason: input.replacementReason!,
            priorTargetSnapshotHash: input.parentSession.targetSnapshotHash,
          }),
        }),
    planRevisionRef: input.planRef,
    requirementRef: Object.freeze({
      id: requirement.requirementId,
      version: requirement.planVersion,
      contentHash: requirement.contentHash,
      requirementKey: requirement.suiteBindingKey,
    }),
    ownerId: input.ownerId,
    requiredCapabilities: qaAutomationRequiredCapabilities,
    suiteBindingRef,
    configurationPinSetHash: targetSnapshot.configurationPinSetHash,
    parameterSetHash: targetSnapshot.suite.parametersHash,
    targetSnapshotRef: `qa-target-snapshot:${input.sessionId}:v1`,
    targetSnapshotHash: targetSnapshot.snapshotHash,
    scopeSnapshotRef: `qa-scope-snapshot:${input.sessionId}:v1`,
    scopeSnapshotHash: input.scopeSnapshot.contentHash,
    planItems: Object.freeze([planItem]),
    createdBy: input.actor,
    createdAt: input.createdAt,
  });
  return Object.freeze({
    session,
    planItem,
    targetSnapshot,
    scopeSnapshot: input.scopeSnapshot,
    configurationPins: targetSnapshot.configurationPins,
  });
}
