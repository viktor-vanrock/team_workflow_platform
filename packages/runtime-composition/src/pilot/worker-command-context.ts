import { AsyncLocalStorage } from "node:async_hooks";
import type { DataSource } from "typeorm";

import type { ConnectorCommand } from "@awp/platform-core";
import { TypeOrmCommandRepository } from "@awp/platform-persistence-typeorm";

import type { CorporateConnectorCommandAdmission } from "./connector-authority.ts";
import type { CorporateConnectorBinding } from "./connector-factories.ts";
import type { PilotCommandEffectGuard } from "./effect-guard.ts";

/** Binds provider writes to one durable command in the current asynchronous worker call. */
export class CorporateWorkerCommandContext implements CorporateConnectorCommandAdmission {
  readonly #scope = new AsyncLocalStorage<
    Readonly<{ workspaceId: string; projectId: string; commandId: string }>
  >();
  readonly #commands: TypeOrmCommandRepository;

  constructor(
    source: DataSource,
    readonly guard: PilotCommandEffectGuard,
  ) {
    if (!source.isInitialized || !guard)
      throw new Error("CORPORATE_WORKER_COMMAND_CONTEXT_REQUIRED");
    this.#commands = new TypeOrmCommandRepository(source);
  }

  async run<T>(command: ConnectorCommand, work: () => Promise<T>): Promise<T> {
    if (this.#scope.getStore()) throw new Error("CORPORATE_WORKER_COMMAND_CONTEXT_NESTED");
    const scope = Object.freeze({
      workspaceId: command.workspaceId,
      projectId: command.projectId,
      commandId: command.id,
    });
    const current = await this.#commands.get(scope.workspaceId, scope.projectId, scope.commandId);
    if (
      !current ||
      current.actor.principalId !== command.actor.principalId ||
      current.payloadHash !== command.payloadHash ||
      current.targetHash !== command.targetHash
    )
      throw new Error("CORPORATE_WORKER_COMMAND_CONTEXT_INVALID");
    await this.guard.assertCommandAllowed(current);
    return await this.#scope.run(scope, work);
  }

  async load(binding: CorporateConnectorBinding): Promise<ConnectorCommand | undefined> {
    const scope = this.#scope.getStore();
    if (
      !scope ||
      binding.workspaceId !== scope.workspaceId ||
      binding.projectId !== scope.projectId
    )
      return undefined;
    return await this.#commands.get(scope.workspaceId, scope.projectId, scope.commandId);
  }
}
