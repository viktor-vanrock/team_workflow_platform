/**
 * Deterministic test harness for the durable command contract.
 *
 * Production workers claim durable records directly from PostgreSQL. This
 * in-memory transport exists only so tests can exercise crash and envelope
 * validation without introducing a runtime broker dependency.
 */
export interface QueueClock {
  now(): Date;
}

export interface QueueCommand {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actor: Readonly<{ principalId: string }>;
  readonly correlationId: string;
  readonly causationId: string;
  readonly rowVersion: number;
  readonly commandType: string;
  readonly effectIdempotencyKey: string;
  readonly target: unknown;
  readonly payload: unknown;
  readonly bindingRef: unknown;
  readonly profileRef: unknown;
  readonly initialAuthorizationBasis: unknown;
  readonly effectAuthorizationBasis?: unknown;
}

export interface QueueDurableCommandStore {
  command(): QueueCommand;
  deliverable(now: Date): boolean;
  markEnqueued(now: Date): void;
  markDispatched(now: Date, leaseMs: number): void;
  confirm(result: unknown, now: Date): void;
  recover(now: Date): void;
}

export interface QueueStageAuditor {
  record(
    input: Readonly<{
      stage: "DISPATCHER" | "WORKER";
      workspaceId: string;
      projectId: string;
      action: string;
      initialAuthorizationBasis?: unknown;
      effectAuthorizationBasis?: unknown;
      bindingRef?: unknown;
      profileRef?: unknown;
      resultCode: string;
      reasonCode: string;
      attributes?: Readonly<Record<string, unknown>>;
    }>,
  ): Promise<unknown>;
}

export interface CommandJobEnvelope {
  readonly schemaVersion: 1;
  readonly commandId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actor: Readonly<{ principalId: string }>;
  readonly correlationId: string;
  readonly causationId: string;
  readonly rowVersion: number;
}

export function validateJobEnvelope(envelope: CommandJobEnvelope, command: QueueCommand): void {
  if (
    envelope.schemaVersion !== 1 ||
    envelope.commandId !== command.id ||
    envelope.workspaceId !== command.workspaceId ||
    envelope.projectId !== command.projectId ||
    envelope.actor.principalId !== command.actor.principalId ||
    envelope.correlationId !== command.correlationId ||
    envelope.causationId !== command.causationId
  ) {
    throw new Error("JOB_ENVELOPE_MISMATCH");
  }
  if (envelope.rowVersion > command.rowVersion) throw new Error("JOB_ENVELOPE_FUTURE_VERSION");
}

export class InMemoryRecoverableQueue {
  readonly #jobs = new Map<string, CommandJobEnvelope>();

  add(envelope: CommandJobEnvelope): void {
    this.#jobs.set(envelope.commandId, structuredClone(envelope));
  }

  take(): CommandJobEnvelope | undefined {
    const first = this.#jobs.entries().next();
    if (first.done) return undefined;
    this.#jobs.delete(first.value[0]);
    return structuredClone(first.value[1]);
  }

  clear(): void {
    this.#jobs.clear();
  }
  get size(): number {
    return this.#jobs.size;
  }
}

export function envelopeFromStore(store: QueueDurableCommandStore): CommandJobEnvelope {
  const command = store.command();
  return {
    schemaVersion: 1,
    commandId: command.id,
    workspaceId: command.workspaceId,
    projectId: command.projectId,
    actor: command.actor,
    correlationId: command.correlationId,
    causationId: command.causationId,
    rowVersion: command.rowVersion,
  };
}

export class OutboxDispatcher {
  constructor(
    private readonly store: QueueDurableCommandStore,
    private readonly queue: InMemoryRecoverableQueue,
    private readonly clock: QueueClock,
    private readonly audit?: QueueStageAuditor,
  ) {}

  async dispatch(): Promise<boolean> {
    if (!this.store.deliverable(this.clock.now())) return false;
    const command = this.store.command();
    this.queue.add(envelopeFromStore(this.store));
    this.store.markEnqueued(this.clock.now());
    await this.audit?.record({
      stage: "DISPATCHER",
      workspaceId: command.workspaceId,
      projectId: command.projectId,
      action: command.commandType,
      initialAuthorizationBasis: command.initialAuthorizationBasis,
      bindingRef: command.bindingRef,
      profileRef: command.profileRef,
      resultCode: "ENQUEUED",
      reasonCode: "OUTBOX_DISPATCHED",
      attributes: { commandId: command.id },
    });
    return true;
  }
}

export interface CommandEffectInvoker {
  invoke(effectIdempotencyKey: string, command: QueueCommand): Promise<unknown>;
}

export class CommandWorker {
  constructor(
    private readonly store: QueueDurableCommandStore,
    private readonly queue: InMemoryRecoverableQueue,
    private readonly broker: CommandEffectInvoker,
    private readonly clock: QueueClock,
    private readonly audit?: QueueStageAuditor,
  ) {}

  async work(options: Readonly<{ crashAfterEffect?: boolean }> = {}): Promise<boolean> {
    const envelope = this.queue.take();
    if (!envelope) return false;
    const command = this.store.command();
    validateJobEnvelope(envelope, command);
    this.store.markDispatched(this.clock.now(), 60_000);
    await this.audit?.record({
      stage: "WORKER",
      workspaceId: command.workspaceId,
      projectId: command.projectId,
      action: command.commandType,
      initialAuthorizationBasis: command.initialAuthorizationBasis,
      bindingRef: command.bindingRef,
      profileRef: command.profileRef,
      resultCode: "DISPATCHED",
      reasonCode: "EFFECT_GATE_ALLOWED",
      attributes: { commandId: command.id },
    });
    const result = await this.broker.invoke(command.effectIdempotencyKey, command);
    if (options.crashAfterEffect) throw new Error("CRASH_AFTER_EFFECT");
    this.store.confirm(result, this.clock.now());
    return true;
  }
}

export class RecoverySweeper {
  constructor(
    private readonly store: QueueDurableCommandStore,
    private readonly queue: InMemoryRecoverableQueue,
    private readonly clock: QueueClock,
  ) {}

  async sweep(): Promise<boolean> {
    this.store.recover(this.clock.now());
    if (!this.store.deliverable(this.clock.now())) return false;
    this.queue.add(envelopeFromStore(this.store));
    this.store.markEnqueued(this.clock.now());
    return true;
  }
}
