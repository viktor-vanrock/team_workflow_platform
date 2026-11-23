import { type ProjectEventEnvelope, ProjectEventInbox } from "@awp/platform-core";

export interface OnboardingEventSource {
  ready(): Promise<readonly ProjectEventEnvelope[]>;
  acknowledge(eventId: string): Promise<void>;
  quarantine(event: ProjectEventEnvelope, reason: string): Promise<void>;
}

export interface OnboardingProjectionSink {
  apply(event: ProjectEventEnvelope): Promise<void>;
}

export class ProjectOnboardingEventWorker {
  readonly #inbox = new ProjectEventInbox();
  readonly #applied = new Set<string>();

  constructor(
    private readonly source: OnboardingEventSource,
    private readonly sink: OnboardingProjectionSink,
  ) {}

  async run(): Promise<Readonly<{ applied: number; duplicates: number; quarantined: number }>> {
    let applied = 0;
    let duplicates = 0;
    let quarantined = 0;
    for (const event of await this.source.ready()) {
      const disposition = this.#inbox.accept(event);
      if (disposition === "QUARANTINED_MISMATCH") {
        await this.source.quarantine(event, "EVENT_REPLAY_HASH_MISMATCH");
        quarantined += 1;
        continue;
      }
      if (disposition === "DUPLICATE" && this.#applied.has(event.payload.eventId)) {
        duplicates += 1;
      } else {
        await this.sink.apply(event);
        // A transient sink failure must remain retryable before acknowledging the outbox.
        this.#applied.add(event.payload.eventId);
        applied += 1;
      }
      await this.source.acknowledge(event.payload.eventId);
    }
    return Object.freeze({ applied, duplicates, quarantined });
  }
}
