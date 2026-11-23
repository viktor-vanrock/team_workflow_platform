import { createHash } from "node:crypto";

import type { DataSource, EntityManager } from "typeorm";

import {
  assessQaReadiness,
  buildInitialQaRequestInputRevision,
  createQaRequestExtension,
  onOperationalImport,
  qaAggregateSnapshotHash,
  type QaAuthorizationBasis,
  type QaHumanActor,
  QaProjectPolicyRepository,
  QaTypeOrmIntakeConfirmationWriter,
} from "@awp/competency-qa/node";
import { JiraRestClient } from "@awp/connector-jira";
import { type JsonValue, sha256 } from "@awp/platform-contracts";
import type { CompleteOperationalObservation } from "@awp/platform-core";
import { TypeOrmOperationalAuthorityRepository } from "@awp/platform-persistence-typeorm";

import { isQaJiraLocalComposition, type RuntimeEnvironment } from "../config/environment.ts";
import { qaJiraLocalSeedRefs } from "../seed/qa-jira-local-seed.ts";
import { qaLocalSeedIds } from "../seed/qa-local-seed.ts";

type Row = Readonly<Record<string, unknown>>;
type RecordValue = Readonly<Record<string, unknown>>;

interface JiraIssueDocument {
  readonly id: string;
  readonly key: string;
  readonly updated?: string;
  readonly changelogId?: string;
  readonly fields: RecordValue;
}

interface ImportConfiguration {
  readonly projectId: string;
  readonly issueTypeId: string;
  readonly discriminatorFieldId: string;
  readonly discriminator: string;
  readonly connectionRef: Readonly<{ id: string; version: number; contentHash: string }>;
  readonly mappingRef: Readonly<{ id: string; version: number; contentHash: string }>;
  readonly profileRef: Readonly<{ id: string; version: number; contentHash: string }>;
  readonly bindingRef: Readonly<{ id: string; version: number; contentHash: string }>;
}

export interface QaJiraImportResult {
  readonly disposition:
    | "ADOPTED"
    | "DUPLICATE"
    | "AWAITING_CONFIRMATION"
    | "IGNORED_OUT_OF_SCOPE"
    | "REJECTED_SECURITY";
  readonly externalEntityId: string;
  readonly externalKey: string;
  readonly providerUpdatedAt: string;
  readonly intentId?: string;
  readonly workItemId?: string;
  readonly bindingId?: string;
  readonly reasonCode?: string;
}

function deterministicUuid(namespace: string): string {
  const hex = createHash("sha256").update(namespace).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}

function record(value: unknown, code: string): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value as RecordValue;
}

function text(value: unknown, code: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(code);
  return value;
}

function json<T>(value: unknown): T {
  return typeof value === "string" ? (JSON.parse(value) as T) : (value as T);
}

function safeProviderTime(value: unknown): string {
  const parsed = typeof value === "string" ? new Date(value) : new Date();
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : new Date().toISOString();
}

function exactRef(
  id: string,
  version: number,
  contentHash: unknown,
): Readonly<{ id: string; version: number; contentHash: string }> {
  const hash = text(contentHash, "JIRA_IMPORT_CONFIGURATION_HASH_REQUIRED");
  if (!hash.startsWith("sha256:")) throw new Error("JIRA_IMPORT_CONFIGURATION_HASH_INVALID");
  return Object.freeze({ id, version, contentHash: hash });
}

function fieldIdentity(fields: RecordValue, key: "project" | "issuetype"): string {
  return text(
    record(fields[key], `JIRA_IMPORT_${key.toUpperCase()}_REQUIRED`).id,
    `JIRA_IMPORT_${key.toUpperCase()}_ID_REQUIRED`,
  );
}

function creatorId(fields: RecordValue): string {
  const candidate = fields.creator ?? fields.reporter;
  return text(
    record(candidate, "JIRA_IMPORT_CREATOR_REQUIRED").accountId,
    "JIRA_IMPORT_CREATOR_ID_REQUIRED",
  );
}

function normalizedStatus(
  fields: RecordValue,
): Readonly<{ raw: Readonly<{ id: string; name: string }>; normalized: "NEW" | "DONE" }> {
  const status = record(fields.status, "JIRA_IMPORT_STATUS_REQUIRED");
  const id = text(status.id, "JIRA_IMPORT_STATUS_ID_REQUIRED");
  const name = text(status.name, "JIRA_IMPORT_STATUS_NAME_REQUIRED");
  if (id === "1") return Object.freeze({ raw: Object.freeze({ id, name }), normalized: "NEW" });
  if (id === "2") return Object.freeze({ raw: Object.freeze({ id, name }), normalized: "DONE" });
  throw new Error("JIRA_IMPORT_STATUS_MAPPING_REQUIRED");
}

export class QaJiraLocalImportService {
  readonly #client: JiraRestClient;

