export interface ConfirmationTransaction {
  readonly transactionId: string;
  readonly native: unknown;
}

/** Feature 001 compatibility input. New effects use ConfirmedOperationalEffect. */
export interface ConfirmationHookInput<TResult = unknown> {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly commandId: string;
  readonly result: TResult;
  readonly workItemId: string;
  readonly sourceDraftId?: string;
  readonly bindingRef: Readonly<{ id: string; version: number }>;
  readonly profileRef: Readonly<{ id: string; version: number }>;
}

/** Feature 001 compatibility hook, retained as an adapter surface. */
export interface TransactionAwareConfirmationHook<TResult = unknown> {
  readonly componentRef: string;
  confirm(
    transaction: ConfirmationTransaction,
    input: ConfirmationHookInput<TResult>,
  ): Promise<void>;
}

export interface ConfirmedOperationalEffect<TResult = unknown> {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly commandId: string;
  readonly effectIdempotencyKey: string;
  readonly capabilityKey: string;
  readonly capabilityVersion: string;
  readonly operation: string;
  readonly result: TResult;
  readonly source: Readonly<{ intakeDraftId?: string; sourceWorkItemId?: string }>;
  readonly bindingRef: Readonly<{ id: string; version: number }>;
  readonly profileRefs: readonly Readonly<{ id: string; version: number }>[];
  readonly correlationId: string;
  readonly causationId: string;
}

export interface CoreMutationRefs {
  readonly workItemId?: string;
  readonly sourceDraftId?: string;
  readonly operationalBindingId?: string;
  readonly resultRefs?: Readonly<Record<string, string>>;
}

export interface PackOwnedTransaction extends ConfirmationTransaction {
  readonly contributionKey: string;
  readonly idempotencyKey: string;
}

export interface PackDomainEventDelta {
  readonly eventType: string;
  readonly entityId: string;
  readonly payload: unknown;
}

export interface PackAuditDelta {
  readonly action: string;
  readonly outcome: "SUCCEEDED" | "FAILED" | "REPLAYED";
  readonly reasonCode: string;
  readonly attributes?: Readonly<Record<string, unknown>>;
}

export interface PackConfirmationDelta {
  readonly idempotencyKey: string;
  readonly replayed: boolean;
  readonly events?: readonly PackDomainEventDelta[];
  readonly audit?: readonly PackAuditDelta[];
}

export interface OperationalConfirmationHook<TResult = unknown> {
  readonly key: string;
  readonly order?: number;
  matches(input: ConfirmedOperationalEffect<TResult>): boolean;
  apply(
    input: ConfirmedOperationalEffect<TResult> & CoreMutationRefs,
    transaction: PackOwnedTransaction,
  ): Promise<PackConfirmationDelta>;
}
