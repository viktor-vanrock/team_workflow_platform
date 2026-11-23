type MessagingLogicalTarget =
  | Readonly<{ kind: "PROJECT_CHANNEL"; purpose: string }>
  | Readonly<{ kind: "PRINCIPAL_DM"; principalId: string }>
  | Readonly<{ kind: "INTERACTION_RESPONSE"; sourceInteractionIntentId: string }>;

export type InteractionAction = Readonly<{
  kind:
    | "PROJECT_SELECT"
    | "CANDIDATE_CREATE"
    | "CANDIDATE_SNOOZE"
    | "CANDIDATE_IGNORE"
    | "DRAFT_REVISION_SUBMIT"
    | "DRAFT_CONFIRM"
    | "OPEN_WEB";
  parameters: Readonly<Record<string, unknown>>;
}>;
export type InteractionSubject = Readonly<{
  kind: "PROJECT_SELECTION" | "CANDIDATE" | "DRAFT_REVISION" | "WEB_ROUTE";
  id: string;
  version: number;
  contentHash: string;
}>;
export type InteractionTransport =
  | Readonly<{ kind: "WEB"; oidcSessionHash: string }>
  | Readonly<{ kind: "MATTERMOST"; target: MessagingLogicalTarget }>;
export type InteractionIntentStatus =
  "PENDING" | "CLAIMED" | "CONSUMED" | "EXPIRED" | "INVALIDATED";
export interface InteractionIntentSnapshot {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorPrincipalId: string;
  readonly action: InteractionAction;
  readonly subject: InteractionSubject;
  readonly transport: InteractionTransport;
  readonly expiresAt: Date;
  readonly status: InteractionIntentStatus;
  readonly resultRef?: string;
}

export class InteractionIntentAggregate {
  #snapshot: InteractionIntentSnapshot;
  private constructor(snapshot: InteractionIntentSnapshot) {
    this.#snapshot = structuredClone(snapshot);
  }
  static issue(input: Omit<InteractionIntentSnapshot, "status">): InteractionIntentAggregate {
    if (
      input.action.kind === "PROJECT_SELECT"
        ? input.transport.kind !== "WEB"
        : input.transport.kind !== "MATTERMOST"
    )
      throw new Error("INTERACTION_TRANSPORT_ACTION_INVALID");
    if (
      input.transport.kind === "MATTERMOST" &&
      input.transport.target.kind === "PRINCIPAL_DM" &&
      input.transport.target.principalId !== input.actorPrincipalId
    )
      throw new Error("INTERACTION_DM_ACTOR_MISMATCH");
    return new InteractionIntentAggregate({ ...input, status: "PENDING" });
  }
  snapshot(): InteractionIntentSnapshot {
    return structuredClone(this.#snapshot);
  }
  consume(
    actorPrincipalId: string,
    resultRef: string,
    now: Date,
  ): Readonly<{ replayed: boolean; resultRef: string }> {
    if (actorPrincipalId !== this.#snapshot.actorPrincipalId)
      throw new Error("INTERACTION_ACTOR_MISMATCH");
    if (this.#snapshot.status === "CONSUMED") {
      if (this.#snapshot.resultRef !== resultRef)
        throw new Error("INTERACTION_REPLAY_RESULT_CONFLICT");
      return Object.freeze({ replayed: true, resultRef });
    }
    if (this.#snapshot.status !== "PENDING") throw new Error("INTERACTION_NOT_PENDING");
    if (now >= this.#snapshot.expiresAt) {
      this.#snapshot = { ...this.#snapshot, status: "EXPIRED" };
      throw new Error("INTERACTION_EXPIRED");
    }
    this.#snapshot = { ...this.#snapshot, status: "CONSUMED", resultRef };
    return Object.freeze({ replayed: false, resultRef });
  }
  invalidate(): void {
    if (this.#snapshot.status === "PENDING" || this.#snapshot.status === "CLAIMED")
      this.#snapshot = { ...this.#snapshot, status: "INVALIDATED" };
  }
}
