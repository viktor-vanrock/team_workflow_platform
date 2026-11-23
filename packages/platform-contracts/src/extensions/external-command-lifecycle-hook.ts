import type {
  PackAuditDelta,
  PackDomainEventDelta,
  PackOwnedTransaction,
} from "./confirmation-hook.ts";

export const externalCommandLifecyclePhases = Object.freeze([
  "APPROVAL_REJECTED",
  "APPROVAL_RELEASED",
  "EFFECT_INVOCATION_STARTED",
  "TERMINAL_FAILED",
] as const);

export type ExternalCommandLifecyclePhase = (typeof externalCommandLifecyclePhases)[number];

export interface ScopedExternalCommandContext {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly commandId: string;
  readonly commandType: string;
  readonly capabilityKey: string;
  readonly capabilityVersion: string;
  readonly operation: string;
  readonly source: Readonly<{ intakeDraftId?: string; sourceWorkItemId?: string }>;
  readonly bindingRef: Readonly<{ id: string; version: number }>;
  readonly profileRefs: readonly Readonly<{ id: string; version: number }>[];
  readonly effectIdempotencyKey: string;
  readonly correlationId: string;
  readonly causationId: string;
  readonly approvalId?: string;
  readonly commandResourceVersion: number;
}

export interface PackLifecycleDelta {
  readonly idempotencyKey: string;
  readonly replayed: boolean;
  readonly events?: readonly PackDomainEventDelta[];
  readonly audit?: readonly PackAuditDelta[];
}

export interface ExternalCommandLifecycleTransaction extends PackOwnedTransaction {
  readonly phase: ExternalCommandLifecyclePhase;
}

export interface ExternalCommandLifecycleContribution {
  readonly key: string;
  readonly order?: number;
  matches(input: ScopedExternalCommandContext): boolean;
  apply(
    phase: ExternalCommandLifecyclePhase,
    input: ScopedExternalCommandContext,
    transaction: ExternalCommandLifecycleTransaction,
  ): Promise<PackLifecycleDelta>;
}

export interface ExternalCommandLifecycleUnitOfWork {
  execute<T>(
    phase: ExternalCommandLifecyclePhase,
    input: ScopedExternalCommandContext,
    coreTransition: (transaction: PackOwnedTransaction) => Promise<T>,
  ): Promise<Readonly<{ result: T; deltas: readonly PackLifecycleDelta[] }>>;
}
