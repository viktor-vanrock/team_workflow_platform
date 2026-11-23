import {
  type ConfirmationHookInput,
  type ConfirmationTransaction,
  type JsonValue,
  sha256,
  type TransactionAwareConfirmationHook,
} from "@awp/platform-contracts";

import type { WriteStageAuditor } from "../audit/write-stage-auditor.ts";
import type { ConfigurationPinSet } from "./operational-authority.ts";

export interface OperationalCreateIdentity {
  readonly sourceId: string;
  readonly sourceVersion: number;
  readonly operation: string;
  readonly configurationHash: `sha256:${string}`;
  readonly effectId: `sha256:${string}`;
  readonly effectMarker: string;
}

export interface OperationalCreateCommandIdentity {
  readonly operationalIdentity: OperationalCreateIdentity;
  readonly commandId: string;
  readonly effectIdempotencyKey: string;
}

export function deriveOperationalCreateIdentity(
  input: Readonly<{
    sourceId: string;
    sourceVersion: number;
    operation: string;
    pins: ConfigurationPinSet;
  }>,
): OperationalCreateIdentity {
  if (!input.sourceId || !Number.isSafeInteger(input.sourceVersion) || input.sourceVersion < 1)
    throw new Error("OPERATIONAL_CREATE_SOURCE_INVALID");
  const configurationHash = sha256(input.pins.entries as unknown as JsonValue);
  const effectId = sha256({
    sourceId: input.sourceId,
    sourceVersion: input.sourceVersion,
    operation: input.operation,
    configurationHash,
  });
  return Object.freeze({
    sourceId: input.sourceId,
    sourceVersion: input.sourceVersion,
    operation: input.operation,
    configurationHash,
    effectId,
    effectMarker: `awp:${effectId.slice(7)}`,
  });
}

function deterministicUuid(namespace: string): string {
  const hex = sha256(namespace).slice(7, 39).split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}

export function deriveOperationalCreateCommandIdentity(
  input: Readonly<{
    sourceId: string;
    sourceVersion: number;
    operation: string;
    pins: ConfigurationPinSet;
    commandNamespace: string;
  }>,
): OperationalCreateCommandIdentity {
  if (!input.commandNamespace.trim())
    throw new Error("OPERATIONAL_CREATE_COMMAND_NAMESPACE_REQUIRED");
  const operationalIdentity = deriveOperationalCreateIdentity(input);
  const commandId = deterministicUuid(`${input.commandNamespace}:${operationalIdentity.effectId}`);
  return Object.freeze({
    operationalIdentity,
    commandId,
    effectIdempotencyKey: `awp:effect:${commandId}`,
  });
}

/** Feature 001 compatibility UoW. Multi-effect confirmation uses OperationalConfirmationUnitOfWork. */
export interface ConfirmationUnitOfWork {
  confirm<T>(work: (transaction: ConfirmationTransaction) => Promise<T>): Promise<T>;
}

/** Feature 001 compatibility adapter retained for the Dummy Pack. */
export class ConfirmOperationalCreate {
  constructor(
    private readonly unitOfWork: ConfirmationUnitOfWork,
    private readonly hooks: ReadonlyMap<string, TransactionAwareConfirmationHook>,
    private readonly audit?: WriteStageAuditor,
  ) {}

  async confirm(componentRef: string, input: ConfirmationHookInput): Promise<void> {
    const hook = this.hooks.get(componentRef);
    if (!hook) throw new Error("CONFIRMATION_HOOK_NOT_FOUND");
    await this.unitOfWork.confirm(async (transaction) => {
      await hook.confirm(transaction, input);
    });
    await this.audit?.record({
      stage: "CONFIRMATION",
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      action: "command.confirm",
      bindingRef: input.bindingRef,
      profileRef: input.profileRef,
      resultCode: "CONFIRMED",
      reasonCode: "ATOMIC_CONFIRMATION",
      attributes: { commandId: input.commandId },
    });
  }
}
