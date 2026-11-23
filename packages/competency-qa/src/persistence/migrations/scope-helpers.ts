import { QaDomainError } from "../../domain/primitives.ts";

const sqlIdentifier = /^[a-z][a-z0-9_]{0,62}$/u;

export function assertQaSqlIdentifier(value: string): void {
  if (!sqlIdentifier.test(value)) throw new QaDomainError("QA_SQL_IDENTIFIER_INVALID");
}

function quoted(value: string): string {
  assertQaSqlIdentifier(value);
  return `"${value}"`;
}

export function qaScopedColumnsSql(): string {
  return "workspace_id uuid NOT NULL, project_id uuid NOT NULL";
}

export function qaCompositeForeignKeySql(
  options: Readonly<{
    constraintName: string;
    localColumns: readonly string[];
    referencedTable: string;
    referencedColumns: readonly string[];
    onDelete?: "RESTRICT" | "CASCADE";
    deferrable?: boolean;
  }>,
): string {
  if (
    options.localColumns.length === 0 ||
    options.localColumns.length !== options.referencedColumns.length
  ) {
    throw new QaDomainError("QA_COMPOSITE_FOREIGN_KEY_INVALID");
  }
  const local = options.localColumns.map(quoted).join(", ");
  const referenced = options.referencedColumns.map(quoted).join(", ");
  const onDelete = options.onDelete ?? "RESTRICT";
  return [
    `CONSTRAINT ${quoted(options.constraintName)}`,
    `FOREIGN KEY (${local})`,
    `REFERENCES ${quoted(options.referencedTable)} (${referenced})`,
    `ON DELETE ${onDelete}`,
    ...(options.deferrable === true ? ["DEFERRABLE INITIALLY DEFERRED"] : []),
  ].join(" ");
}

export function qaCompositeScopeIndexSql(
  options: Readonly<{
    indexName: string;
    tableName: string;
    columns: readonly string[];
    unique?: boolean;
  }>,
): string {
  if (options.columns.length === 0) throw new QaDomainError("QA_SCOPE_INDEX_INVALID");
  const columns = ["workspace_id", "project_id", ...options.columns].map(quoted).join(", ");
  return `CREATE ${options.unique === true ? "UNIQUE " : ""}INDEX ${quoted(options.indexName)} ON ${quoted(options.tableName)} (${columns});`;
}
