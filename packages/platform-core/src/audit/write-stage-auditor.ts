import { type JsonValue, sha256 } from "@awp/platform-contracts";

import { redactAuditAttributes } from "./redaction.ts";

export type WriteStage =
  "GATEWAY" | "DISPATCHER" | "WORKER" | "BROKER" | "CONFIRMATION" | "WEBHOOK";
export interface WriteStageAuditEvent {
  readonly id: string;
  readonly stage: WriteStage;
  readonly workspaceId: string;
  readonly projectId?: string;
  readonly action: string;
  readonly initialAuthorizationBasis?: unknown;
  readonly effectAuthorizationBasis?: unknown;
  readonly bindingRef?: unknown;
  readonly profileRef?: unknown;
  readonly resultCode: string;
  readonly reasonCode: string;
  readonly resultHash: string;
  readonly attributes: Readonly<Record<string, string | number | boolean | null>>;
}
export interface StageAuditPort {
  append(event: WriteStageAuditEvent): Promise<void>;
}
export class InMemoryStageAudit implements StageAuditPort {
  readonly #events: WriteStageAuditEvent[] = [];
  async append(event: WriteStageAuditEvent): Promise<void> {
    this.#events.push(structuredClone(event));
  }
  events(): readonly WriteStageAuditEvent[] {
    return structuredClone(this.#events);
  }
  async update(id: string, patch: unknown): Promise<never> {
    void id;
    void patch;
    throw new Error("AUDIT_APPEND_ONLY");
  }
}
export class WriteStageAuditor {
  #sequence = 0;
  constructor(private readonly port: StageAuditPort) {}
  async record(
    input: Omit<WriteStageAuditEvent, "id" | "resultHash" | "attributes"> &
      Readonly<{ attributes?: Readonly<Record<string, unknown>> }>,
  ): Promise<WriteStageAuditEvent> {
    this.#sequence += 1;
    const event: WriteStageAuditEvent = Object.freeze({
      ...input,
      id: `audit-${this.#sequence}`,
      resultHash: sha256({
        resultCode: input.resultCode,
        reasonCode: input.reasonCode,
      } as JsonValue),
      attributes: redactAuditAttributes(input.attributes ?? {}),
    });
    await this.port.append(event);
    return event;
  }
}
