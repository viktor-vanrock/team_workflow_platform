export interface JiraCommandLanePort {
  claim(
    commandId: string,
    effectId: string,
    now: Date,
    leaseMs: number,
  ): Readonly<{ fencingToken: number }>;
  start(commandId: string, fencingToken: number): void;
  release(commandId: string, fencingToken: number, ambiguityResolved?: boolean): void;
}
export function guardJiraCommand(
  input: Readonly<{
    lane: JiraCommandLanePort;
    commandId: string;
    effectId: string;
    expected: Readonly<{ revisionToken: string; valueHash: string }>;
    observed: Readonly<{ revisionToken: string; valueHash: string }>;
    now: Date;
    leaseMs: number;
    write: () => void;
  }>,
) {
  const claim = input.lane.claim(input.commandId, input.effectId, input.now, input.leaseMs);
  if (
    input.expected.revisionToken !== input.observed.revisionToken ||
    input.expected.valueHash !== input.observed.valueHash
  ) {
    input.lane.release(input.commandId, claim.fencingToken);
    return Object.freeze({
      status: "CONFLICT" as const,
      reasonCode: "EXPECTED_STATE_MISMATCH",
      fencingToken: claim.fencingToken,
    });
  }
  input.lane.start(input.commandId, claim.fencingToken);
  input.write();
  return Object.freeze({ status: "EFFECT_STARTED" as const, fencingToken: claim.fencingToken });
}
