import { QaDomainError } from "../domain/primitives.ts";
import type { QaTargetSnapshotV2 } from "../domain/snapshots-v2.ts";

export interface QaProjectEffectGuardPort {
  assertEffectsAllowed(
    scope: Readonly<{ workspaceId: string; projectId: string }>,
    expectedOnboardingVersion?: number,
  ): Promise<unknown>;
}

export interface QaSessionStartGuardInput {
  readonly confirmedOperationalReady: boolean;
  readonly environment: Readonly<{
    scope: "LOCAL" | "NON_PROD" | "PREPROD" | "PRODUCTION";
    currentRevision: number;
    snapshotRevision: number;
  }>;
  readonly buildPinned: boolean;
  readonly testDataOrAccountPinned: boolean;
  readonly checklistPinned: boolean;
  readonly bindingCompatible: boolean;
  readonly profilesCompatible: boolean;
  readonly readyAgainstCurrentStructure: boolean;
}

export function assertSessionStartGuards(input: QaSessionStartGuardInput): void {
  if (!input.confirmedOperationalReady)
    throw new QaDomainError("QA_SESSION_OPERATIONAL_READY_REQUIRED");
  if (input.environment.scope === "PRODUCTION")
    throw new QaDomainError("QA_SESSION_PRODUCTION_FORBIDDEN");
  if (input.environment.currentRevision !== input.environment.snapshotRevision)
    throw new QaDomainError("QA_SESSION_ENVIRONMENT_REVISION_STALE");
  if (!input.buildPinned) throw new QaDomainError("QA_SESSION_BUILD_REQUIRED");
  if (!input.testDataOrAccountPinned) throw new QaDomainError("QA_SESSION_TEST_DATA_REQUIRED");
  if (!input.checklistPinned) throw new QaDomainError("QA_SESSION_CHECKLIST_REQUIRED");
  if (!input.bindingCompatible) throw new QaDomainError("QA_SESSION_BINDING_INCOMPATIBLE");
  if (!input.profilesCompatible) throw new QaDomainError("QA_SESSION_PROFILE_INCOMPATIBLE");
  if (!input.readyAgainstCurrentStructure) throw new QaDomainError("QA_SESSION_READY_HASH_STALE");
}

export interface GuardedQaSessionStartInput {
  readonly mode: "MANUAL" | "AUTOMATED";
  readonly onboarding: Readonly<{
    operationalState: "ACTIVE" | "SUSPENDED";
    capabilityMode: "MANUAL_ONLY" | "FULL_QA";
    version?: number;
  }>;
  readonly snapshot: QaTargetSnapshotV2;
  readonly eligibility?: Readonly<{
    bindingRef: QaTargetSnapshotV2["configurationPins"][number]["bindingRef"];
    allowedEnvironmentRefs: readonly QaTargetSnapshotV2["environmentRef"][];
    allowedTestDataRefs: readonly QaTargetSnapshotV2["testDataRefs"][number][];
    activeAccountLeaseRefs: readonly QaTargetSnapshotV2["accountLeaseRefs"][number][];
  }>;
  readonly persist: (snapshot: QaTargetSnapshotV2) => Promise<void>;
  readonly providerEffect?: () => Promise<void>;
  readonly effectGuard?: QaProjectEffectGuardPort;
}

export async function startGuardedQaSession(
  input: GuardedQaSessionStartInput,
): Promise<QaTargetSnapshotV2> {
  if (input.onboarding.operationalState !== "ACTIVE") throw new QaDomainError("PROJECT_SUSPENDED");
  const scope = { workspaceId: input.snapshot.workspaceId, projectId: input.snapshot.projectId };
  await input.effectGuard?.assertEffectsAllowed(scope, input.onboarding.version);
  if (input.mode === "AUTOMATED" && input.onboarding.capabilityMode !== "FULL_QA")
    throw new QaDomainError("AUTOMATION_REQUIRES_FULL_QA");
  if (input.snapshot.mode !== input.mode)
    throw new QaDomainError("QA_SESSION_MODE_SNAPSHOT_MISMATCH");
  if (input.mode === "MANUAL") {
    if (!input.eligibility) throw new QaDomainError("QA_SESSION_RESOURCE_ELIGIBILITY_REQUIRED");
    const sameRef = (
      left: Readonly<{ id: string; version: number; contentHash: string }>,
      right: Readonly<{ id: string; version: number; contentHash: string }>,
    ) =>
      left.id === right.id &&
      left.version === right.version &&
      left.contentHash === right.contentHash;
    if (
      !input.snapshot.configurationPins.every(({ bindingRef }) =>
        sameRef(bindingRef, input.eligibility!.bindingRef),
      )
    )
      throw new QaDomainError("QA_SESSION_BINDING_INELIGIBLE");
    if (
      !input.eligibility.allowedEnvironmentRefs.some((ref) =>
        sameRef(ref, input.snapshot.environmentRef),
      )
    )
      throw new QaDomainError("QA_SESSION_ENVIRONMENT_NOT_ALLOWED");
    if (
      !input.snapshot.testDataRefs.every((ref) =>
        input.eligibility!.allowedTestDataRefs.some((allowed) => sameRef(allowed, ref)),
      )
    )
      throw new QaDomainError("QA_SESSION_TEST_DATA_NOT_ALLOWED");
    if (
      !input.snapshot.accountLeaseRefs.every((ref) =>
        input.eligibility!.activeAccountLeaseRefs.some((active) => sameRef(active, ref)),
      )
    )
      throw new QaDomainError("QA_SESSION_ACCOUNT_LEASE_NOT_ACTIVE");
  }
  await input.persist(input.snapshot);
  if (input.providerEffect) {
    await input.effectGuard?.assertEffectsAllowed(scope, input.onboarding.version);
    await input.providerEffect();
  }
  return input.snapshot;
}
