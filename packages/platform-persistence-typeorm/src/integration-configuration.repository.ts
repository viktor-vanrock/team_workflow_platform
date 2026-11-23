import type { DataSource } from "typeorm";

import type {
  BindingHealth,
  BindingRevision,
  ConnectionHealth,
  ConnectionRevision,
  IntegrationConfigurationQueryPort,
  IntegrationConfigurationRepository,
  MappingHealthState,
  MappingRevision,
  ProfileMappingHealth,
  ProfileRevision,
  ResourceScope,
  ValidationReport,
} from "@awp/platform-core";

type Row = Record<string, unknown>;
type Kind = "CONNECTION" | "MAPPING" | "PROFILE" | "BINDING";
type Revision = ConnectionRevision | MappingRevision | ProfileRevision | BindingRevision;
const names = {
  CONNECTION: { headers: "connection_headers", revisions: "connection_revisions" },
  MAPPING: { headers: "connector_mapping_headers", revisions: "connector_mapping_revisions" },
  PROFILE: { headers: "connector_profile_headers", revisions: "connector_profile_revisions" },
  BINDING: {
    headers: "project_integration_binding_headers",
    revisions: "project_integration_binding_revisions",
  },
} as const;
const parse = <T>(value: unknown): T =>
  typeof value === "string" ? (JSON.parse(value) as T) : (value as T);
const returnedRows = (value: unknown): Row[] =>
  Array.isArray(value) && Array.isArray(value[0]) ? (value[0] as Row[]) : (value as Row[]);

function immutableContent(revision: Revision): Record<string, unknown> {
  const content = { ...revision } as Record<string, unknown>;
  delete content.state;
  delete content.resourceVersion;
  delete content.validationReportId;
  delete content.contentHash;
  return content;
}
function mapRevision<T extends Revision>(row: Row | undefined): T | undefined {
  if (!row) return undefined;
  return {
    ...parse<Record<string, unknown>>(row.content),
    state: String(row.status),
    resourceVersion: Number(row.row_version),
    contentHash: String(row.content_hash),
    ...(row.validation_report_id ? { validationReportId: String(row.validation_report_id) } : {}),
    createdAt: new Date(String(row.created_at)),
  } as T;
}

