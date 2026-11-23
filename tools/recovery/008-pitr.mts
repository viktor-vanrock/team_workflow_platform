import { record } from "../verification/feature-008-prerequisites.mts";

export interface PitrExpectation008 {
  readonly requestedPoint: string;
  readonly databaseMajor: number;
  readonly sourceDeploymentRef: string;
  readonly approvedProviderRef: string;
  readonly now: number;
  readonly maximumAgeMs: number;
}
export interface PitrRecoveryProvider008 {
  restore(input: {
    readonly baseBackupRef: string;
    readonly walSegments: readonly string[];
    readonly timeline: string;
    readonly requestedPoint: string;
  }): Promise<{ readonly isolatedTargetId: string; readonly recoveredAt: string }>;
}
const digest = /^sha256:[a-f0-9]{64}$/u,
  segment = /^[0-9A-F]{24}$/u;
export function validatePitrManifest008(value: unknown, expected: PitrExpectation008) {
  if (!record(value))
    return Object.freeze({
      status: "BLOCKED_INPUT" as const,
      reasonCodes: Object.freeze(["PITR_MANIFEST_MISSING"]),
    });
  const keys = [
    "schemaVersion",
    "kind",
    "sourceDeploymentRef",
    "databaseMajor",
    "baseBackupRef",
    "baseBackupDigest",
    "timeline",
    "walSegments",
    "startedAt",
    "completedAt",
    "providerRef",
  ];
  if (
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key)) ||
    value.schemaVersion !== "pitr-manifest@1.0.0" ||
    value.kind !== "PHYSICAL_PITR" ||
    value.sourceDeploymentRef !== expected.sourceDeploymentRef ||
    value.databaseMajor !== expected.databaseMajor ||
    value.providerRef !== expected.approvedProviderRef ||
    typeof value.baseBackupRef !== "string" ||
    typeof value.baseBackupDigest !== "string" ||
    !digest.test(value.baseBackupDigest) ||
    typeof value.timeline !== "string" ||
    !Array.isArray(value.walSegments) ||
    !value.walSegments.length ||
    value.walSegments.some((item) => typeof item !== "string" || !segment.test(item)) ||
    new Set(value.walSegments).size !== value.walSegments.length ||
    typeof value.startedAt !== "string" ||
    typeof value.completedAt !== "string"
  )
    return Object.freeze({
      status: "BLOCKED_INPUT" as const,
      reasonCodes: Object.freeze(["PITR_MANIFEST_INVALID"]),
    });
  const started = Date.parse(value.startedAt),
    completed = Date.parse(value.completedAt),
    requested = Date.parse(expected.requestedPoint);
  if (
    !Number.isFinite(started) ||
    !Number.isFinite(completed) ||
    !Number.isFinite(requested) ||
    started > completed ||
    requested < started ||
    requested > completed ||
    expected.now - completed > expected.maximumAgeMs
  )
    return Object.freeze({
      status: "BLOCKED_INPUT" as const,
      reasonCodes: Object.freeze(["PITR_MANIFEST_STALE_OR_OUT_OF_RANGE"]),
    });
  const walSegments = value.walSegments as string[],
    ordered = [...walSegments].sort();
  if (ordered.some((item, index) => item !== walSegments[index]))
    return Object.freeze({
      status: "BLOCKED_INPUT" as const,
      reasonCodes: Object.freeze(["PITR_WAL_CHAIN_INVALID"]),
    });
  return Object.freeze({
    status: "PASS" as const,
    reasonCodes: Object.freeze([]),
    manifest: Object.freeze({
      baseBackupRef: value.baseBackupRef,
      walSegments: Object.freeze([...walSegments]),
      timeline: value.timeline as string,
      requestedPoint: expected.requestedPoint,
    }),
  });
}
export async function executePitrRecovery008(
  value: unknown,
  expected: PitrExpectation008,
  provider: PitrRecoveryProvider008,
) {
  const validation = validatePitrManifest008(value, expected);
  if (validation.status !== "PASS" || !("manifest" in validation)) return validation;
  const result = await provider.restore(validation.manifest);
  if (!result.isolatedTargetId || !Number.isFinite(Date.parse(result.recoveredAt)))
    return Object.freeze({
      status: "FAIL" as const,
      reasonCodes: Object.freeze(["PITR_PROVIDER_RESULT_INVALID"]),
    });
  return Object.freeze({ status: "PASS" as const, reasonCodes: Object.freeze([]), result });
}
