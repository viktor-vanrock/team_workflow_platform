export type IntakeCandidateState =
  "PENDING_CONFIRMATION" | "CONVERTED" | "SNOOZED" | "IGNORED" | "EXPIRED";
export type IntakeCandidateDecision = "CREATE" | "SNOOZE" | "IGNORE";

export interface IntakeCandidateSnapshot {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly deduplicationKey: string;
  readonly state: IntakeCandidateState;
  readonly currentSourceObservationVersion: number;
  readonly currentSourceFingerprint: string;
  readonly currentDecisionVersion: number;
  readonly expiresAt: Date;
  readonly snoozedUntil?: Date;
  readonly convertedDraftId?: string;
  readonly rowVersion: number;
}

export class IntakeCandidateAggregate {
  #snapshot: IntakeCandidateSnapshot;
  readonly #fingerprints = new Set<string>();
  private constructor(snapshot: IntakeCandidateSnapshot) {
    this.#snapshot = structuredClone(snapshot);
    this.#fingerprints.add(snapshot.currentSourceFingerprint);
  }
  static discover(
    input: Omit<
      IntakeCandidateSnapshot,
      "state" | "currentSourceObservationVersion" | "currentDecisionVersion" | "rowVersion"
    >,
  ): IntakeCandidateAggregate {
    if (
      !input.id ||
      !input.workspaceId ||
      !input.projectId ||
      !input.deduplicationKey ||
      !input.currentSourceFingerprint ||
      !Number.isFinite(input.expiresAt.getTime())
    )
      throw new Error("CANDIDATE_DISCOVERY_INVALID");
    return new IntakeCandidateAggregate({
      ...input,
      state: "PENDING_CONFIRMATION",
      currentSourceObservationVersion: 1,
      currentDecisionVersion: 0,
      rowVersion: 1,
    });
  }
  static restore(snapshot: IntakeCandidateSnapshot): IntakeCandidateAggregate {
    return new IntakeCandidateAggregate(snapshot);
  }
  snapshot(now?: Date): IntakeCandidateSnapshot {
    const state = now ? this.effectiveState(now) : this.#snapshot.state;
    return structuredClone({ ...this.#snapshot, state });
  }
  effectiveState(now: Date): IntakeCandidateState {
    if (now >= this.#snapshot.expiresAt) return "EXPIRED";
    if (
      this.#snapshot.state === "SNOOZED" &&
      this.#snapshot.snoozedUntil &&
      now >= this.#snapshot.snoozedUntil
    )
      return "PENDING_CONFIRMATION";
    return this.#snapshot.state;
  }
  observe(
    fingerprint: string,
    expectedVersion: number,
  ): Readonly<{ appended: boolean; version: number }> {
    if (!fingerprint) throw new Error("CANDIDATE_OBSERVATION_FINGERPRINT_REQUIRED");
    if (this.#fingerprints.has(fingerprint))
      return Object.freeze({
        appended: false,
        version: this.#snapshot.currentSourceObservationVersion,
      });
    if (expectedVersion !== this.#snapshot.currentSourceObservationVersion)
      throw new Error("CANDIDATE_OBSERVATION_CAS_CONFLICT");
    this.#fingerprints.add(fingerprint);
    this.#snapshot = {
      ...this.#snapshot,
      currentSourceFingerprint: fingerprint,
      currentSourceObservationVersion: expectedVersion + 1,
      state: this.#snapshot.state === "SNOOZED" ? "PENDING_CONFIRMATION" : this.#snapshot.state,
      rowVersion: this.#snapshot.rowVersion + 1,
    };
    return Object.freeze({ appended: true, version: expectedVersion + 1 });
  }
  decide(
    actorKind: "HUMAN" | "SERVICE",
    decision: IntakeCandidateDecision,
    now: Date,
    expectedRowVersion: number,
    options: {
      snoozedUntil?: Date;
      convertedDraftId?: string;
      expectedSourceObservationVersion?: number;
    } = {},
  ): IntakeCandidateSnapshot {
    if (actorKind !== "HUMAN") throw new Error("CANDIDATE_DECISION_HUMAN_REQUIRED");
    if (expectedRowVersion !== this.#snapshot.rowVersion)
      throw new Error("CANDIDATE_DECISION_CAS_CONFLICT");
    if (
      options.expectedSourceObservationVersion !== undefined &&
      options.expectedSourceObservationVersion !== this.#snapshot.currentSourceObservationVersion
    )
      throw new Error("CANDIDATE_SOURCE_OBSERVATION_STALE");
    if (this.effectiveState(now) !== "PENDING_CONFIRMATION")
      throw new Error("CANDIDATE_NOT_DECIDABLE");
    let state: IntakeCandidateState;
    if (decision === "CREATE") {
      if (!options.convertedDraftId) throw new Error("CANDIDATE_DRAFT_REQUIRED");
      state = "CONVERTED";
    } else if (decision === "IGNORE") state = "IGNORED";
    else {
      if (
        !options.snoozedUntil ||
        options.snoozedUntil <= now ||
        options.snoozedUntil >= this.#snapshot.expiresAt
      )
        throw new Error("CANDIDATE_SNOOZE_INVALID");
      state = "SNOOZED";
    }
    this.#snapshot = {
      ...this.#snapshot,
      state,
      currentDecisionVersion: this.#snapshot.currentDecisionVersion + 1,
      rowVersion: this.#snapshot.rowVersion + 1,
      ...(options.snoozedUntil ? { snoozedUntil: options.snoozedUntil } : {}),
      ...(options.convertedDraftId ? { convertedDraftId: options.convertedDraftId } : {}),
    };
    return this.snapshot();
  }
  wake(now: Date): IntakeCandidateSnapshot {
    if (
      this.#snapshot.state !== "SNOOZED" ||
      !this.#snapshot.snoozedUntil ||
      now < this.#snapshot.snoozedUntil ||
      now >= this.#snapshot.expiresAt
    )
      throw new Error("CANDIDATE_NOT_WAKEABLE");
    this.#snapshot = {
      ...this.#snapshot,
      state: "PENDING_CONFIRMATION",
      rowVersion: this.#snapshot.rowVersion + 1,
    };
    return this.snapshot();
  }
}