  constructor(
    private readonly source: DataSource,
    environment: RuntimeEnvironment,
  ) {
    if (!isQaJiraLocalComposition(environment.composition) || !environment.mockHubUrl)
      throw new Error("QA_JIRA_LOCAL_IMPORT_COMPOSITION_REQUIRED");
    const endpoint = new URL(environment.mockHubUrl);
    this.#client = new JiraRestClient({
      baseUrl: endpoint.toString(),
      environment: "LOCAL",
      allowedOrigins: [endpoint.origin],
      allowedLocalHostnames: [endpoint.hostname],
      transport: fetch,
    });
  }

  async importExternalIssue(
    input: Readonly<{
      workspaceId: string;
      projectId: string;
      connectionId: string;
      externalEntityId: string;
      receiptIdentity: string;
      source: "WEBHOOK" | "IMPORT_RECONCILIATION";
    }>,
  ): Promise<QaJiraImportResult> {
    const existing = await new TypeOrmOperationalAuthorityRepository(
      this.source,
    ).bindingByExternalIdentity(input.connectionId, "REQUEST", input.externalEntityId);
    if (existing) {
      return Object.freeze({
        disposition: "DUPLICATE",
        externalEntityId: input.externalEntityId,
        externalKey: String(existing.current_external_display_key),
        providerUpdatedAt: safeProviderTime(existing.last_observed_at),
        workItemId: String(existing.work_item_id),
        bindingId: String(existing.id),
      });
    }

    const [configuration, issue] = await Promise.all([
      this.#configuration(input.workspaceId, input.projectId, input.connectionId),
      this.#readIssue(input.externalEntityId),
    ]);
    const authoritativeReadHash = sha256(issue as unknown as JsonValue);
    const providerUpdatedAt = safeProviderTime(issue.updated ?? issue.fields.updated);
    const revisionToken = text(
      issue.changelogId ?? issue.updated ?? issue.fields.updated,
      "JIRA_IMPORT_REVISION_REQUIRED",
    );
    const externalProjectId = fieldIdentity(issue.fields, "project");
    const externalIssueTypeId = fieldIdentity(issue.fields, "issuetype");
    const discriminator = issue.fields[configuration.discriminatorFieldId];
    const route =
      externalProjectId !== configuration.projectId
        ? Object.freeze({ state: "IGNORED_OUT_OF_SCOPE" as const, reasonCode: "PROJECT_MISMATCH" })
        : externalIssueTypeId !== configuration.issueTypeId
          ? Object.freeze({
              state: "IGNORED_OUT_OF_SCOPE" as const,
              reasonCode: "ISSUE_TYPE_MISMATCH",
            })
          : discriminator !== configuration.discriminator
            ? Object.freeze({
                state: "IGNORED_OUT_OF_SCOPE" as const,
                reasonCode: "PROJECT_DISCRIMINATOR_MISMATCH",
              })
            : undefined;
    if (route) {
      return await this.#terminalIntent(input, configuration, issue, {
        authoritativeReadHash,
        providerUpdatedAt,
        revisionToken,
        state: route.state,
        reasonCode: route.reasonCode,
        displayKey: "REDACTED",
        externalCreatorId: "REDACTED",
        discriminator: "REDACTED",
      });
    }

    const externalCreatorId = creatorId(issue.fields);
    const access = await this.#verifiedAccess(input, externalCreatorId);
    if (!access) {
      return await this.#terminalIntent(input, configuration, issue, {
        authoritativeReadHash,
        providerUpdatedAt,
        revisionToken,
        state: "AWAITING_CONFIRMATION",
        reasonCode: "IMPORT_CREATOR_NOT_VERIFIED",
        displayKey: issue.key,
        externalCreatorId,
        discriminator: configuration.discriminator,
      });
    }
    return await this.#adopt(
      input,
      configuration,
      issue,
      authoritativeReadHash,
      providerUpdatedAt,
      revisionToken,
      externalCreatorId,
      access,
    );
  }

  async reconcileImportDiscovery(
    input: Readonly<{
      workspaceId: string;
      projectId: string;
      connectionId: string;
      runId: string;
      cursorId: string;
    }>,
  ): Promise<Readonly<{ discovered: number; applied: number }>> {
    const configuration = await this.#configuration(
      input.workspaceId,
      input.projectId,
      input.connectionId,
    );
    await this.source.query(
      "UPDATE reconciliation_runs SET state='RUNNING',resource_version=resource_version+1 WHERE workspace_id=$1 AND project_id=$2 AND id=$3 AND state IN ('PENDING','RUNNING')",
      [input.workspaceId, input.projectId, input.runId],
    );
    const jql = `project = ${configuration.projectId} AND issuetype = ${configuration.issueTypeId} AND ${configuration.discriminatorFieldId} = "${configuration.discriminator}"`;
    const response = await this.#client.request({
      method: "GET",
      path: `/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}`,
    });
    const payload = (await response.json()) as Readonly<{ issues?: readonly unknown[] }>;
    const issues = Array.isArray(payload.issues)
      ? payload.issues.map((candidate) => record(candidate, "JIRA_IMPORT_SEARCH_ISSUE_INVALID"))
      : [];
    let applied = 0;
    for (const candidate of issues) {
      const externalEntityId = text(candidate.id, "JIRA_IMPORT_SEARCH_ISSUE_ID_REQUIRED");
      const started = Date.now();
      const result = await this.importExternalIssue({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        connectionId: input.connectionId,
        externalEntityId,
        receiptIdentity: `${input.runId}:${externalEntityId}`,
        source: "IMPORT_RECONCILIATION",
      });
      if (result.disposition === "ADOPTED") applied += 1;
      const itemResult =
        result.disposition === "ADOPTED"
          ? "IMPORTED"
          : result.disposition === "DUPLICATE"
            ? "DUPLICATE"
            : "IGNORED";
      await this.source.query(
        `INSERT INTO reconciliation_run_items(
           run_id,workspace_id,project_id,external_entity_id,external_key,provider_updated_at,
           result,refs,safe_code,content_hash,duration_ms,created_at
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,clock_timestamp()) ON CONFLICT DO NOTHING`,
        [
          input.runId,
          input.workspaceId,
          input.projectId,
          externalEntityId,
          result.externalKey,
          result.providerUpdatedAt,
          itemResult,
          JSON.stringify({
            workItemId: result.workItemId,
            bindingId: result.bindingId,
            intentId: result.intentId,
          }),
          result.reasonCode ?? null,
          sha256({ externalEntityId, disposition: result.disposition } as JsonValue),
          Math.max(0, Date.now() - started),
        ],
      );
    }
    const finishedAt = new Date();
    await this.source.transaction("SERIALIZABLE", async (manager) => {
      await manager.query(
        "UPDATE reconciliation_runs SET state='SUCCEEDED',counts=$4,finished_at=$5,resource_version=resource_version+1 WHERE workspace_id=$1 AND project_id=$2 AND id=$3 AND state='RUNNING'",
        [
          input.workspaceId,
          input.projectId,
          input.runId,
          JSON.stringify({
            discovered: issues.length,
            applied,
            duplicate: issues.length - applied,
          }),
          finishedAt,
        ],
      );
      const last = issues.at(-1);
      await manager.query(
        "UPDATE reconciliation_cursors SET watermark_updated_at=$4,watermark_external_key=$5,last_success_at=$4,next_due_at=$4,resource_version=resource_version+1 WHERE workspace_id=$1 AND project_id=$2 AND id=$3",
        [
          input.workspaceId,
          input.projectId,
          input.cursorId,
          finishedAt,
          last ? text(last.key ?? last.id, "JIRA_IMPORT_SEARCH_KEY_REQUIRED") : "",
        ],
      );
    });
    return Object.freeze({ discovered: issues.length, applied });
  }

  async #configuration(
    workspaceId: string,
    projectId: string,
    connectionId: string,
  ): Promise<ImportConfiguration> {
    if (connectionId !== qaJiraLocalSeedRefs.connection.id)
      throw new Error("JIRA_IMPORT_CONNECTION_SCOPE_REJECTED");
    const rows = (await this.source.query(
      `SELECT
         c.content AS connection_content,c.content_hash AS connection_hash,
         m.content AS mapping_content,m.content_hash AS mapping_hash,
         p.content AS profile_content,p.content_hash AS profile_hash,
         b.content AS binding_content,b.content_hash AS binding_hash
       FROM connection_revisions c
       JOIN connector_mapping_revisions m ON m.header_id=$3 AND m.version=$4 AND m.status='PUBLISHED'
       JOIN connector_profile_revisions p ON p.header_id=$5 AND p.version=$6 AND p.status='PUBLISHED'
       JOIN project_integration_binding_revisions b ON b.header_id=$7 AND b.version=$8 AND b.status='PUBLISHED'
         AND b.workspace_id=$1 AND b.project_id=$2
       WHERE c.header_id=$9 AND c.version=$10 AND c.status='PUBLISHED' AND c.workspace_id=$1`,
      [
        workspaceId,
        projectId,
        qaJiraLocalSeedRefs.mapping.id,
        qaJiraLocalSeedRefs.mapping.version,
        qaJiraLocalSeedRefs.profile.id,
        qaJiraLocalSeedRefs.profile.version,
        qaJiraLocalSeedRefs.binding.id,
        qaJiraLocalSeedRefs.binding.version,
        qaJiraLocalSeedRefs.connection.id,
        qaJiraLocalSeedRefs.connection.version,
      ],
    )) as readonly Row[];
    const row = rows[0];
    if (!row) throw new Error("JIRA_IMPORT_CONFIGURATION_NOT_PUBLISHED");
    const profile = json<RecordValue>(row.profile_content);
    const mapping = json<RecordValue>(row.mapping_content);
    const fieldIds = record(mapping.requestCreateFieldIds, "JIRA_IMPORT_MAPPING_FIELDS_REQUIRED");
    return Object.freeze({
      projectId: text(
        record(profile.project, "JIRA_IMPORT_PROFILE_PROJECT_REQUIRED").id,
        "JIRA_IMPORT_PROFILE_PROJECT_ID_REQUIRED",
      ),
      issueTypeId: text(
        record(profile.issueType, "JIRA_IMPORT_PROFILE_ISSUE_TYPE_REQUIRED").id,
        "JIRA_IMPORT_PROFILE_ISSUE_TYPE_ID_REQUIRED",
      ),
      discriminatorFieldId: text(
        fieldIds.projectDiscriminator,
        "JIRA_IMPORT_DISCRIMINATOR_FIELD_REQUIRED",
      ),
      discriminator: text(mapping.projectDiscriminator, "JIRA_IMPORT_DISCRIMINATOR_REQUIRED"),
      connectionRef: exactRef(
        qaJiraLocalSeedRefs.connection.id,
        qaJiraLocalSeedRefs.connection.version,
        row.connection_hash,
      ),
      mappingRef: exactRef(
        qaJiraLocalSeedRefs.mapping.id,
        qaJiraLocalSeedRefs.mapping.version,
        row.mapping_hash,
      ),
      profileRef: exactRef(
        qaJiraLocalSeedRefs.profile.id,
        qaJiraLocalSeedRefs.profile.version,
        row.profile_hash,
      ),
      bindingRef: exactRef(
        qaJiraLocalSeedRefs.binding.id,
        qaJiraLocalSeedRefs.binding.version,
        row.binding_hash,
      ),
    });
  }

  async #readIssue(externalEntityId: string): Promise<JiraIssueDocument> {
    if (!/^[A-Za-z0-9._-]+$/u.test(externalEntityId))
      throw new Error("JIRA_IMPORT_EXTERNAL_ID_INVALID");
    const response = await this.#client.request({
      method: "GET",
      path: `/rest/api/3/issue/${encodeURIComponent(externalEntityId)}`,
    });
    const issue = record(await response.json(), "JIRA_IMPORT_ISSUE_INVALID");
    return Object.freeze({
      id: text(issue.id, "JIRA_IMPORT_ISSUE_ID_REQUIRED"),
      key: text(issue.key, "JIRA_IMPORT_ISSUE_KEY_REQUIRED"),
      ...(typeof issue.updated === "string" ? { updated: issue.updated } : {}),
      ...(typeof issue.changelogId === "string" ? { changelogId: issue.changelogId } : {}),
      fields: record(issue.fields, "JIRA_IMPORT_ISSUE_FIELDS_REQUIRED"),
    });
  }

  async #verifiedAccess(
    input: Readonly<{ workspaceId: string; projectId: string; connectionId: string }>,
    externalCreatorId: string,
  ): Promise<
    | Readonly<{
        bindingId: string;
        bindingVersion: number;
        principalId: string;
        actor: QaHumanActor;
        authorizationBasis: QaAuthorizationBasis;
        classificationCeiling: string;
      }>
    | undefined
  > {
    const rows = (await this.source.query(
      `SELECT epb.id AS external_binding_id,epb.resource_version AS external_binding_version,epb.principal_id,
              i.issuer,i.subject,wm.id AS membership_id,wm.row_version AS membership_version,
              ra.id AS role_id,ra.row_version AS role_version,
              pe.id AS entitlement_id,pe.row_version AS entitlement_version,pe.classification_ceiling_key
         FROM external_principal_bindings epb
         JOIN identities i ON i.id=epb.principal_id AND i.kind='HUMAN'
         JOIN workspace_memberships wm ON wm.workspace_id=epb.workspace_id AND wm.principal_id=epb.principal_id
           AND wm.state='ACTIVE' AND wm.revoked_at IS NULL AND wm.valid_from<=clock_timestamp()
           AND (wm.valid_until IS NULL OR wm.valid_until>clock_timestamp())
         JOIN role_assignments ra ON ra.workspace_id=epb.workspace_id AND ra.principal_id=epb.principal_id
           AND (ra.project_id IS NULL OR ra.project_id=$2) AND ra.effect='ALLOW' AND ra.revoked_at IS NULL
           AND ra.valid_from<=clock_timestamp() AND (ra.valid_until IS NULL OR ra.valid_until>clock_timestamp())
           AND ra.permissions ? 'qa.request.create'
         JOIN project_entitlements pe ON pe.workspace_id=epb.workspace_id AND pe.project_id=$2 AND pe.principal_id=epb.principal_id
           AND pe.effect='ALLOW' AND pe.revoked_at IS NULL AND pe.valid_from<=clock_timestamp()
           AND (pe.valid_until IS NULL OR pe.valid_until>clock_timestamp()) AND pe.permissions ? 'qa.request.create'
        WHERE epb.workspace_id=$1 AND epb.connection_header_id=$3 AND epb.provider_namespace='jira.local'
          AND epb.external_principal_kind='EXTERNAL_HUMAN' AND epb.external_principal_id=$4 AND epb.state='VERIFIED'
        ORDER BY epb.id,ra.id,pe.id`,
      [input.workspaceId, input.projectId, input.connectionId, externalCreatorId],
    )) as readonly Row[];
    if (rows.length === 0) return undefined;
    const externalBindings = new Set(rows.map((row) => String(row.external_binding_id)));
    if (externalBindings.size !== 1) throw new Error("JIRA_IMPORT_CREATOR_BINDING_AMBIGUOUS");
    const row = rows[0]!;
    const actor: QaHumanActor = Object.freeze({
      kind: "HUMAN",
      principalId: String(row.principal_id),
      issuer: String(row.issuer),
      subject: String(row.subject),
    });
    const authorizationBasis: QaAuthorizationBasis = Object.freeze({
      kind: "PROJECT",
      policyVersion: "identity-access@live",
      membershipRef: Object.freeze({
        id: String(row.membership_id),
        version: Number(row.membership_version),
      }),
      roleAssignmentRefs: Object.freeze(
        rows.map((candidate) =>
          Object.freeze({ id: String(candidate.role_id), version: Number(candidate.role_version) }),
        ),
      ),
      entitlementRefs: Object.freeze(
        rows.map((candidate) =>
          Object.freeze({
            id: String(candidate.entitlement_id),
            version: Number(candidate.entitlement_version),
          }),
        ),
      ),
      skillContext: "NOT_APPLICABLE",
    });
    return Object.freeze({
      bindingId: String(row.external_binding_id),
      bindingVersion: Number(row.external_binding_version),
      principalId: String(row.principal_id),
      actor,
      authorizationBasis,
      classificationCeiling: String(row.classification_ceiling_key),
    });
  }

  async #terminalIntent(
    input: Readonly<{
      workspaceId: string;
      projectId: string;
      connectionId: string;
      externalEntityId: string;
      receiptIdentity: string;
      source: "WEBHOOK" | "IMPORT_RECONCILIATION";
    }>,
    configuration: ImportConfiguration,
    issue: JiraIssueDocument,
    terminal: Readonly<{
      authoritativeReadHash: string;
      providerUpdatedAt: string;
      revisionToken: string;
      state: "AWAITING_CONFIRMATION" | "IGNORED_OUT_OF_SCOPE" | "REJECTED_SECURITY";
      reasonCode: string;
      displayKey: string;
      externalCreatorId: string;
      discriminator: string;
    }>,
  ): Promise<QaJiraImportResult> {
    const intentId = deterministicUuid(
      `jira-import:${input.connectionId}:${input.externalEntityId}`,
    );
    const correlationId = deterministicUuid(`${input.receiptIdentity}:import-correlation`);
    const causationId = deterministicUuid(`${input.receiptIdentity}:import-causation`);
    await this.source.transaction("SERIALIZABLE", async (manager) => {
      await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `jira-import:${input.connectionId}:${input.externalEntityId}`,
      ]);
      await this.#upsertIntent(manager, {
        intentId,
        input,
        configuration,
        displayKey: terminal.displayKey,
        authoritativeReadHash: terminal.authoritativeReadHash,
        revisionToken: terminal.revisionToken,
        externalCreatorId: terminal.externalCreatorId,
        discriminator: terminal.discriminator,
        correlationId,
        causationId,
      });
      await manager.query(
        "UPDATE operational_import_intents SET state=$4,reason_code=$5,updated_at=clock_timestamp(),resource_version=resource_version+1 WHERE workspace_id=$1 AND project_id=$2 AND id=$3 AND state<>'ADOPTED'",
        [input.workspaceId, input.projectId, intentId, terminal.state, terminal.reasonCode],
      );
    });
    return Object.freeze({
      disposition: terminal.state,
      externalEntityId: issue.id,
      externalKey: terminal.displayKey,
      providerUpdatedAt: terminal.providerUpdatedAt,
      intentId,
      reasonCode: terminal.reasonCode,
    });
  }

  async #adopt(
    input: Readonly<{
      workspaceId: string;
      projectId: string;
      connectionId: string;
      externalEntityId: string;
      receiptIdentity: string;
      source: "WEBHOOK" | "IMPORT_RECONCILIATION";
    }>,
    configuration: ImportConfiguration,
    issue: JiraIssueDocument,
    authoritativeReadHash: string,
    providerUpdatedAt: string,
    revisionToken: string,
    externalCreatorId: string,
    access: Readonly<{
      bindingId: string;
      bindingVersion: number;
      principalId: string;
      actor: QaHumanActor;
      authorizationBasis: QaAuthorizationBasis;
      classificationCeiling: string;
    }>,
  ): Promise<QaJiraImportResult> {
    const intentId = deterministicUuid(
      `jira-import:${input.connectionId}:${input.externalEntityId}`,
    );
    const workItemId = deterministicUuid(`${intentId}:work-item`);
    const bindingId = deterministicUuid(`${intentId}:operational-binding`);
    const inputRevisionId = deterministicUuid(`${intentId}:qa-input:1`);
    const extensionId = deterministicUuid(`${intentId}:qa-extension`);
    const correlationId = deterministicUuid(`${input.receiptIdentity}:import-correlation`);
    const causationId = deterministicUuid(`${input.receiptIdentity}:import-causation`);
    const title = text(issue.fields.summary, "JIRA_IMPORT_SUMMARY_REQUIRED");
    const description =
      typeof issue.fields.description === "string" && issue.fields.description.trim().length > 0
        ? issue.fields.description
        : undefined;
    const status = normalizedStatus(issue.fields);

    return await this.source.transaction("SERIALIZABLE", async (manager) => {
      await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `jira-import:${input.connectionId}:${input.externalEntityId}`,
      ]);
      const existing = (await manager.query(
        "SELECT id,work_item_id,current_external_display_key,last_observed_at FROM operational_bindings WHERE connection_header_id=$1 AND external_entity_type='REQUEST' AND external_entity_id=$2",
        [input.connectionId, input.externalEntityId],
      )) as readonly Row[];
      if (existing[0]) {
        return Object.freeze({
          disposition: "DUPLICATE" as const,
          externalEntityId: input.externalEntityId,
          externalKey: String(existing[0].current_external_display_key),
          providerUpdatedAt: safeProviderTime(existing[0].last_observed_at),
          workItemId: String(existing[0].work_item_id),
          bindingId: String(existing[0].id),
        });
      }
      await this.#upsertIntent(manager, {
        intentId,
        input,
        configuration,
        displayKey: issue.key,
        authoritativeReadHash,
        revisionToken,
        externalCreatorId,
        discriminator: configuration.discriminator,
        correlationId,
        causationId,
      });
      await manager.query(
        "INSERT INTO work_items(id,workspace_id,project_id,work_type_definition_id,source_draft_id,created_by,state,classification_key,row_version,created_at,acceptance_source,operational_import_intent_id,title,normalized_status,requester_principal_id,updated_at) VALUES($1,$2,$3,$4,NULL,$5,'NEW','INTERNAL',1,clock_timestamp(),'OPERATIONAL_IMPORT',$6,$7,$8,$5,clock_timestamp())",
        [
          workItemId,
          input.workspaceId,
          input.projectId,
          qaLocalSeedIds.workType,
          access.principalId,
          intentId,
          title,
          status.normalized,
        ],
      );
      await manager.query(
        `INSERT INTO operational_bindings(
           id,workspace_id,project_id,work_item_id,project_integration_binding_ref,connector_profile_ref,
           connection_header_id,connection_ref,mapping_ref,adapter_family,adapter_contract_version,
           external_entity_type,external_entity_id,initial_external_display_key,current_external_display_key,
           acceptance_source,current_projection_revision_id,current_external_revision_token,sync_state,freshness_state,
           fresh_until,last_observed_at,created_at,created_by,updated_at,row_version
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'jira-cloud-v3','1.0.0','REQUEST',$10,$11,$11,
           'VERIFIED_IMPORT',NULL,NULL,'SYNCED','CURRENT',$12,$13,clock_timestamp(),$14,clock_timestamp(),1)`,
        [
          bindingId,
          input.workspaceId,
          input.projectId,
          workItemId,
          JSON.stringify(configuration.bindingRef),
          JSON.stringify(configuration.profileRef),
          input.connectionId,
          JSON.stringify(configuration.connectionRef),
          JSON.stringify(configuration.mappingRef),
          input.externalEntityId,
          issue.key,
          new Date(Date.parse(providerUpdatedAt) + 120_000),
          providerUpdatedAt,
          access.principalId,
        ],
      );
      const observation: CompleteOperationalObservation = Object.freeze({
        observationId: deterministicUuid(`${intentId}:import-observation`),
        source: "IMPORT_READ",
        externalEntityId: input.externalEntityId,
        externalDisplayKey: issue.key,
        externalRevisionToken: revisionToken,
        authorityFieldsHash: authoritativeReadHash,
        providerUpdatedAt,
        ...(issue.changelogId ? { providerChangelogId: issue.changelogId } : {}),
        observedAt: providerUpdatedAt,
        rawStatus: status.raw,
        normalizedStatus: status.normalized,
        requester: Object.freeze({
          externalPrincipalId: externalCreatorId,
          canonicalPrincipalId: access.principalId,
        }),
        assignee: null,
        priority: null,
        dueDate: null,
        profileRef: configuration.profileRef,
        mappingRef: configuration.mappingRef,
        connectionRef: configuration.connectionRef,
        adapterFamily: "jira-cloud-v3",
        adapterContractVersion: "1.0.0",
      });
      await new TypeOrmOperationalAuthorityRepository(this.source).reduceObservation(
        manager,
        { workspaceId: input.workspaceId, projectId: input.projectId, bindingId },
        observation,
        sha256(observation as unknown as JsonValue),
        correlationId,
        causationId,
      );
      await manager.query(
        "UPDATE work_items SET operational_binding_id=$4,updated_at=clock_timestamp() WHERE workspace_id=$1 AND project_id=$2 AND id=$3",
        [input.workspaceId, input.projectId, workItemId, bindingId],
      );

      const projectContext = await new QaProjectPolicyRepository(manager).currentProjectContext(
        { workspaceId: input.workspaceId, projectId: input.projectId },
        qaLocalSeedIds.context,
      );
      if (!projectContext) throw new Error("QA_JIRA_IMPORT_PROJECT_CONTEXT_REQUIRED");
      const responsePolicy = Object.freeze({
        key: "qa.response-channel-resolution",
        version: "1.0.0",
        contentHash: sha256({ key: "qa.response-channel-resolution", version: "1.0.0" }),
      });
      const responseChannel = Object.freeze({
        channelKind: "PLATFORM_WEB" as const,
        channelId: "95000000-0000-4000-8000-000000000001",
        version: 1,
        contentHash: sha256({
          state: "CONFIRMED",
          channelId: "95000000-0000-4000-8000-000000000001",
          version: 1,
        }),
      });
      const initialInput = buildInitialQaRequestInputRevision({
        inputRevisionId,
        scope: { workspaceId: input.workspaceId, projectId: input.projectId },
        workItemId,
        acceptedDraftRef: {
          kind: "operational-import-intent",
          id: intentId,
          version: revisionToken,
          contentHash: authoritativeReadHash as `sha256:${string}`,
        },
        externalRequestRef: {
          kind: "jira-issue",
          id: input.externalEntityId,
          version: revisionToken,
          contentHash: authoritativeReadHash as `sha256:${string}`,
        },
        operationalBindingRef: { id: bindingId, version: 1 },
        originalRequesterRef: access.actor,
        title,
        requestKind: "feature-validation",
        semanticInput: Object.freeze({ ...(description ? { goal: description } : {}) }),
        blockersDeclared: false,
        dependenciesDeclared: false,
        dataClassificationKey: "INTERNAL",
        responseChannelResolution: Object.freeze({
          state: "CONFIRMED" as const,
          requesterPrincipal: access.actor,
          resolutionPolicyRef: responsePolicy,
          responseChannelRef: responseChannel,
          evaluatedAt: providerUpdatedAt,
        }),
        recordedBy: access.actor,
        authorizationBasis: access.authorizationBasis,
        recordedAt: providerUpdatedAt,
        correlationId,
        causationId,
      });
      const extension = createQaRequestExtension({
        extensionId,
        scope: { workspaceId: input.workspaceId, projectId: input.projectId },
        workItemId,
        currentInput: initialInput,
        projectContext,
        createdBy: access.actor,
        createdAt: providerUpdatedAt,
        correlationId,
      });
      await new QaTypeOrmIntakeConfirmationWriter().persist(
        {
          transactionId: `jira-import:${intentId}`,
          native: manager,
          contributionKey: "qa.operational-import",
          idempotencyKey: intentId,
        },
        { extension, initialInput },
      );
      const completeness = onOperationalImport({
        workItemId,
        normalizedOperationalStatus: status.normalized,
        requiredFields: ["goal", "scope", "acceptanceOutcome"],
        fields: Object.freeze({ ...(description ? { goal: description } : {}) }),
      });
      const assessment = await assessQaReadiness(
        {
          scope: { workspaceId: input.workspaceId, projectId: input.projectId },
          workItemId,
          extensionResourceVersion: extension.resourceVersion,
          currentInput: initialInput,
          acceptedRequest: {
            exists: true,
            externalVersion: revisionToken,
            normalizedStatus: status.normalized,
          },
          project: { state: "ACTIVE", registryState: "CURRENT", registryRevision: 1 },
          requesterEntitlement: {
            active: true,
            basisHash: qaAggregateSnapshotHash(access.authorizationBasis as never),
          },
          mappingHealth: {
            valid: true,
            bindingRef: { id: bindingId, version: 1 },
            profileRef: configuration.profileRef,
          },
          contextRef: {
            id: projectContext.contextId,
            version: projectContext.version,
            contentHash: projectContext.contentHash,
          },
          dorRuleSetRef: projectContext.dorRuleSetRef,
          allowedEnvironmentRefs: projectContext.allowedEnvironments.map(
            ({ environmentId, revision }) => ({ environmentId, revision }),
          ),
          maximumClassificationKey: projectContext.maximumClassificationKey,
          evaluatedBy: access.actor,
          evaluatedAt: providerUpdatedAt,
        },
        manager,
      );
      if (completeness.completeness !== "NEEDS_INFO" || assessment.state !== "NEEDS_INFO")
        throw new Error("QA_JIRA_IMPORT_COMPLETENESS_CONFLICT");
      await manager.query(
        "UPDATE work_items SET state=$4,updated_at=clock_timestamp(),row_version=row_version+1 WHERE workspace_id=$1 AND project_id=$2 AND id=$3",
        [input.workspaceId, input.projectId, workItemId, assessment.state],
      );
      await manager.query(
        `UPDATE operational_import_intents
            SET project_integration_binding_ref=$4,external_principal_binding_ref=$5,state='ADOPTED',reason_code=NULL,
                result_work_item_id=$6,result_binding_id=$7,adopted_at=clock_timestamp(),updated_at=clock_timestamp(),resource_version=resource_version+1
          WHERE workspace_id=$1 AND project_id=$2 AND id=$3`,
        [
          input.workspaceId,
          input.projectId,
          intentId,
          JSON.stringify(configuration.bindingRef),
          JSON.stringify({ id: access.bindingId, version: access.bindingVersion }),
          workItemId,
          bindingId,
        ],
      );
      const importedEnvelope = Object.freeze({
        schemaVersion: 1,
        workItemId,
        bindingId,
        importIntentId: intentId,
        externalEntityId: input.externalEntityId,
        normalizedStatus: status.normalized,
        correlationId,
      });
      await manager.query(
        "INSERT INTO event_outbox(id,workspace_id,project_id,event_type,envelope,envelope_hash,state,created_at) VALUES($1,$2,$3,'work_item.operational.imported',$4,$5,'READY',clock_timestamp()) ON CONFLICT DO NOTHING",
        [
          deterministicUuid(`${intentId}:imported-event`),
          input.workspaceId,
          input.projectId,
          JSON.stringify(importedEnvelope),
          sha256(importedEnvelope as unknown as JsonValue),
        ],
      );
      await manager.query(
        "INSERT INTO audit_events(id,workspace_id,project_id,occurred_at,actor,action,outcome,reason_code,correlation_id,causation_id,authorization_basis,classification_key,attributes) VALUES($1,$2,$3,clock_timestamp(),$4,'work-item.operational-import','SUCCEEDED','VERIFIED_HUMAN_IMPORT',$5,$6,$7,'INTERNAL',$8) ON CONFLICT DO NOTHING",
        [
          deterministicUuid(`${intentId}:audit`),
          input.workspaceId,
          input.projectId,
          JSON.stringify(access.actor),
          correlationId,
          causationId,
          JSON.stringify(access.authorizationBasis),
          JSON.stringify({
            values: { workItemId, bindingId, importIntentId: intentId },
            versionRefs: [configuration.profileRef, configuration.bindingRef],
          }),
        ],
      );
      return Object.freeze({
        disposition: "ADOPTED" as const,
        externalEntityId: input.externalEntityId,
        externalKey: issue.key,
        providerUpdatedAt,
        intentId,
        workItemId,
        bindingId,
      });
    });
  }

  async #upsertIntent(
    manager: EntityManager,
    value: Readonly<{
      intentId: string;
      input: Readonly<{
        workspaceId: string;
        projectId: string;
        connectionId: string;
        externalEntityId: string;
        receiptIdentity: string;
        source: "WEBHOOK" | "IMPORT_RECONCILIATION";
      }>;
      configuration: ImportConfiguration;
      displayKey: string;
      authoritativeReadHash: string;
      revisionToken: string;
      externalCreatorId: string;
      discriminator: string;
      correlationId: string;
      causationId: string;
    }>,
  ): Promise<void> {
    await manager.query(
      `INSERT INTO operational_import_intents(
         id,workspace_id,project_id,connection_header_id,connection_ref,profile_ref,external_entity_type,
         external_entity_id,external_display_key,discovery_source,discovery_payload_hash,authoritative_read_hash,
         external_revision_token,external_creator_id,project_discriminator,state,correlation_id,causation_id,created_at,updated_at
       ) VALUES($1,$2,$3,$4,$5,$6,'REQUEST',$7,$8,$9,$10,$11,$12,$13,$14,'DISCOVERED',$15,$16,clock_timestamp(),clock_timestamp())
       ON CONFLICT(connection_header_id,external_entity_type,external_entity_id) DO UPDATE SET
         external_display_key=CASE WHEN operational_import_intents.state='ADOPTED' THEN operational_import_intents.external_display_key ELSE EXCLUDED.external_display_key END,
         discovery_source=CASE WHEN operational_import_intents.state='ADOPTED' THEN operational_import_intents.discovery_source ELSE EXCLUDED.discovery_source END,
         discovery_payload_hash=CASE WHEN operational_import_intents.state='ADOPTED' THEN operational_import_intents.discovery_payload_hash ELSE EXCLUDED.discovery_payload_hash END,
         authoritative_read_hash=CASE WHEN operational_import_intents.state='ADOPTED' THEN operational_import_intents.authoritative_read_hash ELSE EXCLUDED.authoritative_read_hash END,
         external_revision_token=CASE WHEN operational_import_intents.state='ADOPTED' THEN operational_import_intents.external_revision_token ELSE EXCLUDED.external_revision_token END,
         external_creator_id=CASE WHEN operational_import_intents.state='ADOPTED' THEN operational_import_intents.external_creator_id ELSE EXCLUDED.external_creator_id END,
         project_discriminator=CASE WHEN operational_import_intents.state='ADOPTED' THEN operational_import_intents.project_discriminator ELSE EXCLUDED.project_discriminator END,
         state=CASE WHEN operational_import_intents.state='ADOPTED' THEN 'ADOPTED' ELSE 'DISCOVERED' END,
         reason_code=CASE WHEN operational_import_intents.state='ADOPTED' THEN operational_import_intents.reason_code ELSE NULL END,
         updated_at=clock_timestamp(),resource_version=operational_import_intents.resource_version+1`,
      [
        value.intentId,
        value.input.workspaceId,
        value.input.projectId,
        value.input.connectionId,
        JSON.stringify(value.configuration.connectionRef),
        JSON.stringify(value.configuration.profileRef),
        value.input.externalEntityId,
        value.displayKey,
        value.input.source,
        sha256({ receiptIdentity: value.input.receiptIdentity } as JsonValue),
        value.authoritativeReadHash,
        value.revisionToken,
        value.externalCreatorId,
        value.discriminator,
        value.correlationId,
        value.causationId,
      ],
    );
  }
}
