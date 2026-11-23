import { createHash } from "node:crypto";

export type RecoveryStage008 =
  | "PLANNED"
  | "FENCED"
  | "RESTORED"
  | "VERIFIED"
  | "RECONCILED"
  | "READY_FOR_RESUME"
  | "RESUMED"
  | "BLOCKED";
export interface RecoveryFence008 {
  readonly recoveryId: string;
  readonly deploymentId: string;
  readonly configDigest: string;
  readonly imageDigest: string;
  readonly oldRuntimeIds: readonly string[];
  readonly newRuntimeId?: string;
  readonly stage: RecoveryStage008;
  readonly version: number;
  readonly resumeNonce?: string;
  readonly contentHash: string;
}
const digest = /^sha256:[a-f0-9]{64}$/u;
const hash = (value: unknown) =>
  `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
const body = (value: Omit<RecoveryFence008, "contentHash">): RecoveryFence008 =>
  Object.freeze({ ...value, contentHash: hash(value) });
function valid(value: RecoveryFence008): void {
  const { contentHash, ...semantic } = value;
  if (
    !value.recoveryId ||
    !value.deploymentId ||
    !digest.test(value.configDigest) ||
    !digest.test(value.imageDigest) ||
    !value.oldRuntimeIds.length ||
    new Set(value.oldRuntimeIds).size !== value.oldRuntimeIds.length ||
    !Number.isSafeInteger(value.version) ||
    value.version < 1 ||
    hash(semantic) !== contentHash
  )
    throw new Error("RECOVERY_FENCE_INVALID");
}
export function planRecoveryFence008(
  input: Omit<
    RecoveryFence008,
    "stage" | "version" | "contentHash" | "newRuntimeId" | "resumeNonce"
  >,
): RecoveryFence008 {
  return body({
    ...input,
    oldRuntimeIds: Object.freeze([...input.oldRuntimeIds]),
    stage: "PLANNED",
    version: 1,
  });
}
export function advanceRecoveryFence008(
  current: RecoveryFence008,
  input: {
    readonly expectedVersion: number;
    readonly stage: Exclude<RecoveryStage008, "PLANNED" | "RESUMED">;
    readonly newRuntimeId?: string;
    readonly evidenceRefs: readonly string[];
  },
): RecoveryFence008 {
  valid(current);
  if (
    input.expectedVersion !== current.version ||
    !input.evidenceRefs.length ||
    input.evidenceRefs.some((value) => !value)
  )
    throw new Error("RECOVERY_FENCE_CONFLICT");
  const allowed: Readonly<Record<RecoveryStage008, readonly RecoveryStage008[]>> = {
    PLANNED: ["FENCED", "BLOCKED"],
    FENCED: ["RESTORED", "BLOCKED"],
    RESTORED: ["VERIFIED", "BLOCKED"],
    VERIFIED: ["RECONCILED", "BLOCKED"],
    RECONCILED: ["READY_FOR_RESUME", "BLOCKED"],
    READY_FOR_RESUME: ["BLOCKED"],
    RESUMED: [],
    BLOCKED: [],
  };
  if (!allowed[current.stage].includes(input.stage))
    throw new Error("RECOVERY_FENCE_TRANSITION_DENIED");
  const newRuntimeId = input.newRuntimeId ?? current.newRuntimeId;
  if (
    ["RESTORED", "VERIFIED", "RECONCILED", "READY_FOR_RESUME"].includes(input.stage) &&
    (!newRuntimeId || current.oldRuntimeIds.includes(newRuntimeId))
  )
    throw new Error("RECOVERY_RUNTIME_IDENTITY_INVALID");
  return body({
    recoveryId: current.recoveryId,
    deploymentId: current.deploymentId,
    configDigest: current.configDigest,
    imageDigest: current.imageDigest,
    oldRuntimeIds: current.oldRuntimeIds,
    ...(newRuntimeId ? { newRuntimeId } : {}),
    stage: input.stage,
    version: current.version + 1,
    ...(input.stage === "READY_FOR_RESUME"
      ? {
          resumeNonce: hash({
            recoveryId: current.recoveryId,
            version: current.version + 1,
            evidenceRefs: input.evidenceRefs,
          }),
        }
      : current.resumeNonce
        ? { resumeNonce: current.resumeNonce }
        : {}),
  });
}
export function resumeRecoveryFence008(
  current: RecoveryFence008,
  input: {
    readonly expectedVersion: number;
    readonly newRuntimeId: string;
    readonly resumeNonce: string;
    readonly approvalRef: string;
  },
): RecoveryFence008 {
  valid(current);
  if (
    current.stage !== "READY_FOR_RESUME" ||
    input.expectedVersion !== current.version ||
    input.newRuntimeId !== current.newRuntimeId ||
    input.resumeNonce !== current.resumeNonce ||
    !input.approvalRef
  )
    throw new Error("RECOVERY_RESUME_DENIED");
  return body({
    recoveryId: current.recoveryId,
    deploymentId: current.deploymentId,
    configDigest: current.configDigest,
    imageDigest: current.imageDigest,
    oldRuntimeIds: current.oldRuntimeIds,
    newRuntimeId: input.newRuntimeId,
    stage: "RESUMED",
    version: current.version + 1,
    resumeNonce: input.resumeNonce,
  });
}
export function assertRecoveryWrite008(fence: RecoveryFence008, runtimeId: string): void {
  valid(fence);
  if (
    fence.oldRuntimeIds.includes(runtimeId) ||
    fence.stage !== "RESUMED" ||
    runtimeId !== fence.newRuntimeId
  )
    throw new Error("RECOVERY_WRITE_FENCED");
}
