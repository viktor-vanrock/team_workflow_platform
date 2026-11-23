export interface GitLabQueryExecutor {
  query(sql: string, parameters?: readonly unknown[]): Promise<unknown>;
}

export interface GitLabWorkspaceProjectScope {
  readonly workspaceId: string;
  readonly numericProjectId: number;
}

export interface GitLabAuthorityScope extends GitLabWorkspaceProjectScope {
  readonly connectionHeaderId: string;
}

export function gitLabRows<T>(value: unknown): readonly T[] {
  const raw = value as readonly unknown[];
  return (Array.isArray(raw[0]) ? raw[0] : raw) as readonly T[];
}

export function gitLabJson<T>(value: unknown): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

export function frozenRows(value: unknown): readonly Readonly<Record<string, unknown>>[] {
  return Object.freeze(
    gitLabRows<Record<string, unknown>>(value).map((row) => Object.freeze({ ...row })),
  );
}
