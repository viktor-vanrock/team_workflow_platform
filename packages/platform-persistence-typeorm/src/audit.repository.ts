import type { DataSource } from "typeorm";

import {
  type AppendOnlyAuditPort,
  type AuditEvent,
  type ClassificationCatalog,
  defaultClassificationCatalog,
  type ResourceScope,
} from "@awp/platform-core";

type Row = Record<string, unknown>;
const parse = <T>(value: unknown): T =>
  typeof value === "string" ? (JSON.parse(value) as T) : (value as T);

export class TypeOrmAuditRepository implements AppendOnlyAuditPort {
  constructor(
    private readonly dataSource: DataSource,
    private readonly classifications: ClassificationCatalog = defaultClassificationCatalog,
  ) {}
  async append(event: AuditEvent): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO audit_events(id,workspace_id,project_id,occurred_at,actor,action,outcome,reason_code,correlation_id,causation_id,authorization_basis,classification_key,attributes)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        event.id,
        event.scope.workspaceId,
        event.scope.kind === "PROJECT" ? event.scope.projectId : null,
        event.occurredAt,
        JSON.stringify(event.actor),
        event.action,
        event.outcome,
        event.reasonCode,
        event.correlationId,
        event.causationId,
        event.authorizationBasis ? JSON.stringify(event.authorizationBasis) : null,
        event.classification.key,
        JSON.stringify({ values: event.attributes, versionRefs: event.versionRefs }),
      ],
    );
  }
  async query(
    scope: ResourceScope,
    filter: Readonly<{ correlationId?: string; action?: string }>,
  ): Promise<readonly AuditEvent[]> {
    const clauses = ["workspace_id=$1"];
    const parameters: unknown[] = [scope.workspaceId];
    if (scope.kind === "PROJECT") {
      parameters.push(scope.projectId);
      clauses.push(`project_id=$${parameters.length}`);
    } else clauses.push("project_id IS NULL");
    if (filter.correlationId) {
      parameters.push(filter.correlationId);
      clauses.push(`correlation_id=$${parameters.length}`);
    }
    if (filter.action) {
      parameters.push(filter.action);
      clauses.push(`action=$${parameters.length}`);
    }
    const rows = (await this.dataSource.query(
      `SELECT * FROM audit_events WHERE ${clauses.join(" AND ")} ORDER BY occurred_at,id`,
      parameters,
    )) as Row[];
    return rows.map((row) => {
      const stored = parse<{
        values: AuditEvent["attributes"];
        versionRefs: AuditEvent["versionRefs"];
      }>(row.attributes);
      const projectId = row.project_id ? String(row.project_id) : undefined;
      return {
        id: String(row.id),
        occurredAt: new Date(String(row.occurred_at)),
        scope: projectId
          ? { kind: "PROJECT", workspaceId: String(row.workspace_id), projectId }
          : { kind: "WORKSPACE", workspaceId: String(row.workspace_id) },
        actor: parse(row.actor),
        action: String(row.action),
        outcome: String(row.outcome) as AuditEvent["outcome"],
        reasonCode: String(row.reason_code),
        correlationId: String(row.correlation_id),
        causationId: String(row.causation_id),
        ...(row.authorization_basis ? { authorizationBasis: parse(row.authorization_basis) } : {}),
        classification: this.classifications.reference(String(row.classification_key)),
        versionRefs: stored.versionRefs,
        attributes: stored.values,
      };
    });
  }
}
