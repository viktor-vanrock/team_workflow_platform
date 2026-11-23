import type { DataSource } from "typeorm";

export type MattermostConnectionHealthState = "HEALTHY" | "DEGRADED" | "UNAVAILABLE";
export function classifyMattermostConnectionHealth(
  code: string,
): Readonly<{ state: MattermostConnectionHealthState; reasonCode?: string }> {
  if (/^OK$|HEALTHY/iu.test(code)) return Object.freeze({ state: "HEALTHY" });
  if (/401|403|AUTHENTICATION|PERMISSION|SCHEMA|POLICY|CHANNEL/iu.test(code))
    return Object.freeze({ state: "DEGRADED", reasonCode: code });
  return Object.freeze({ state: "UNAVAILABLE", reasonCode: code });
}

export class MattermostConnectionHealthService {
  constructor(private readonly source: DataSource) {}
  async record(
    input: Readonly<{ workspaceId: string; connectionId: string; code: string; checkedAt: Date }>,
  ) {
    const health = classifyMattermostConnectionHealth(input.code);
    await this.source.query(
      "INSERT INTO connection_health(workspace_id,connection_id,state,checked_at,details) VALUES($1,$2,$3,$4,$5) ON CONFLICT(workspace_id,connection_id) DO UPDATE SET state=EXCLUDED.state,checked_at=EXCLUDED.checked_at,details=EXCLUDED.details",
      [
        input.workspaceId,
        input.connectionId,
        health.state,
        input.checkedAt,
        JSON.stringify(health.reasonCode ? { reasonCode: health.reasonCode } : {}),
      ],
    );
    return Object.freeze({ ...health, checkedAt: input.checkedAt });
  }
}
