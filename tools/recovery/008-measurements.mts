export interface RecoveryMeasurementInput008 {
  readonly backupCompletedAt: string;
  readonly faultDeclaredAt: string;
  readonly lastConfirmedRecoverableCommitAt: string;
  readonly databaseRestoredAt: string;
  readonly serviceRestoredAt: string;
  readonly verificationCompletedAt: string;
  readonly policy: null | {
    readonly ref: string;
    readonly maximumRpoSeconds: number;
    readonly maximumRtoSeconds: number;
  };
}
export function measureRecovery008(input: RecoveryMeasurementInput008) {
  const times = Object.fromEntries(
    Object.entries(input)
      .filter(([key]) => key !== "policy")
      .map(([key, value]) => [key, Date.parse(value as string)]),
  ) as Record<Exclude<keyof RecoveryMeasurementInput008, "policy">, number>;
  if (
    Object.values(times).some((value) => !Number.isFinite(value)) ||
    times.backupCompletedAt > times.faultDeclaredAt ||
    times.lastConfirmedRecoverableCommitAt > times.faultDeclaredAt ||
    times.databaseRestoredAt < times.faultDeclaredAt ||
    times.verificationCompletedAt < times.databaseRestoredAt ||
    times.serviceRestoredAt < times.verificationCompletedAt
  )
    throw new Error("RECOVERY_MEASUREMENT_INVALID");
  const rpoObservedSeconds =
      (times.faultDeclaredAt - times.lastConfirmedRecoverableCommitAt) / 1000,
    rtoObservedSeconds = (times.serviceRestoredAt - times.faultDeclaredAt) / 1000;
  if (!input.policy)
    return Object.freeze({
      status: "BLOCKED_INPUT" as const,
      reasonCodes: Object.freeze(["RECOVERY_POLICY_MISSING"]),
      rpoObservedSeconds,
      rtoObservedSeconds,
      rtoEndedAt: input.serviceRestoredAt,
      databaseStartupIsTerminal: false as const,
    });
  if (
    !input.policy.ref ||
    !Number.isFinite(input.policy.maximumRpoSeconds) ||
    input.policy.maximumRpoSeconds < 0 ||
    !Number.isFinite(input.policy.maximumRtoSeconds) ||
    input.policy.maximumRtoSeconds <= 0
  )
    throw new Error("RECOVERY_POLICY_INVALID");
  const reasons = [
    ...(rpoObservedSeconds > input.policy.maximumRpoSeconds ? ["RPO_EXCEEDED"] : []),
    ...(rtoObservedSeconds > input.policy.maximumRtoSeconds ? ["RTO_EXCEEDED"] : []),
  ];
  return Object.freeze({
    status: reasons.length ? ("FAIL" as const) : ("PASS" as const),
    reasonCodes: Object.freeze(reasons),
    rpoObservedSeconds,
    rtoObservedSeconds,
    rtoEndedAt: input.serviceRestoredAt,
    databaseStartupIsTerminal: false as const,
    policyRef: input.policy.ref,
  });
}
