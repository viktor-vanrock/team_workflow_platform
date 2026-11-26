import type { DataSource } from "typeorm";

/** C1 pins the GitLab server release; a fresh discovery must match all three facts. */
export function assertCorporateGitLabDiscoveryServer(
  row: Readonly<Record<string, unknown>>,
  server: Readonly<{ edition: string; exactVersion: string; exactBuild: string }>,
): void {
  if (
    row.edition !== server.edition ||
    row.exact_version !== server.exactVersion ||
    row.exact_build !== server.exactBuild
  )
    throw new Error("CORPORATE_GITLAB_DISCOVERY_SERVER_MISMATCH");
}
/** Recheck that the latest valid discovery remains current before each provider read. */
export async function assertCorporateGitLabDiscoveryCurrent(
  source: DataSource,
  workspaceId: string,
  connectionRef: Readonly<{ id: string; version: number; contentHash: string }>,
  numericProjectId: number,
  server: Readonly<{ edition: string; exactVersion: string; exactBuild: string }>,
): Promise<void> {
  const rows = (await source.query(
    `SELECT edition,exact_version,exact_build FROM gitlab_discovery_snapshots
     WHERE workspace_id=$1 AND connection_ref=$2::jsonb AND numeric_project_id=$3
       AND validation_status='VALID' AND production_denied=true AND expires_at>clock_timestamp()
     ORDER BY collected_at DESC LIMIT 1`,
    [workspaceId, JSON.stringify(connectionRef), numericProjectId],
  )) as readonly Record<string, unknown>[];
  if (rows.length !== 1) throw new Error("CORPORATE_GITLAB_DISCOVERY_STALE");
  assertCorporateGitLabDiscoveryServer(rows[0]!, server);
}
