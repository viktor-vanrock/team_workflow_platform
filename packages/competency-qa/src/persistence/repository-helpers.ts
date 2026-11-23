import { QaDomainError, type QaScope } from "../domain/primitives.ts";
import { assertQaSqlIdentifier } from "./migrations/scope-helpers.ts";

export interface QaQueryExecutor {
  query(sql: string, parameters?: readonly unknown[]): Promise<unknown>;
}

export interface QaOptimisticCasOptions {
  readonly tableName: string;
  readonly scope: QaScope;
  readonly id: string;
  readonly expectedVersion: number;
  readonly changes: Readonly<Record<string, unknown>>;
}

function quoted(value: string): string {
  assertQaSqlIdentifier(value);
  return `"${value}"`;
}

export async function qaOptimisticCasUpdate(
  executor: QaQueryExecutor,
  options: QaOptimisticCasOptions,
): Promise<Readonly<{ resourceVersion: number }>> {
  assertQaSqlIdentifier(options.tableName);
  if (!Number.isSafeInteger(options.expectedVersion) || options.expectedVersion < 1) {
    throw new QaDomainError("QA_EXPECTED_VERSION_INVALID");
  }
  const entries = Object.entries(options.changes).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  if (entries.length === 0) throw new QaDomainError("QA_CAS_CHANGES_REQUIRED");
  for (const [column] of entries) {
    assertQaSqlIdentifier(column);
    if (["workspace_id", "project_id", "id", "resource_version"].includes(column)) {
      throw new QaDomainError("QA_CAS_PROTECTED_COLUMN");
    }
  }
  const assignments = entries.map(([column], index) => `${quoted(column)} = $${index + 1}`);
  assignments.push(`${quoted("resource_version")} = ${quoted("resource_version")} + 1`);
  const parameters = [
    ...entries.map(([, value]) => value),
    options.scope.workspaceId,
    options.scope.projectId,
    options.id,
    options.expectedVersion,
  ];
  const scopeIndex = entries.length + 1;
  const result = await executor.query(
    `
UPDATE ${quoted(options.tableName)}
SET ${assignments.join(", ")}
WHERE ${quoted("workspace_id")} = $${scopeIndex}
  AND ${quoted("project_id")} = $${scopeIndex + 1}
  AND ${quoted("id")} = $${scopeIndex + 2}
  AND ${quoted("resource_version")} = $${scopeIndex + 3}
RETURNING ${quoted("resource_version")} AS "resourceVersion"`,
    parameters,
  );
  const raw = result as readonly unknown[];
  const rows = (Array.isArray(raw[0]) ? raw[0] : raw) as readonly Readonly<{
    resourceVersion: number;
  }>[];
  if (rows.length !== 1) throw new QaDomainError("OPTIMISTIC_CONCURRENCY_CONFLICT");
  return Object.freeze({ resourceVersion: rows[0]!.resourceVersion });
}

export async function qaScopedInsert(
  executor: QaQueryExecutor,
  options: Readonly<{
    tableName: string;
    scope: QaScope;
    values: Readonly<Record<string, unknown>>;
  }>,
): Promise<void> {
  assertQaSqlIdentifier(options.tableName);
  const entries = Object.entries(options.values).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  if (entries.some(([column]) => column === "workspace_id" || column === "project_id")) {
    throw new QaDomainError("QA_SCOPE_COLUMNS_SERVER_OWNED");
  }
  for (const [column] of entries) assertQaSqlIdentifier(column);
  const columns = ["workspace_id", "project_id", ...entries.map(([column]) => column)];
  const values = [
    options.scope.workspaceId,
    options.scope.projectId,
    ...entries.map(([, value]) => value),
  ];
  await executor.query(
    `INSERT INTO ${quoted(options.tableName)} (${columns.map(quoted).join(", ")}) VALUES (${values.map((_, index) => `$${index + 1}`).join(", ")})`,
    values,
  );
}
