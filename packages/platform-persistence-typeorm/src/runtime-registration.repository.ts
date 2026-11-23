import type { DataSource } from "typeorm";

export interface RuntimeRegistration {
  readonly instanceId: string;
  readonly workspaceId: string;
  readonly deploymentId: string;
  readonly deploymentVersion: number;
  readonly component: "api" | "worker";
  readonly configDigest: string;
  readonly imageDigest: string;
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu;
const digest = /^sha256:[a-f0-9]{64}$/u;
const rows = (value: unknown): unknown[] =>
  Array.isArray(value) && Array.isArray(value[0]) ? value[0] : (value as unknown[]);

/** Process leases use the database clock. An expired/stopped incarnation cannot renew itself. */
export class RuntimeRegistrationRepository {
  constructor(
    private readonly source: DataSource,
    private readonly deadlineMs: number,
  ) {
    if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 100 || deadlineMs > 5000)
      throw new Error("DEPLOYMENT_REGISTRATION_INVALID");
  }
  async register(value: RuntimeRegistration, leaseMs: number): Promise<void> {
    this.validate(value, leaseMs);
    await this.query(
      `INSERT INTO pilot_runtime_registrations(instance_id,workspace_id,deployment_id,deployment_version,component,config_digest,image_digest,state,started_at,refreshed_at,expires_at)
      SELECT $1,$2,$3,$4,$5,$6,$7,'ACTIVE',at,at,at+($8*interval '1 millisecond') FROM (SELECT clock_timestamp() AS at) stamp`,
      [
        value.instanceId,
        value.workspaceId,
        value.deploymentId,
        value.deploymentVersion,
        value.component,
        value.configDigest,
        value.imageDigest,
        leaseMs,
      ],
    );
  }
  async refresh(value: RuntimeRegistration, leaseMs: number): Promise<void> {
    this.validate(value, leaseMs);
    const updated = await this.query(
      `UPDATE pilot_runtime_registrations SET refreshed_at=clock_timestamp(),expires_at=clock_timestamp()+($8*interval '1 millisecond'),row_version=row_version+1
      WHERE instance_id=$1 AND workspace_id=$2 AND deployment_id=$3 AND deployment_version=$4 AND component=$5 AND config_digest=$6 AND image_digest=$7 AND state='ACTIVE' AND expires_at>clock_timestamp() RETURNING instance_id`,
      [
        value.instanceId,
        value.workspaceId,
        value.deploymentId,
        value.deploymentVersion,
        value.component,
        value.configDigest,
        value.imageDigest,
        leaseMs,
      ],
    );
    if (rows(updated).length !== 1) throw new Error("DEPLOYMENT_LEASE_EXPIRED");
  }
  async stop(instanceId: string): Promise<void> {
    await this.query(
      "UPDATE pilot_runtime_registrations SET state='STOPPED',row_version=row_version+1 WHERE instance_id=$1 AND state='ACTIVE'",
      [instanceId],
    );
  }
  async assertAgreement(value: RuntimeRegistration): Promise<void> {
    this.validate(value, 1000);
    const values = (await this.query(
      `SELECT instance_id,component,deployment_version,config_digest,image_digest,state,expires_at>clock_timestamp() AS current
      FROM pilot_runtime_registrations WHERE workspace_id=$1 AND deployment_id=$2 AND (instance_id=$3 OR (state='ACTIVE' AND expires_at>clock_timestamp())) LIMIT 129`,
      [value.workspaceId, value.deploymentId, value.instanceId],
    )) as {
      instance_id: string;
      component: string;
      deployment_version: number;
      config_digest: string;
      image_digest: string;
      state: string;
      current: boolean;
    }[];
    if (values.length > 128) throw new Error("DEPLOYMENT_REGISTRATION_LIMIT");
    const own = values.find((row) => row.instance_id === value.instanceId);
    if (!own || own.state !== "ACTIVE" || !own.current) throw new Error("DEPLOYMENT_LEASE_EXPIRED");
    if (
      values.some(
        (row) =>
          row.deployment_version !== value.deploymentVersion ||
          row.config_digest !== value.configDigest ||
          row.image_digest !== value.imageDigest,
      ) ||
      own.component !== value.component
    )
      throw new Error("DEPLOYMENT_DIGEST_MISMATCH");
    if (!["api", "worker"].every((component) => values.some((row) => row.component === component)))
      throw new Error("DEPLOYMENT_PEER_MISSING");
  }
  async deployments(value: RuntimeRegistration, projectIds: readonly string[]) {
    this.validate(value, 1000);
    if (!projectIds.length || projectIds.length > 100 || projectIds.some((id) => !uuid.test(id)))
      throw new Error("DEPLOYMENT_REGISTRATION_INVALID");
    return (await this.query(
      `SELECT r.project_id,r.record_id,r.version,r.semantic_body,r.content_hash FROM pilot_record_headers h JOIN pilot_record_revisions r
      ON (r.workspace_id,r.project_id,r.record_id,r.version,r.content_hash)=(h.workspace_id,h.project_id,h.record_id,h.current_version,h.current_hash)
      WHERE h.workspace_id=$1 AND h.record_id=$2 AND h.kind='DEPLOYMENT' AND h.project_id=ANY($3::uuid[])`,
      [value.workspaceId, value.deploymentId, projectIds],
    )) as {
      project_id: string;
      record_id: string;
      version: number;
      content_hash: string;
      semantic_body: Record<string, unknown>;
    }[];
  }
  private async query(sql: string, parameters: unknown[]): Promise<unknown> {
    return await this.source.transaction(async (manager) => {
      await manager.query(
        "SELECT set_config('statement_timeout',$1,true),set_config('lock_timeout',$1,true)",
        [String(this.deadlineMs)],
      );
      return (await manager.query(sql, parameters)) as unknown;
    });
  }
  private validate(value: RuntimeRegistration, leaseMs: number): void {
    if (
      ![value.instanceId, value.workspaceId, value.deploymentId].every((id) => uuid.test(id)) ||
      !Number.isSafeInteger(value.deploymentVersion) ||
      value.deploymentVersion < 1 ||
      !["api", "worker"].includes(value.component) ||
      !digest.test(value.configDigest) ||
      !digest.test(value.imageDigest) ||
      !Number.isSafeInteger(leaseMs) ||
      leaseMs < 100 ||
      leaseMs > 30_000
    )
      throw new Error("DEPLOYMENT_REGISTRATION_INVALID");
  }
}
