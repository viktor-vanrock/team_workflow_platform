import { buildQaJiraGitLabMattermostQueueLocalFixture } from "../../packages/runtime-composition/src/seed/qa-jira-gitlab-mattermost-queue-local-seed.ts";

export class QueueVirtualClock {
  #now: number;
  constructor(initialNow = buildQaJiraGitLabMattermostQueueLocalFixture().virtualClock.initialNow) {
    this.#now = Date.parse(initialNow);
  }
  now(): string {
    return new Date(this.#now).toISOString();
  }
  advance(seconds: number): string {
    if (!Number.isSafeInteger(seconds) || seconds < 0)
      throw new Error("QUEUE_VIRTUAL_CLOCK_ADVANCE_INVALID");
    this.#now += seconds * 1_000;
    return this.now();
  }
}

export interface QueueFaultState {
  readonly scenarioId: string;
  readonly remaining: number;
  readonly revision: number;
}

/** Test adapter for the same durable compare-and-set semantics used by local orchestration. */
export class PersistentQueueFaultState {
  constructor(
    private readonly storage: Map<string, QueueFaultState>,
    private readonly key = "queue-local-fault",
  ) {}
  current(): QueueFaultState {
    return (
      this.storage.get(this.key) ??
      Object.freeze({ scenarioId: "NORMAL", remaining: 0, revision: 0 })
    );
  }
  set(
    scenarioId: string,
    remaining: number,
    expectedRevision = this.current().revision,
  ): QueueFaultState {
    if (!scenarioId || !Number.isSafeInteger(remaining) || remaining < 0)
      throw new Error("QUEUE_FAULT_STATE_INVALID");
    const current = this.current();
    if (current.revision !== expectedRevision) throw new Error("QUEUE_FAULT_STATE_CONFLICT");
    const next = Object.freeze({ scenarioId, remaining, revision: current.revision + 1 });
    this.storage.set(this.key, next);
    return next;
  }
  consume(): QueueFaultState {
    const current = this.current();
    if (current.remaining === 0) return current;
    return this.set(
      current.remaining === 1 ? "NORMAL" : current.scenarioId,
      current.remaining - 1,
      current.revision,
    );
  }
}

export function createQueueFixture() {
  const seed = buildQaJiraGitLabMattermostQueueLocalFixture();
  return Object.freeze({
    seed,
    clock: new QueueVirtualClock(seed.virtualClock.initialNow),
    faultStorage: new Map<string, QueueFaultState>(),
  });
}
