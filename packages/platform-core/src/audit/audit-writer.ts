import type { Clock, IdGenerator, WorkspaceContext } from "../shared/primitives.ts";
import type { AppendOnlyAuditPort, AuditEvent } from "./audit-port.ts";
import { redactAuditAttributes } from "./redaction.ts";

export class AuditWriter {
  constructor(
    private readonly port: AppendOnlyAuditPort,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}
  async write(
    context: WorkspaceContext,
    input: {
      readonly action: string;
      readonly outcome: AuditEvent["outcome"];
      readonly reasonCode: string;
      readonly classification: AuditEvent["classification"];
      readonly versionRefs?: AuditEvent["versionRefs"];
      readonly attributes?: Readonly<Record<string, unknown>>;
    },
  ): Promise<AuditEvent> {
    const event: AuditEvent = Object.freeze({
      id: this.ids.next(),
      occurredAt: this.clock.now(),
      scope: context.scope,
      actor: context.actor,
      action: input.action,
      outcome: input.outcome,
      reasonCode: input.reasonCode,
      correlationId: context.correlationId,
      causationId: context.causationId,
      ...(context.authorizationBasis === undefined
        ? {}
        : { authorizationBasis: context.authorizationBasis }),
      classification: input.classification,
      versionRefs: Object.freeze([...(input.versionRefs ?? [])]),
      attributes: redactAuditAttributes(input.attributes ?? {}),
    });
    await this.port.append(event);
    return event;
  }
}
