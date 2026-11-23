import { randomUUID } from "node:crypto";

import type { EntityManager } from "typeorm";

import type { JsonValue } from "@awp/platform-contracts";
import {
  assertExactRevisionRef,
  containsSensitiveValue008,
  type ExactRevisionRef,
  freezePilotValue,
  pilotContentHash,
  type ProjectScope,
} from "@awp/platform-core";

export const runtimeConfigurationKinds = [
  "INPUT_PACKAGE",
  "IDENTITY_POLICY",
  "SECRET_RESOLVER_POLICY",
  "SIGNING_POLICY",
  "TELEMETRY_POLICY",
  "NETWORK_POLICY",
  "ARTIFACT_POLICY",
  "MODEL_POLICY",
  "RECOVERY_POLICY",
  "CONNECTOR_BINDING",
] as const;
export type RuntimeConfigurationKind = (typeof runtimeConfigurationKinds)[number];
export interface RuntimeConfigurationPublication {
  readonly schemaVersion: 1;
  readonly workspaceId: string;
  readonly projectIds: readonly string[];
  readonly kind: RuntimeConfigurationKind;
  readonly ref: ExactRevisionRef;
  readonly document: Readonly<Record<string, JsonValue>>;
  readonly publishedBy: string;
  readonly publishedAt: string;
  readonly validUntil: string;
  readonly correlationId: string;
}
type Row = {
  semantic_body: RuntimeConfigurationPublication;
  publication_hash: string;
  workspace_id: string;
  configuration_id: string;
  version: number;
  content_hash: string;
  kind: string;
  published_by: string;
  published_at: Date;
  valid_until: Date;
};
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu;
const fail = (code: string): never => {
  throw new Error(code);
};
const rows = (value: unknown): unknown[] =>
  Array.isArray(value) && Array.isArray(value[0]) ? value[0] : (value as unknown[]);
const json = (value: unknown, depth = 0): boolean => {
  if (depth > 16) return false;
  if (value === null || ["string", "boolean"].includes(typeof value)) return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (!value || typeof value !== "object" || Object.keys(value).length > 1000) return false;
  return Object.values(value).every((child) => json(child, depth + 1));
};
function validate(value: RuntimeConfigurationPublication): void {
  try {
    assertExactRevisionRef(value.ref);
    if (
      !json(value) ||
      JSON.stringify(value).length > 1_048_576 ||
      Object.keys(value).some(
        (key) =>
          ![
            "schemaVersion",
            "workspaceId",
            "projectIds",
            "kind",
            "ref",
            "document",
            "publishedBy",
            "publishedAt",
            "validUntil",
            "correlationId",
          ].includes(key),
      ) ||
      value.schemaVersion !== 1 ||
      !uuid.test(value.workspaceId) ||
      !uuid.test(value.publishedBy) ||
      !runtimeConfigurationKinds.includes(value.kind) ||
      !Array.isArray(value.projectIds) ||
      !value.projectIds.length ||
      value.projectIds.length > 100 ||
      new Set(value.projectIds).size !== value.projectIds.length ||
      value.projectIds.some((id: unknown) => typeof id !== "string" || !uuid.test(id)) ||
      !value.document ||
      Array.isArray(value.document) ||
      !Object.keys(value.document).length ||
      containsSensitiveValue008(value) ||
      pilotContentHash(value.document) !== value.ref.contentHash ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,255}$/u.test(value.ref.id) ||
      Object.keys(value.ref).some((key) => !["id", "version", "contentHash"].includes(key)) ||
      typeof value.correlationId !== "string" ||
      !/^[a-zA-Z0-9_.:-]{1,255}$/u.test(value.correlationId) ||
      !Number.isFinite(Date.parse(value.publishedAt)) ||
      !Number.isFinite(Date.parse(value.validUntil)) ||
      Date.parse(value.validUntil) <= Date.parse(value.publishedAt)
    )
      throw new Error();
  } catch {
    fail("RUNTIME_CONFIGURATION_INVALID");
  }
}
function decode(row: Row): RuntimeConfigurationPublication {
  const value = row.semantic_body;
  validate(value);
  if (
    pilotContentHash(value) !== row.publication_hash ||
    value.workspaceId !== row.workspace_id ||
    value.kind !== row.kind ||
    value.ref.id !== row.configuration_id ||
    value.ref.version !== row.version ||
    value.ref.contentHash !== row.content_hash ||
    value.publishedBy !== row.published_by ||
    Date.parse(value.publishedAt) !== row.published_at.getTime() ||
    Date.parse(value.validUntil) !== row.valid_until.getTime()
  )
    fail("RUNTIME_CONFIGURATION_INVALID");
  return freezePilotValue(value);
}

