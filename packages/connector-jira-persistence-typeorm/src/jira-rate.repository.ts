import type { DataSource } from "typeorm";

export class JiraRateRepository {
  constructor(private readonly source: DataSource) {}
  async record(input: Readonly<Record<string, unknown>>): Promise<void> {
    await this.source.query(
      "INSERT INTO jira_rate_limit_snapshots(id,connection_ref,lane,reason,remaining,reset_at,retry_after_seconds,decision,next_eligible_at,observed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [
        input.id,
        JSON.stringify(input.connectionRef),
        input.lane,
        input.reason ?? null,
        input.remaining ?? null,
        input.resetAt ?? null,
        input.retryAfterSeconds ?? null,
        input.decision,
        input.nextEligibleAt ?? null,
        input.observedAt,
      ],
    );
  }
}
