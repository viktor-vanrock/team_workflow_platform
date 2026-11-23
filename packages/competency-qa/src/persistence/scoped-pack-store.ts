import { assertQaScope, type QaScope } from "../domain/primitives.ts";

export interface QaScopedRecord {
  readonly workspaceId: string;
  readonly projectId: string;
}

export interface QaScopedAggregate extends QaScopedRecord {
  readonly id: string;
  readonly resourceVersion: number;
}

export interface QaScopedRepository<TAggregate extends QaScopedAggregate> {
  get(scope: QaScope, id: string): Promise<TAggregate | undefined>;
  insert(scope: QaScope, aggregate: TAggregate): Promise<void>;
  compareAndSwap(
    scope: QaScope,
    id: string,
    expectedResourceVersion: number,
    next: TAggregate,
  ): Promise<boolean>;
}

export interface QaScopedInsertOnlyRepository<TRecord extends QaScopedRecord> {
  get(scope: QaScope, id: string): Promise<TRecord | undefined>;
  insert(scope: QaScope, record: TRecord): Promise<void>;
  list(scope: QaScope, ownerId: string): Promise<readonly TRecord[]>;
}

export interface QaScopedPackTransaction {
  readonly scope: QaScope;
  readonly native: unknown;
}

export interface QaScopedPackUnitOfWork {
  execute<T>(
    scope: QaScope,
    lockKeys: readonly string[],
    work: (transaction: QaScopedPackTransaction) => Promise<T>,
  ): Promise<T>;
}

export function assertQaScopedRecord(scope: QaScope, record: QaScopedRecord): void {
  assertQaScope(scope, {
    workspaceId: record.workspaceId,
    projectId: record.projectId,
  });
}

export function qaScopedLockKey(scope: QaScope, entityType: string, entityId: string): string {
  return [scope.workspaceId, scope.projectId, entityType, entityId].join(":");
}

export function qaCanonicalLockOrder(lockKeys: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(lockKeys)].sort());
}