/** Internal persistence primitive. The publishing application must authorize the operator for every
 * Project before opening this transaction; these records grant neither Core rights nor a gate PASS. */
export class RuntimeConfigurationRepository {
  async publish(
    manager: EntityManager,
    input: RuntimeConfigurationPublication,
    expectedRowVersion: number,
  ): Promise<void> {
    validate(input);
    const value = freezePilotValue(structuredClone(input));
    this.transaction(manager);
    if (
      !Number.isSafeInteger(expectedRowVersion) ||
      expectedRowVersion < 0 ||
      Date.parse(value.publishedAt) > Date.now() ||
      Date.parse(value.validUntil) <= Date.now()
    )
      fail("RUNTIME_CONFIGURATION_INVALID");
    const key = [value.workspaceId, value.ref.id];
    const publicationHash = pilotContentHash(value);
    await manager.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `runtime-config:${key.join(":")}`,
    ]);
    const [existing] = (await manager.query(
      "SELECT publication_hash FROM runtime_configuration_revisions WHERE workspace_id=$1 AND configuration_id=$2 AND version=$3",
      [...key, value.ref.version],
    )) as { publication_hash: string }[];
    if (existing) {
      if (existing.publication_hash !== publicationHash) fail("RUNTIME_CONFIGURATION_CONFLICT");
      return;
    }
    await manager.query(
      `INSERT INTO runtime_configuration_revisions(workspace_id,configuration_id,version,kind,content_hash,publication_hash,semantic_body,published_by,published_at,valid_until)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        ...key,
        value.ref.version,
        value.kind,
        value.ref.contentHash,
        publicationHash,
        value,
        value.publishedBy,
        value.publishedAt,
        value.validUntil,
      ],
    );
    await manager.query(
      "INSERT INTO runtime_configuration_projects(workspace_id,configuration_id,version,project_id) SELECT $1,$2,$3,unnest($4::uuid[])",
      [...key, value.ref.version, value.projectIds],
    );
    const changed: unknown =
      expectedRowVersion === 0
        ? await manager.query(
            "INSERT INTO runtime_configuration_headers(workspace_id,configuration_id,kind,current_version,current_hash,state,row_version) VALUES($1,$2,$3,$4,$5,'PUBLISHED',1) ON CONFLICT DO NOTHING RETURNING configuration_id",
            [...key, value.kind, value.ref.version, value.ref.contentHash],
          )
        : await manager.query(
            "UPDATE runtime_configuration_headers SET current_version=$3,current_hash=$4,state='PUBLISHED',row_version=row_version+1 WHERE workspace_id=$1 AND configuration_id=$2 AND row_version=$5 AND kind=$6 RETURNING configuration_id",
            [...key, value.ref.version, value.ref.contentHash, expectedRowVersion, value.kind],
          );
    if (rows(changed).length !== 1) fail("RUNTIME_CONFIGURATION_CONFLICT");
    await this.event(
      manager,
      {
        workspaceId: value.workspaceId,
        ref: value.ref,
        actorRef: value.publishedBy,
        correlationId: value.correlationId,
      },
      "PUBLISH",
    );
  }
  async revoke(
    manager: EntityManager,
    input: { workspaceId: string; ref: ExactRevisionRef; actorRef: string; correlationId: string },
    expectedRowVersion: number,
  ): Promise<void> {
    this.transaction(manager);
    assertExactRevisionRef(input.ref);
    if (
      !uuid.test(input.workspaceId) ||
      !uuid.test(input.actorRef) ||
      !/^[a-zA-Z0-9_.:-]{1,255}$/u.test(input.correlationId) ||
      containsSensitiveValue008(input) ||
      !Number.isSafeInteger(expectedRowVersion) ||
      expectedRowVersion < 1
    )
      fail("RUNTIME_CONFIGURATION_INVALID");
    const changed: unknown = await manager.query(
      "UPDATE runtime_configuration_headers SET state='REVOKED',row_version=row_version+1 WHERE workspace_id=$1 AND configuration_id=$2 AND current_version=$3 AND current_hash=$4 AND row_version=$5 AND state='PUBLISHED' RETURNING configuration_id",
      [
        input.workspaceId,
        input.ref.id,
        input.ref.version,
        input.ref.contentHash,
        expectedRowVersion,
      ],
    );
    if (rows(changed).length !== 1) fail("RUNTIME_CONFIGURATION_CONFLICT");
    await this.event(manager, input, "REVOKE");
  }
  async current(
    manager: EntityManager,
    scope: ProjectScope,
    ref: ExactRevisionRef,
    kind: RuntimeConfigurationKind,
  ): Promise<RuntimeConfigurationPublication> {
    this.transaction(manager);
    assertExactRevisionRef(ref);
    if (
      !uuid.test(scope.workspaceId) ||
      !uuid.test(scope.projectId) ||
      !runtimeConfigurationKinds.includes(kind)
    )
      fail("RUNTIME_CONFIGURATION_UNAVAILABLE");
    const found = (await manager.query(
      `SELECT r.* FROM runtime_configuration_headers h JOIN runtime_configuration_revisions r
      ON (r.workspace_id,r.configuration_id,r.version,r.content_hash,r.kind)=(h.workspace_id,h.configuration_id,h.current_version,h.current_hash,h.kind)
      JOIN runtime_configuration_projects p ON (p.workspace_id,p.configuration_id,p.version)=(r.workspace_id,r.configuration_id,r.version)
      WHERE h.workspace_id=$1 AND p.project_id=$2 AND h.configuration_id=$3 AND h.current_version=$4 AND h.current_hash=$5 AND h.kind=$6 AND h.state='PUBLISHED'
      AND r.published_at<=clock_timestamp() AND r.valid_until>clock_timestamp() FOR SHARE OF h`,
      [scope.workspaceId, scope.projectId, ref.id, ref.version, ref.contentHash, kind],
    )) as Row[];
    if (found.length !== 1) return fail("RUNTIME_CONFIGURATION_UNAVAILABLE");
    const value = decode(found[0]!);
    if (
      !value.projectIds.includes(scope.projectId) ||
      Date.parse(value.publishedAt) > Date.now() ||
      Date.parse(value.validUntil) <= Date.now()
    )
      fail("RUNTIME_CONFIGURATION_UNAVAILABLE");
    return value;
  }
  private transaction(manager: EntityManager): void {
    if (!manager.queryRunner?.isTransactionActive)
      fail("RUNTIME_CONFIGURATION_TRANSACTION_REQUIRED");
  }
  private async event(
    manager: EntityManager,
    input: { workspaceId: string; ref: ExactRevisionRef; actorRef: string; correlationId: string },
    action: "PUBLISH" | "REVOKE",
  ) {
    await manager.query(
      "INSERT INTO runtime_configuration_events(event_id,workspace_id,configuration_id,version,action,actor_ref,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        randomUUID(),
        input.workspaceId,
        input.ref.id,
        input.ref.version,
        action,
        input.actorRef,
        input.correlationId,
      ],
    );
  }
}
