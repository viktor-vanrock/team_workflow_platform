import type { DataSource } from "typeorm";

type Row = Record<string, unknown>;
export class JiraConfigurationRepository {
  constructor(private readonly source: DataSource) {}
  async discoveryByHash(workspaceId: string, contentHash: string): Promise<Row | undefined> {
    return (
      (await this.source.query(
        "SELECT * FROM jira_discovery_snapshots WHERE workspace_id=$1 AND content_hash=$2",
        [workspaceId, contentHash],
      )) as Row[]
    )[0];
  }
  async saveValidation(input: Readonly<Record<string, unknown>>): Promise<void> {
    await this.source.query(
      "INSERT INTO jira_profile_validation_details(id,workspace_id,profile_ref,candidate_content_hash,discovery_snapshot_id,status,issues,preview_hash,dry_run_hash,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [
        input.id,
        input.workspaceId,
        JSON.stringify(input.profileRef),
        input.candidateContentHash,
        input.discoverySnapshotId,
        input.status,
        JSON.stringify(input.issues),
        input.previewHash ?? null,
        input.dryRunHash ?? null,
        input.createdAt,
      ],
    );
  }
}
