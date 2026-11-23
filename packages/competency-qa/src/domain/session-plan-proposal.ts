import { type JsonValue, sha256 } from "@awp/platform-contracts";

export interface QaSessionPlanProposalSnapshot {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly subject: Readonly<{
    kind: "WORK_ITEM";
    id: string;
    version: number;
    contentHash: string;
  }>;
  readonly revision: number;
  readonly content: Readonly<Record<string, unknown>>;
  readonly contentHash: string;
  readonly sourceFactSetHash: string;
  readonly state: "CURRENT" | "STALE" | "SUPERSEDED" | "ACCEPTED";
  readonly expiresAt: Date;
  readonly staleAt?: Date;
  readonly acceptedPlanRef?: string;
  readonly acceptedBy?: string;
  readonly acceptedAt?: Date;
}
export class QaSessionPlanProposalAggregate {
  #value: QaSessionPlanProposalSnapshot;
  private constructor(value: QaSessionPlanProposalSnapshot) {
    this.#value = structuredClone(value);
  }
  static create(
    input: Omit<QaSessionPlanProposalSnapshot, "contentHash" | "sourceFactSetHash" | "state">,
  ) {
    if (input.subject.kind !== "WORK_ITEM") throw new Error("SESSION_PLAN_WORK_ITEM_REQUIRED");
    const slices = input.content.sessionSlices;
    if (!Array.isArray(slices) || slices.length === 0 || slices.length > 50)
      throw new Error("SESSION_PLAN_SLICES_INVALID");
    return new QaSessionPlanProposalAggregate({
      ...input,
      contentHash: sha256(input.content as JsonValue),
      sourceFactSetHash: sha256((input.content.facts ?? []) as JsonValue),
      state: "CURRENT",
    });
  }
  static restore(value: QaSessionPlanProposalSnapshot) {
    if (!new Set(["CURRENT", "STALE", "SUPERSEDED", "ACCEPTED"]).has(value.state))
      throw new Error("SESSION_PLAN_STATE_INVALID");
    if (sha256(value.content as JsonValue) !== value.contentHash)
      throw new Error("SESSION_PLAN_CONTENT_HASH_INVALID");
    if (sha256((value.content.facts ?? []) as JsonValue) !== value.sourceFactSetHash)
      throw new Error("SESSION_PLAN_FACT_SET_HASH_INVALID");
    return new QaSessionPlanProposalAggregate(value);
  }
  snapshot() {
    return structuredClone(this.#value);
  }
  stale(now: Date) {
    if (this.#value.state === "CURRENT")
      this.#value = { ...this.#value, state: "STALE", staleAt: now };
    return this.snapshot();
  }
  supersede() {
    if (this.#value.state === "CURRENT") this.#value = { ...this.#value, state: "SUPERSEDED" };
    return this.snapshot();
  }
  accept(
    actorKind: "HUMAN" | "SERVICE",
    acceptedPlanRef: string,
    actorId: string,
    now: Date,
    currentFactSetHash: string,
  ) {
    if (actorKind !== "HUMAN") throw new Error("SESSION_PLAN_ACCEPT_HUMAN_REQUIRED");
    if (
      this.#value.state !== "CURRENT" ||
      now >= this.#value.expiresAt ||
      currentFactSetHash !== this.#value.sourceFactSetHash
    )
      throw new Error("SESSION_PLAN_PROPOSAL_STALE");
    if (!acceptedPlanRef) throw new Error("SESSION_PLAN_ACCEPTED_PLAN_REQUIRED");
    this.#value = {
      ...this.#value,
      state: "ACCEPTED",
      acceptedPlanRef,
      acceptedBy: actorId,
      acceptedAt: now,
    };
    return this.snapshot();
  }
}
