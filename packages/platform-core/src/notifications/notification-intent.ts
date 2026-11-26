import { type JsonValue, sha256 } from "@awp/platform-contracts";

type MessagingLogicalTarget =
  | Readonly<{ kind: "PROJECT_CHANNEL"; purpose: string }>
  | Readonly<{ kind: "PRINCIPAL_DM"; principalId: string }>
  | Readonly<{ kind: "INTERACTION_RESPONSE"; sourceInteractionIntentId: string }>;

export type NotificationIntentState =
  | "QUEUED"
  | "DELIVERING"
  | "LOOKUP_REQUIRED"
  | "DELIVERED"
  | "AMBIGUOUS"
  | "FAILED"
  | "FAILED_RETRYABLE"
  | "FAILED_FINAL"
  | "EXPIRED";
export interface NotificationDeliveryAttempt {
  readonly attempt: number;
  readonly fence: number;
  readonly startedAt: Date;
  readonly effectInvocationStartedAt?: Date;
  readonly outcome?: string;
}
export interface NotificationIntentSnapshot {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly dedupeKey: string;
  readonly sourceEventRef: string;
  readonly target: MessagingLogicalTarget;
  readonly targetHash: string;
  readonly payloadHash: string;
  readonly renderHash: string;
  readonly templateEvidence?: Readonly<{
    templateRef: string;
    templateHash: `sha256:${string}`;
    variablesSchemaRef: Readonly<{ id: string; version: number; digest: `sha256:${string}` }>;
    variablesHash: `sha256:${string}`;
    renderHash: `sha256:${string}`;
  }>;
  readonly commandId: string;
  readonly state: NotificationIntentState;
  readonly attempts: readonly NotificationDeliveryAttempt[];
  readonly expiresAt: Date;
  readonly rowVersion: number;
}
export class NotificationIntentAggregate {
  #snapshot: NotificationIntentSnapshot;
  private constructor(snapshot: NotificationIntentSnapshot) {
    this.#snapshot = structuredClone(snapshot);
  }
  static create(
    input: Omit<
      NotificationIntentSnapshot,
      "targetHash" | "payloadHash" | "renderHash" | "state" | "attempts" | "rowVersion"
    > & { payload: JsonValue; render: string },
  ): NotificationIntentAggregate {
    return new NotificationIntentAggregate({
      ...input,
      targetHash: sha256(input.target as unknown as JsonValue),
      payloadHash: sha256(input.payload),
      renderHash: sha256(input.render),
      state: "QUEUED",
      attempts: [],
      rowVersion: 1,
    });
  }
  snapshot(): NotificationIntentSnapshot {
    return structuredClone(this.#snapshot);
  }
  begin(now: Date): NotificationDeliveryAttempt {
    if (this.#snapshot.state !== "QUEUED") throw new Error("NOTIFICATION_NOT_QUEUED");
    if (now >= this.#snapshot.expiresAt) {
      this.#snapshot = {
        ...this.#snapshot,
        state: "EXPIRED",
        rowVersion: this.#snapshot.rowVersion + 1,
      };
      throw new Error("NOTIFICATION_EXPIRED");
    }
    const attempt = {
      attempt: this.#snapshot.attempts.length + 1,
      fence: this.#snapshot.rowVersion + 1,
      startedAt: now,
    };
    this.#snapshot = {
      ...this.#snapshot,
      state: "DELIVERING",
      attempts: [...this.#snapshot.attempts, attempt],
      rowVersion: this.#snapshot.rowVersion + 1,
    };
    return attempt;
  }
  markInvoked(fence: number, at: Date): void {
    const current = this.#snapshot.attempts.at(-1);
    if (!current || current.fence !== fence || this.#snapshot.state !== "DELIVERING")
      throw new Error("NOTIFICATION_FENCE_CONFLICT");
    const updated = { ...current, effectInvocationStartedAt: at };
    this.#snapshot = {
      ...this.#snapshot,
      attempts: [...this.#snapshot.attempts.slice(0, -1), updated],
      rowVersion: this.#snapshot.rowVersion + 1,
    };
  }
  uncertain(fence: number): void {
    const current = this.#snapshot.attempts.at(-1);
    if (!current || current.fence !== fence || !current.effectInvocationStartedAt)
      throw new Error("NOTIFICATION_INVOCATION_MARKER_REQUIRED");
    this.#snapshot = {
      ...this.#snapshot,
      state: "LOOKUP_REQUIRED",
      rowVersion: this.#snapshot.rowVersion + 1,
    };
  }
  resolve(matches: number, supported = true): void {
    if (this.#snapshot.state !== "LOOKUP_REQUIRED")
      throw new Error("NOTIFICATION_LOOKUP_NOT_REQUIRED");
    this.#snapshot = {
      ...this.#snapshot,
      state: supported && matches === 1 ? "DELIVERED" : "AMBIGUOUS",
      rowVersion: this.#snapshot.rowVersion + 1,
    };
  }
}
