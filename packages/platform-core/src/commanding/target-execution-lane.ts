export type TargetLaneState = "RELEASED" | "CLAIMED" | "EFFECT_STARTED" | "AWAITING_RECONCILIATION";
export interface TargetLaneClaim {
  readonly laneKey: string;
  readonly commandId: string;
  readonly effectId: string;
  readonly fencingToken: number;
  readonly leaseExpiresAt: Date;
  readonly state: TargetLaneState;
}

export class TargetExecutionLane {
  #claim?: TargetLaneClaim;
  #nextFencingToken = 1;
  constructor(readonly laneKey: string) {
    if (!laneKey) throw new Error("TARGET_LANE_KEY_REQUIRED");
  }
  current(): TargetLaneClaim | undefined {
    return this.#claim ? structuredClone(this.#claim) : undefined;
  }
  claim(commandId: string, effectId: string, now: Date, leaseMs: number): TargetLaneClaim {
    if (leaseMs <= 0) throw new Error("TARGET_LANE_LEASE_INVALID");
    if (this.#claim && this.#claim.state !== "RELEASED") {
      const sameEffect = this.#claim.commandId === commandId && this.#claim.effectId === effectId;
      if (!sameEffect || this.#claim.leaseExpiresAt > now) throw new Error("TARGET_LANE_OCCUPIED");
    }
    this.#claim = Object.freeze({
      laneKey: this.laneKey,
      commandId,
      effectId,
      fencingToken: this.#nextFencingToken++,
      leaseExpiresAt: new Date(now.getTime() + leaseMs),
      state: "CLAIMED",
    });
    return structuredClone(this.#claim);
  }
  start(commandId: string, fencingToken: number): void {
    this.#replace(commandId, fencingToken, "EFFECT_STARTED");
  }
  markAmbiguous(commandId: string, fencingToken: number): void {
    this.#replace(commandId, fencingToken, "AWAITING_RECONCILIATION");
  }
  release(commandId: string, fencingToken: number, ambiguityResolved = false): void {
    if (this.#claim?.state === "AWAITING_RECONCILIATION" && !ambiguityResolved)
      throw new Error("AMBIGUOUS_LANE_REQUIRES_RESOLUTION");
    this.#replace(commandId, fencingToken, "RELEASED");
  }
  #replace(commandId: string, fencingToken: number, state: TargetLaneState): void {
    if (
      !this.#claim ||
      this.#claim.commandId !== commandId ||
      this.#claim.fencingToken !== fencingToken
    )
      throw new Error("TARGET_LANE_FENCE_REJECTED");
    this.#claim = Object.freeze({ ...this.#claim, state });
  }
}
