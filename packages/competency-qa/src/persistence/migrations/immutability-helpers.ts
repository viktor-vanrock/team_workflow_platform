import { createHash } from "node:crypto";

import { QaDomainError } from "../../domain/primitives.ts";
import { assertQaSqlIdentifier } from "./scope-helpers.ts";

function quoted(value: string): string {
  assertQaSqlIdentifier(value);
  return `"${value}"`;
}

function helperName(prefix: string, tableName: string): string {
  const value = `${prefix}_${tableName}`;
  if (value.length <= 63) return value;
  const suffix = createHash("sha256").update(value).digest("hex").slice(0, 10);
  return `${value.slice(0, 52)}_${suffix}`;
}

export function qaAppendOnlyGuardSql(tableName: string): string {
  assertQaSqlIdentifier(tableName);
  const functionName = helperName("qa_append_only_guard", tableName);
  const triggerName = helperName("qa_append_only", tableName);
  return `
CREATE OR REPLACE FUNCTION ${quoted(functionName)}() RETURNS trigger
LANGUAGE plpgsql AS $qa$
BEGIN
  RAISE EXCEPTION 'APPEND_ONLY:%', TG_TABLE_NAME;
END;
$qa$;
DROP TRIGGER IF EXISTS ${quoted(triggerName)} ON ${quoted(tableName)};
CREATE TRIGGER ${quoted(triggerName)}
BEFORE UPDATE OR DELETE ON ${quoted(tableName)}
FOR EACH ROW EXECUTE FUNCTION ${quoted(functionName)}();`;
}

export function qaRevisionChainGuardSql(
  options: Readonly<{
    tableName: string;
    versionColumn?: string;
    previousIdColumn?: string;
    previousVersionColumn?: string;
  }>,
): string {
  const versionColumn = options.versionColumn ?? "version";
  const previousIdColumn = options.previousIdColumn ?? "previous_id";
  const previousVersionColumn = options.previousVersionColumn ?? "previous_version";
  [options.tableName, versionColumn, previousIdColumn, previousVersionColumn].forEach(
    assertQaSqlIdentifier,
  );
  return `CHECK ((
    ${quoted(versionColumn)} = 1
    AND ${quoted(previousIdColumn)} IS NULL
    AND ${quoted(previousVersionColumn)} IS NULL
  ) OR (
    ${quoted(versionColumn)} > 1
    AND ${quoted(previousIdColumn)} IS NOT NULL
    AND ${quoted(previousVersionColumn)} = ${quoted(versionColumn)} - 1
  ))`;
}

export function qaSnapshotLockGuardSql(
  options: Readonly<{
    tableName: string;
    lockedAtColumn: string;
    protectedColumns: readonly string[];
  }>,
): string {
  if (options.protectedColumns.length === 0)
    throw new QaDomainError("QA_SNAPSHOT_COLUMNS_REQUIRED");
  [options.tableName, options.lockedAtColumn, ...options.protectedColumns].forEach(
    assertQaSqlIdentifier,
  );
  const functionName = helperName("qa_snapshot_lock_guard", options.tableName);
  const triggerName = helperName("qa_snapshot_lock", options.tableName);
  const changed = options.protectedColumns
    .map((column) => `OLD.${quoted(column)} IS DISTINCT FROM NEW.${quoted(column)}`)
    .join(" OR ");
  return `
CREATE OR REPLACE FUNCTION ${quoted(functionName)}() RETURNS trigger
LANGUAGE plpgsql AS $qa$
BEGIN
  IF OLD.${quoted(options.lockedAtColumn)} IS NOT NULL AND (${changed}) THEN
    RAISE EXCEPTION 'SNAPSHOT_LOCKED:%', TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$qa$;
DROP TRIGGER IF EXISTS ${quoted(triggerName)} ON ${quoted(options.tableName)};
CREATE TRIGGER ${quoted(triggerName)}
BEFORE UPDATE ON ${quoted(options.tableName)}
FOR EACH ROW EXECUTE FUNCTION ${quoted(functionName)}();`;
}
