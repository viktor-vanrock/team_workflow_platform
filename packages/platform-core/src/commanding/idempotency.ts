import type { Approval } from "../approval/approval.ts";
import type { ConnectorCommand } from "./connector-command.ts";

export interface ClientRequestIdentity {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly operation: string;
  readonly clientKey: string;
}
export interface ClientRequestIdempotencyRecord extends ClientRequestIdentity {
  readonly requestHash: string;
  readonly commandId: string;
  readonly createdAt: Date;
}
export interface GatewayCommit {
  readonly command: ConnectorCommand;
  readonly idempotency: ClientRequestIdempotencyRecord;
  readonly mutation: unknown;
  readonly audit: unknown;
  readonly outbox: unknown;
  readonly approval?: Approval;
}
export interface CommandGatewayUnitOfWork {
  find(
    identity: ClientRequestIdentity,
  ):
    | ClientRequestIdempotencyRecord
    | undefined
    | Promise<ClientRequestIdempotencyRecord | undefined>;
  command(
    workspaceId: string,
    projectId: string,
    id: string,
  ): ConnectorCommand | undefined | Promise<ConnectorCommand | undefined>;
  commit(value: GatewayCommit): void | Promise<void>;
}
const identityKey = (value: ClientRequestIdentity) =>
  `${value.workspaceId}\0${value.projectId}\0${value.actorId}\0${value.operation}\0${value.clientKey}`;

export class InMemoryCommandUnitOfWork implements CommandGatewayUnitOfWork {
  readonly #records = new Map<string, ClientRequestIdempotencyRecord>();
  readonly #commands = new Map<string, ConnectorCommand>();
  readonly #mutations: unknown[] = [];
  readonly #audits: unknown[] = [];
  readonly #outbox: unknown[] = [];
  readonly #approvals = new Map<string, Approval>();
  find(identity: ClientRequestIdentity): ClientRequestIdempotencyRecord | undefined {
    const value = this.#records.get(identityKey(identity));
    return value ? structuredClone(value) : undefined;
  }
  command(_workspaceId: string, _projectId: string, id: string): ConnectorCommand | undefined {
    const value = this.#commands.get(id);
    return value ? structuredClone(value) : undefined;
  }
  commit(value: GatewayCommit): void {
    const key = identityKey(value.idempotency);
    if (this.#records.has(key) || this.#commands.has(value.command.id))
      throw new Error("IDEMPOTENCY_CONCURRENT_CLAIM");
    this.#records.set(key, structuredClone(value.idempotency));
    this.#commands.set(value.command.id, structuredClone(value.command));
    this.#mutations.push(structuredClone(value.mutation));
    this.#audits.push(structuredClone(value.audit));
    this.#outbox.push(structuredClone(value.outbox));
    if (value.approval) this.#approvals.set(value.approval.id, structuredClone(value.approval));
  }
  snapshot(): Readonly<{
    mutations: number;
    commands: number;
    idempotencyRecords: number;
    auditEvents: number;
    outboxRecords: number;
    approvals: number;
  }> {
    return Object.freeze({
      mutations: this.#mutations.length,
      commands: this.#commands.size,
      idempotencyRecords: this.#records.size,
      auditEvents: this.#audits.length,
      outboxRecords: this.#outbox.length,
      approvals: this.#approvals.size,
    });
  }
}
