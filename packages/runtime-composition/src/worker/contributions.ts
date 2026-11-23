import type { ConnectorCommand } from "@awp/platform-core";
import { measured } from "@awp/platform-runtime-nest";

export interface NamedWorkerContribution {
  readonly key: string;
  readonly capabilityKeys: readonly string[];
  readonly recovery: Readonly<{ markedEffectPolicy: "SAFE_RETRY" | "LOOKUP_ONLY" }>;
  handle(command: ConnectorCommand): Promise<unknown>;
}

/**
 * PostgreSQL retains this scheduling hint and the authoritative command body.
 * Workers reconstruct the exact command before selecting a capability owner.
 */
export interface CommandSchedulingHint {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly commandId: string;
  readonly capabilityKey: string;
}

export interface CommandSchedulingScope {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly commandId: string;
}

export interface DurableWorkerLoopStep {
  run(): Promise<unknown>;
}
export interface DurableWorkerLoopContribution {
  readonly key: string;
  readonly recovery: DurableWorkerLoopStep;
  readonly dispatcher: DurableWorkerLoopStep;
  readonly commands: DurableWorkerLoopStep;
}

export function closeWorkerLoopContribution(
  key: string,
  steps: Readonly<{
    recovery: DurableWorkerLoopStep;
    dispatcher: DurableWorkerLoopStep;
    commands: DurableWorkerLoopStep;
  }>,
): DurableWorkerLoopContribution {
  const normalized = requiredHintField(key, "WORKER_LOOP_CONTRIBUTION_KEY_INVALID");
  return Object.freeze({
    key: normalized,
    recovery: steps.recovery,
    dispatcher: steps.dispatcher,
    commands: steps.commands,
  });
}

const idleDurableWorkerStep: DurableWorkerLoopStep = Object.freeze({ run: async () => undefined });

/** Closes a durable dispatcher that has no command lane or recovery lease of its own. */
export function closeDispatcherOnlyWorkerContribution(
  key: string,
  dispatcher: DurableWorkerLoopStep,
): DurableWorkerLoopContribution {
  return closeWorkerLoopContribution(
    key,
    Object.freeze({
      recovery: idleDurableWorkerStep,
      dispatcher,
      commands: idleDurableWorkerStep,
    }),
  );
}

/** Closes the GitLab repair topology: fenced cursor scheduling precedes outbox delivery. */
export function closeReconciliationWorkerContribution(
  key: string,
  steps: Readonly<{
    pollScheduler: DurableWorkerLoopStep;
    authoritativeReads: DurableWorkerLoopStep;
  }>,
): DurableWorkerLoopContribution {
  return closeWorkerLoopContribution(
    key,
    Object.freeze({
      recovery: steps.pollScheduler,
      dispatcher: steps.authoritativeReads,
      commands: idleDurableWorkerStep,
    }),
  );
}

export type CommandSchedulingLoader = (
  scope: CommandSchedulingScope,
) => Promise<ConnectorCommand | undefined>;

function requiredHintField(value: string, code: string): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 255 || /\p{Cc}/u.test(normalized)) {
    throw new Error(code);
  }
  return normalized;
}

export function createCommandSchedulingHint(command: ConnectorCommand): CommandSchedulingHint {
  return Object.freeze({
    workspaceId: requiredHintField(command.workspaceId, "WORKER_COMMAND_HINT_WORKSPACE_INVALID"),
    projectId: requiredHintField(command.projectId, "WORKER_COMMAND_HINT_PROJECT_INVALID"),
    commandId: requiredHintField(command.id, "WORKER_COMMAND_HINT_ID_INVALID"),
    capabilityKey: requiredHintField(
      command.capability.key,
      "WORKER_COMMAND_HINT_CAPABILITY_INVALID",
    ),
  });
}

export async function reconstructCommandFromHint(
  hint: CommandSchedulingHint,
  load: CommandSchedulingLoader,
): Promise<ConnectorCommand> {
  const scope = Object.freeze({
    workspaceId: requiredHintField(hint.workspaceId, "WORKER_COMMAND_HINT_WORKSPACE_INVALID"),
    projectId: requiredHintField(hint.projectId, "WORKER_COMMAND_HINT_PROJECT_INVALID"),
    commandId: requiredHintField(hint.commandId, "WORKER_COMMAND_HINT_ID_INVALID"),
  });
  const capabilityKey = requiredHintField(
    hint.capabilityKey,
    "WORKER_COMMAND_HINT_CAPABILITY_INVALID",
  );
  const command = await load(scope);
  if (!command) throw new Error("WORKER_COMMAND_NOT_FOUND");
  if (
    command.workspaceId !== scope.workspaceId ||
    command.projectId !== scope.projectId ||
    command.id !== scope.commandId ||
    command.capability.key !== capabilityKey
  ) {
    throw new Error("WORKER_COMMAND_HINT_MISMATCH");
  }
  return command;
}

export class CapabilityCommandRouter {
  readonly #owners = new Map<string, NamedWorkerContribution>();
  constructor(contributions: readonly NamedWorkerContribution[]) {
    for (const contribution of contributions) {
      for (const capabilityKey of contribution.capabilityKeys) {
        if (this.#owners.has(capabilityKey))
          throw new Error(`WORKER_CAPABILITY_OWNER_COLLISION:${capabilityKey}`);
        this.#owners.set(capabilityKey, contribution);
      }
    }
  }
  ownerFor(capabilityKey: string): NamedWorkerContribution {
    const owner = this.#owners.get(capabilityKey);
    if (!owner) throw new Error(`WORKER_CAPABILITY_OWNER_NOT_FOUND:${capabilityKey}`);
    return owner;
  }
  async route(command: ConnectorCommand): Promise<unknown> {
    return await measured(
      "worker.commands",
      {
        component: "worker",
        workspaceId: command.workspaceId,
        projectId: command.projectId,
        correlationId: command.correlationId,
        causationId: command.causationId,
      },
      () => this.ownerFor(command.capability.key).handle(command),
    );
  }
  capabilities(): readonly string[] {
    return Object.freeze([...this.#owners.keys()].sort());
  }
}

export function defineWorkerContribution(value: NamedWorkerContribution): NamedWorkerContribution {
  if (
    !value.key ||
    value.capabilityKeys.length === 0 ||
    new Set(value.capabilityKeys).size !== value.capabilityKeys.length
  )
    throw new Error("WORKER_CONTRIBUTION_INVALID");
  return Object.freeze(value);
}

/**
 * Declares ownership for commands consumed by a dedicated PostgreSQL polling
 * worker. Direct router execution is rejected so API/runtime composition cannot
 * accidentally turn a durable command into an inline provider call.
 */
export function definePollingOnlyWorkerContribution(
  input: Readonly<{
    key: string;
    capabilityKey: string;
    operation: string;
    recovery: NamedWorkerContribution["recovery"];
  }>,
): NamedWorkerContribution {
  return defineWorkerContribution({
    key: input.key,
    capabilityKeys: Object.freeze([input.capabilityKey]),
    recovery: input.recovery,
    async handle(command) {
      if (
        command.capability.key !== input.capabilityKey ||
        command.capability.operation !== input.operation
      ) {
        throw new Error(`WORKER_POLLING_COMMAND_MISMATCH:${input.key}`);
      }
      throw new Error(`WORKER_POLLING_DELIVERY_REQUIRED:${input.key}:${command.id}`);
    },
  });
}
