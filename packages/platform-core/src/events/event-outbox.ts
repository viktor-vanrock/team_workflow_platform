import type { EventEnvelope } from "./event-envelope.ts";

export interface EventOutboxPort {
  append(envelope: EventEnvelope): Promise<void>;
  ready(): Promise<readonly EventEnvelope[]>;
  acknowledge(id: string): Promise<void>;
}
export interface EventPublisher {
  publish(envelope: EventEnvelope): Promise<void>;
}
export class EventOutboxPublisher {
  constructor(
    private readonly outbox: EventOutboxPort,
    private readonly publisher: EventPublisher,
  ) {}
  async flush(): Promise<number> {
    let count = 0;
    for (const envelope of await this.outbox.ready()) {
      await this.publisher.publish(envelope);
      await this.outbox.acknowledge(envelope.eventId);
      count += 1;
    }
    return count;
  }
}
