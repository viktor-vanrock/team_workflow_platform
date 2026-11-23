export type QaCapabilityMode = "MANUAL_ONLY" | "FULL_QA";
export const recalculateResumeMode = (
  intended: QaCapabilityMode,
  requirementsPass: boolean,
): QaCapabilityMode => (intended === "FULL_QA" && requirementsPass ? "FULL_QA" : "MANUAL_ONLY");
type OperationResult = Readonly<{
  state: "ACTIVE" | "SUSPENDED";
  version: number;
  mode: QaCapabilityMode;
  intendedMode: QaCapabilityMode;
  replayed: boolean;
}>;

export class InMemoryProjectSuspensionService {
  state: "ACTIVE" | "SUSPENDED" = "ACTIVE";
  version = 1;
  mode: QaCapabilityMode;
  readonly intendedMode: QaCapabilityMode;
  readonly audit: unknown[] = [];
  readonly #replays = new Map<string, Readonly<{ hash: string; result: OperationResult }>>();
  #tail = Promise.resolve();
  constructor(mode: QaCapabilityMode) {
    this.mode = mode;
    this.intendedMode = mode;
  }
  async #locked<T>(work: () => T | Promise<T>): Promise<T> {
    const prior = this.#tail;
    let release!: () => void;
    this.#tail = new Promise<void>((r) => {
      release = r;
    });
    await prior;
    try {
      return await work();
    } finally {
      release();
    }
  }
  async suspend(
    input: Readonly<{
      expectedVersion: number;
      idempotencyKey: string;
      incidentRef: string;
      reason: string;
    }>,
  ) {
    return this.#locked(() => {
      const hash = JSON.stringify(input),
        old = this.#replays.get(input.idempotencyKey);
      if (old) {
        if (old.hash !== hash) throw new Error("PROJECT_OPERATION_IDEMPOTENCY_CONFLICT");
        return { ...old.result, replayed: true };
      }
      if (!input.incidentRef || !input.reason.trim())
        throw new Error("PROJECT_SUSPEND_INCIDENT_REASON_REQUIRED");
      if (input.expectedVersion !== this.version || this.state !== "ACTIVE")
        throw new Error("ONBOARDING_VERSION_CONFLICT");
      this.state = "SUSPENDED";
      this.version++;
      const result = Object.freeze({
        state: this.state,
        version: this.version,
        mode: this.mode,
        intendedMode: this.intendedMode,
        replayed: false,
      });
      this.audit.push(
        Object.freeze({
          action: "PROJECT_SUSPENDED",
          incidentRef: input.incidentRef,
          reason: input.reason,
          before: "ACTIVE",
          after: "SUSPENDED",
        }),
      );
      this.#replays.set(input.idempotencyKey, { hash, result });
      return result;
    });
  }
  async resume(
    input: Readonly<{
      expectedVersion: number;
      idempotencyKey: string;
      probesFresh: boolean;
      incidentAccepted: boolean;
      stepUp: boolean;
      distinctOwnerApproval: boolean;
      requirementsPass: boolean;
    }>,
  ) {
    return this.#locked(() => {
      const hash = JSON.stringify(input),
        old = this.#replays.get(input.idempotencyKey);
      if (old) {
        if (old.hash !== hash) throw new Error("PROJECT_OPERATION_IDEMPOTENCY_CONFLICT");
        return { ...old.result, replayed: true };
      }
      if (
        !input.probesFresh ||
        !input.incidentAccepted ||
        !input.stepUp ||
        !input.distinctOwnerApproval
      )
        throw new Error("PROJECT_RESUME_PREREQUISITE_STALE");
      if (input.expectedVersion !== this.version || this.state !== "SUSPENDED")
        throw new Error("ONBOARDING_VERSION_CONFLICT");
      this.state = "ACTIVE";
      this.mode = recalculateResumeMode(this.intendedMode, input.requirementsPass);
      this.version++;
      const result = Object.freeze({
        state: this.state,
        version: this.version,
        mode: this.mode,
        intendedMode: this.intendedMode,
        replayed: false,
      });
      this.audit.push(
        Object.freeze({
          action: "PROJECT_RESUMED",
          before: "SUSPENDED",
          after: "ACTIVE",
          mode: this.mode,
        }),
      );
      this.#replays.set(input.idempotencyKey, { hash, result });
      return result;
    });
  }
}