export class TypeOrmIntegrationConfigurationRepository
  implements IntegrationConfigurationRepository, IntegrationConfigurationQueryPort
{
  constructor(private readonly dataSource: DataSource) {}
  async #insert(kind: Kind, revision: Revision): Promise<void> {
    const table = names[kind];
    await this.dataSource.transaction(async (manager) => {
      if (kind === "BINDING") {
        const binding = revision as BindingRevision;
        await manager.query(
          `INSERT INTO ${table.headers}(id,workspace_id,project_id,key,current_published_version,row_version) VALUES($1,$2,$3,$4,NULL,$5)`,
          [
            revision.id,
            revision.workspaceId,
            binding.projectId,
            binding.key,
            revision.resourceVersion,
          ],
        );
        await manager.query(
          `INSERT INTO ${table.revisions}(id,workspace_id,project_id,header_id,version,status,content,content_hash,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            revision.revisionId,
            revision.workspaceId,
            binding.projectId,
            revision.id,
            revision.version,
            revision.state,
            JSON.stringify(immutableContent(revision)),
            revision.contentHash,
            revision.createdAt,
          ],
        );
      } else {
        await manager.query(
          `INSERT INTO ${table.headers}(id,workspace_id,key,current_published_version,row_version) VALUES($1,$2,$3,NULL,$4)`,
          [revision.id, revision.workspaceId, revision.key, revision.resourceVersion],
        );
        await manager.query(
          `INSERT INTO ${table.revisions}(id,workspace_id,header_id,version,status,content,content_hash,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            revision.revisionId,
            revision.workspaceId,
            revision.id,
            revision.version,
            revision.state,
            JSON.stringify(immutableContent(revision)),
            revision.contentHash,
            revision.createdAt,
          ],
        );
      }
    });
  }
  async #save(kind: Kind, revision: Revision): Promise<void> {
    const table = names[kind];
    await this.dataSource.transaction(async (manager) => {
      const updated = returnedRows(
        await manager.query(
          `UPDATE ${table.headers} SET row_version=row_version+1 WHERE workspace_id=$1 AND id=$2 AND row_version=$3 RETURNING row_version`,
          [revision.workspaceId, revision.id, revision.resourceVersion - 1],
        ),
      );
      if (updated.length !== 1) throw new Error("ETAG_MISMATCH");
      const result = returnedRows(
        await manager.query(
          `UPDATE ${table.revisions} SET status=$4 WHERE workspace_id=$1 AND header_id=$2 AND version=$3 AND content_hash=$5 RETURNING id`,
          [
            revision.workspaceId,
            revision.id,
            revision.version,
            revision.state,
            revision.contentHash,
          ],
        ),
      );
      if (result.length !== 1) throw new Error(`${kind}_REVISION_NOT_FOUND`);
    });
  }
  async #get<T extends Revision>(
    kind: Kind,
    workspaceId: string,
    id: string,
    version: number,
    projectId?: string,
  ): Promise<T | undefined> {
    const table = names[kind];
    const projectClause = kind === "BINDING" ? "AND r.project_id=$4" : "";
    const parameters =
      kind === "BINDING" ? [workspaceId, id, version, projectId] : [workspaceId, id, version];
    const rows = (await this.dataSource.query(
      `SELECT r.*,h.row_version,(SELECT id FROM integration_validation_reports vr WHERE vr.workspace_id=r.workspace_id AND vr.subject_id=r.header_id AND vr.subject_version=r.version AND vr.content_hash=r.content_hash AND vr.outcome='VALID' ORDER BY vr.created_at DESC LIMIT 1) validation_report_id FROM ${table.revisions} r JOIN ${table.headers} h ON h.workspace_id=r.workspace_id AND h.id=r.header_id WHERE r.workspace_id=$1 AND r.header_id=$2 AND r.version=$3 ${projectClause}`,
      parameters,
    )) as Row[];
    return mapRevision<T>(rows[0]);
  }
  insertConnection(value: ConnectionRevision): Promise<void> {
    return this.#insert("CONNECTION", value);
  }
  saveConnection(value: ConnectionRevision): Promise<void> {
    return this.#save("CONNECTION", value);
  }
  connection(
    workspaceId: string,
    id: string,
    version: number,
  ): Promise<ConnectionRevision | undefined> {
    return this.#get("CONNECTION", workspaceId, id, version);
  }
  insertMapping(value: MappingRevision): Promise<void> {
    return this.#insert("MAPPING", value);
  }
  saveMapping(value: MappingRevision): Promise<void> {
    return this.#save("MAPPING", value);
  }
  mapping(workspaceId: string, id: string, version: number): Promise<MappingRevision | undefined> {
    return this.#get("MAPPING", workspaceId, id, version);
  }
  insertProfile(value: ProfileRevision): Promise<void> {
    return this.#insert("PROFILE", value);
  }
  saveProfile(value: ProfileRevision): Promise<void> {
    return this.#save("PROFILE", value);
  }
  profile(workspaceId: string, id: string, version: number): Promise<ProfileRevision | undefined> {
    return this.#get("PROFILE", workspaceId, id, version);
  }
  insertBinding(value: BindingRevision): Promise<void> {
    return this.#insert("BINDING", value);
  }
  saveBinding(value: BindingRevision): Promise<void> {
    return this.#save("BINDING", value);
  }
  binding(
    workspaceId: string,
    projectId: string,
    id: string,
    version: number,
  ): Promise<BindingRevision | undefined> {
    return this.#get("BINDING", workspaceId, id, version, projectId);
  }

  async publish(
    kind: Exclude<Kind, "BINDING">,
    workspaceId: string,
    id: string,
    version: number,
    expectedResourceVersion: number,
  ): Promise<ConnectionRevision | MappingRevision | ProfileRevision> {
    return await this.dataSource.transaction("SERIALIZABLE", async (manager) => {
      const table = names[kind];
      const headers = (await manager.query(
        `SELECT * FROM ${table.headers} WHERE workspace_id=$1 AND id=$2 FOR UPDATE`,
        [workspaceId, id],
      )) as Row[];
      const header = headers[0];
      if (!header) throw new Error(`${kind}_REVISION_NOT_FOUND`);
      if (Number(header.row_version) !== expectedResourceVersion) throw new Error("ETAG_MISMATCH");
      const rows = (await manager.query(
        `SELECT r.*,(SELECT id FROM integration_validation_reports vr WHERE vr.workspace_id=r.workspace_id AND vr.subject_id=r.header_id AND vr.subject_version=r.version AND vr.content_hash=r.content_hash AND vr.outcome='VALID' ORDER BY vr.created_at DESC LIMIT 1) validation_report_id FROM ${table.revisions} r WHERE r.workspace_id=$1 AND r.header_id=$2 AND r.version=$3 FOR UPDATE`,
        [workspaceId, id, version],
      )) as Row[];
      const candidate = rows[0];
      if (!candidate || candidate.status !== "VALIDATED" || !candidate.validation_report_id)
        throw new Error("CONFIGURATION_NOT_VALIDATED");
      if (
        header.current_published_version !== null &&
        Number(header.current_published_version) !== version
      )
        await manager.query(
          `UPDATE ${table.revisions} SET status='RETIRED' WHERE workspace_id=$1 AND header_id=$2 AND version=$3 AND status='PUBLISHED'`,
          [workspaceId, id, Number(header.current_published_version)],
        );
      await manager.query(
        `UPDATE ${table.revisions} SET status='PUBLISHED' WHERE workspace_id=$1 AND header_id=$2 AND version=$3`,
        [workspaceId, id, version],
      );
      await manager.query(
        `UPDATE ${table.headers} SET current_published_version=$3,row_version=row_version+1 WHERE workspace_id=$1 AND id=$2`,
        [workspaceId, id, version],
      );
      return mapRevision<ConnectionRevision | MappingRevision | ProfileRevision>({
        ...candidate,
        status: "PUBLISHED",
        row_version: expectedResourceVersion + 1,
      })!;
    });
  }
  async saveValidationReport(report: ValidationReport): Promise<void> {
    await this.dataSource.query(
      "INSERT INTO integration_validation_reports(id,workspace_id,project_id,subject_kind,subject_id,subject_version,outcome,content_hash,report,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [
        report.id,
        report.workspaceId,
        report.projectId ?? null,
        report.subjectKind,
        report.subjectRef.id,
        report.subjectRef.version,
        report.status,
        report.contentHash,
        JSON.stringify(report),
        report.createdAt,
      ],
    );
  }
  async validationReport(scope: ResourceScope, id: string): Promise<ValidationReport | undefined> {
    const rows = (await this.dataSource.query(
      `SELECT report FROM integration_validation_reports
      WHERE workspace_id=$1 AND id=$2 AND ${scope.kind === "PROJECT" ? "project_id=$3" : "project_id IS NULL"}`,
      scope.kind === "PROJECT" ? [scope.workspaceId, id, scope.projectId] : [scope.workspaceId, id],
    )) as Row[];
    const report = rows[0] ? parse<ValidationReport>(rows[0].report) : undefined;
    return report ? { ...report, createdAt: new Date(String(report.createdAt)) } : undefined;
  }
  async saveConnectionHealth(health: ConnectionHealth): Promise<void> {
    await this.dataSource.query(
      "INSERT INTO connection_health(workspace_id,connection_id,state,checked_at,details) VALUES($1,$2,$3,$4,$5) ON CONFLICT(workspace_id,connection_id) DO UPDATE SET state=EXCLUDED.state,checked_at=EXCLUDED.checked_at,details=EXCLUDED.details",
      [
        health.workspaceId,
        health.connectionRef.id,
        health.healthState,
        health.checkedAt,
        JSON.stringify({
          version: health.connectionRef.version,
          reasonCode: health.reasonCode ?? null,
        }),
      ],
    );
  }
  async connectionHealth(
    workspaceId: string,
    connectionId: string,
  ): Promise<ConnectionHealth | undefined> {
    const rows = (await this.dataSource.query(
      "SELECT * FROM connection_health WHERE workspace_id=$1 AND connection_id=$2",
      [workspaceId, connectionId],
    )) as Row[];
    const row = rows[0];
    if (!row) return undefined;
    const details = parse<{ version: number; reasonCode?: string }>(row.details);
    return {
      workspaceId,
      connectionRef: { id: connectionId, version: details.version },
      healthState: String(row.state) as ConnectionHealth["healthState"],
      ...(details.reasonCode ? { reasonCode: details.reasonCode } : {}),
      checkedAt: new Date(String(row.checked_at)),
    };
  }

  async bindingHealth(
    workspaceId: string,
    projectId: string,
    bindingRef: Readonly<{ id: string; version: number }>,
  ): Promise<BindingHealth | undefined> {
    const binding = await this.binding(workspaceId, projectId, bindingRef.id, bindingRef.version);
    if (!binding) return undefined;

    const profiles: ProfileMappingHealth[] = [];
    for (const entry of binding.entries) {
      const profile = await this.profile(
        workspaceId,
        entry.profileRef.id,
        entry.profileRef.version,
      );
      if (!profile) {
        profiles.push(
          Object.freeze({
            profileRef: entry.profileRef,
            profileState: "MISSING",
            mappingState: "MISSING",
            connectionHealthState: "UNKNOWN",
            health: "UNAVAILABLE",
          }),
        );
        continue;
      }

      const mapping = profile.mappingRef
        ? await this.mapping(workspaceId, profile.mappingRef.id, profile.mappingRef.version)
        : undefined;
      const connectionHealth = await this.connectionHealth(workspaceId, profile.connectionRef.id);
      let health: MappingHealthState = "CURRENT";
      if (profile.state !== "PUBLISHED" || !profile.validationReportId) {
        health = "NEEDS_REVIEW";
      }
      if (profile.mappingRef && !mapping) {
        health = "UNAVAILABLE";
      } else if (mapping && (mapping.state !== "PUBLISHED" || !mapping.validationReportId)) {
        health = "NEEDS_REVIEW";
      }
      profiles.push(
        Object.freeze({
          profileRef: entry.profileRef,
          profileState: profile.state,
          ...(profile.mappingRef ? { mappingRef: profile.mappingRef } : {}),
          mappingState: profile.mappingRef ? (mapping?.state ?? "MISSING") : "NOT_REQUIRED",
          connectionHealthState: connectionHealth?.healthState ?? "UNKNOWN",
          health,
        }),
      );
    }

    let health: MappingHealthState = "CURRENT";
    if (binding.state !== "PUBLISHED" || !binding.validationReportId) {
      health = "NEEDS_REVIEW";
    }
    if (profiles.some((profile) => profile.health === "UNAVAILABLE")) {
      health = "UNAVAILABLE";
    } else if (profiles.some((profile) => profile.health === "NEEDS_REVIEW")) {
      health = "NEEDS_REVIEW";
    }
    return Object.freeze({
      workspaceId,
      projectId,
      bindingRef,
      bindingState: binding.state,
      health,
      profiles: Object.freeze(profiles),
      resourceVersion: binding.resourceVersion,
    });
  }
}
