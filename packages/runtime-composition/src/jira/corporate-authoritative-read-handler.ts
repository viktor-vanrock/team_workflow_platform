import { randomUUID } from "node:crypto";
import type { DataSource, EntityManager } from "typeorm";
import type { JiraIssueRead } from "@awp/connector-jira";
import { sha256, type JsonValue } from "@awp/platform-contracts";
import { TypeOrmOperationalAuthorityRepository } from "@awp/platform-persistence-typeorm";
import type { JiraAuthoritativeReadOutboxClaim } from "@awp/connector-jira-persistence-typeorm";
import type { CorporateConnectorGrant } from "../pilot/connector-authority.ts";
import type { CorporateConnectorFactories } from "../pilot/connector-factories.ts";
import type { RuntimeEnvironment } from "../config/environment.ts";
import { integrationConfigurationHash } from "../onboarding/configuration-hash.ts";
import { jiraMappingRuntimeContent } from "./qa-connection-content.ts";
import {
  corporateJiraObservationMappings,
  normalizeCorporateJiraObservation,
} from "./corporate-issue-observation.ts";
import type { CorporateJiraAuthoritativeReadHandler } from "./corporate-authoritative-read-worker.ts";

type Row = Record<string, unknown>;
const object = (value: unknown): Row => {
  const parsed = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("CORPORATE_JIRA_READ_CONFIGURATION_INVALID");
  return parsed as Row;
};
const equalRef = (value: unknown, ref: { id: string; version: number; contentHash?: string }) => {
  const candidate = object(value);
  return (
    candidate.id === ref.id &&
    Number(candidate.version) === ref.version &&
    (candidate.contentHash === undefined || candidate.contentHash === ref.contentHash)
  );
};
function profileValue(content: Row): Row {
  if (!content.profileConfiguration) return content;
  const envelope = object(content.profileConfiguration);
  return object(envelope.value ?? envelope);
}

export function createCorporateJiraAuthoritativeReadHandler(
  input: Readonly<{
    source: DataSource;
    environment: RuntimeEnvironment;
    grants: readonly CorporateConnectorGrant[];
    factories: CorporateConnectorFactories;
  }>,
): CorporateJiraAuthoritativeReadHandler {
  const deployment = input.environment.deployment;
  if (
    !input.source.isInitialized ||
    input.environment.profile !== "non-local" ||
    input.environment.environmentScope !== "NON_PROD" ||
    !deployment
  )
    throw new Error("CORPORATE_JIRA_READ_AUTHORITY_REQUIRED");
  const load = async (
    query: Pick<EntityManager, "query">,
    claim: JiraAuthoritativeReadOutboxClaim,
    lock: boolean,
  ) => {
    if (
      claim.workspaceId !== deployment.workspaceId ||
      !deployment.projectIds.includes(claim.projectId)
    )
      throw new Error("CORPORATE_JIRA_READ_SCOPE_DENIED");
    const job = object(claim.envelope);
    if (
      (job.kind !== undefined && !["BOUND_POLL", "WEBHOOK_READ"].includes(String(job.kind))) ||
      typeof job.connectionId !== "string" ||
      typeof job.externalEntityId !== "string" ||
      !/^[A-Za-z0-9._-]{1,128}$/u.test(job.externalEntityId)
    )
      throw new Error("CORPORATE_JIRA_READ_JOB_UNSUPPORTED");
    const grants = input.grants.filter(
      ({ binding }) =>
        binding.provider === "JIRA" &&
        binding.workspaceId === claim.workspaceId &&
        binding.projectId === claim.projectId &&
        binding.connectionRef.id === job.connectionId,
    );
    if (grants.length !== 1) throw new Error("CORPORATE_JIRA_READ_BINDING_REQUIRED");
    const grant = grants[0]!;
    const rows = (await query.query(
      `SELECT b.*,p.authority_snapshot,pr.content AS profile_content,pr.content_hash AS profile_hash,
      mr.content AS mapping_content,mr.content_hash AS mapping_hash,br.content AS binding_content,cr.content AS connection_content
      FROM operational_bindings b
      LEFT JOIN operational_projection_revisions p ON p.id=b.current_projection_revision_id
      JOIN connector_profile_headers ph ON ph.workspace_id=b.workspace_id AND ph.id=$4 AND ph.current_published_version=$5
      JOIN connector_profile_revisions pr ON pr.workspace_id=ph.workspace_id AND pr.header_id=ph.id AND pr.version=ph.current_published_version AND pr.status='PUBLISHED'
      JOIN connector_mapping_headers mh ON mh.workspace_id=b.workspace_id AND mh.id=(b.mapping_ref->>'id')::uuid AND mh.current_published_version=(b.mapping_ref->>'version')::integer
      JOIN connector_mapping_revisions mr ON mr.workspace_id=mh.workspace_id AND mr.header_id=mh.id AND mr.version=mh.current_published_version AND mr.status='PUBLISHED'
      JOIN project_integration_binding_headers bh ON bh.workspace_id=b.workspace_id AND bh.project_id=b.project_id AND bh.id=$7 AND bh.current_published_version=$8
      JOIN project_integration_binding_revisions br ON br.workspace_id=bh.workspace_id AND br.project_id=bh.project_id AND br.header_id=bh.id AND br.version=bh.current_published_version AND br.status='PUBLISHED' AND br.content_hash=$9
      JOIN connection_headers ch ON ch.workspace_id=b.workspace_id AND ch.id=$10 AND ch.current_published_version=$11
      JOIN connection_revisions cr ON cr.workspace_id=ch.workspace_id AND cr.header_id=ch.id AND cr.version=ch.current_published_version AND cr.status='PUBLISHED' AND cr.content_hash=$12
      WHERE b.workspace_id=$1 AND b.project_id=$2 AND b.connection_header_id=$3 AND b.external_entity_type='REQUEST' AND b.external_entity_id=$6
      ${lock ? "FOR UPDATE OF b FOR SHARE OF ph,pr,mh,mr,bh,br,ch,cr" : ""}`,
      [
        claim.workspaceId,
        claim.projectId,
        job.connectionId,
        grant.binding.profileRef.id,
        grant.binding.profileRef.version,
        job.externalEntityId,
        grant.integrationBindingRef.id,
        grant.integrationBindingRef.version,
        grant.integrationBindingRef.contentHash,
        grant.binding.connectionRef.id,
        grant.binding.connectionRef.version,
        grant.binding.connectionRef.contentHash,
      ],
    )) as readonly Row[];
    if (rows.length !== 1) throw new Error("CORPORATE_JIRA_READ_BOUND_ISSUE_REQUIRED");
    const row = rows[0]!,
      profile = object(row.profile_content),
      mapping = object(row.mapping_content);
    if (
      !equalRef(row.project_integration_binding_ref, grant.integrationBindingRef) ||
      !equalRef(row.connector_profile_ref, grant.binding.profileRef) ||
      !equalRef(row.connection_ref, grant.binding.connectionRef) ||
      row.profile_hash !== grant.binding.profileRef.contentHash ||
      integrationConfigurationHash("connector_profile", profile) !== row.profile_hash ||
      integrationConfigurationHash("connector_mapping", mapping) !== row.mapping_hash ||
      integrationConfigurationHash("connection", object(row.connection_content)) !==
        grant.binding.connectionRef.contentHash ||
      integrationConfigurationHash("project_integration_binding", object(row.binding_content)) !==
        grant.integrationBindingRef.contentHash ||
      !equalRef(profile.mappingRef, {
        ...object(row.mapping_ref),
        contentHash: String(row.mapping_hash),
      } as never)
    )
      throw new Error("CORPORATE_JIRA_READ_CONFIGURATION_STALE");
    return {
      job,
      grant,
      row,
      profile: profileValue(profile),
      mapping: jiraMappingRuntimeContent(mapping),
      mappingHash: String(row.mapping_hash),
    };
  };
  return {
    async read(claim) {
      const before = await load(input.source.manager, claim, false);
      const profile = before.profile;
      const maps = corporateJiraObservationMappings(profile);
      const project = object(profile.project),
        identityPolicy = object(profile.identityPolicy);
      if (
        typeof project.id !== "string" ||
        !project.id ||
        identityPolicy.requesterMode !== "VERIFIED_REPORTER"
      )
        throw new Error("CORPORATE_JIRA_READ_PROFILE_UNSUPPORTED");
      const client = input.factories.jira(before.grant.binding.ref.id);
      const response = await client.request({
        method: "GET",
        path: `/rest/api/3/issue/${encodeURIComponent(String(before.job.externalEntityId))}`,
        signal: AbortSignal.timeout(10_000),
      });
      const raw = object(await response.json()),
        fields = object(raw.fields),
        jiraProject = object(fields.project),
        reporter = object(fields.reporter);
      const discriminatorField = profile.projectDiscriminatorFieldId;
      const discriminator = before.mapping.projectDiscriminator;
      if (
        jiraProject.id !== project.id ||
        typeof reporter.accountId !== "string" ||
        !reporter.accountId ||
        typeof discriminatorField !== "string" ||
        !/^customfield_[0-9]+$/u.test(discriminatorField) ||
        typeof discriminator !== "string" ||
        !discriminator ||
        fields[discriminatorField] !== discriminator
      )
        throw new Error("CORPORATE_JIRA_READ_PROJECT_OR_REQUESTER_MISMATCH");
      const issue = {
        id: raw.id,
        key: raw.key,
        updated: fields.updated,
        fields: { ...fields, requester: { accountId: reporter.accountId } },
      } as unknown as JiraIssueRead;
      const observation = normalizeCorporateJiraObservation({
        issue,
        ...maps,
        expectedExternalEntityId: String(before.job.externalEntityId),
        observationId: randomUUID(),
        observedAt: new Date().toISOString(),
        source: before.job.kind === "BOUND_POLL" ? "RECONCILIATION_READ" : "WEBHOOK_READ",
        profileRef: object(before.row.connector_profile_ref) as never,
        mappingRef: object(before.row.mapping_ref) as never,
        connectionRef: object(before.row.connection_ref) as never,
        adapterFamily: String(before.row.adapter_family),
        adapterContractVersion: String(before.row.adapter_contract_version),
      });
      return async (manager) => {
        const current = await load(manager, claim, true);
        if (current.row.id !== before.row.id || current.mappingHash !== before.mappingHash)
          throw new Error("CORPORATE_JIRA_READ_CONFIGURATION_STALE");
        const repository = new TypeOrmOperationalAuthorityRepository(input.source);
        const reduction = await repository.reduceObservation(
          manager,
          {
            workspaceId: claim.workspaceId,
            projectId: claim.projectId,
            bindingId: String(current.row.id),
          },
          observation,
          sha256(observation as unknown as JsonValue),
          claim.id,
          claim.id,
        );
        if (reduction.disposition === "APPLIED" || reduction.disposition === "DUPLICATE") {
          await manager.query(
            "UPDATE work_items SET normalized_status=$4,updated_at=clock_timestamp(),row_version=row_version+1 WHERE workspace_id=$1 AND project_id=$2 AND id=$3 AND normalized_status IS DISTINCT FROM $4",
            [
              claim.workspaceId,
              claim.projectId,
              current.row.work_item_id,
              reduction.projection!.normalizedStatus,
            ],
          );
          await manager.query(
            "UPDATE operational_bindings b SET freshness_state='CURRENT',sync_state=CASE WHEN EXISTS(SELECT 1 FROM operational_sync_conflicts c WHERE c.binding_id=b.id AND c.state IN ('OPEN','ACKNOWLEDGED')) THEN 'CONFLICT' ELSE 'SYNCED' END,last_error_code=NULL,last_observed_at=GREATEST(last_observed_at,$4::timestamptz),fresh_until=GREATEST(fresh_until,$4::timestamptz+interval '120 seconds'),updated_at=clock_timestamp(),row_version=row_version+1 WHERE workspace_id=$1 AND project_id=$2 AND id=$3",
            [claim.workspaceId, claim.projectId, current.row.id, observation.observedAt],
          );
          if (
            reduction.disposition === "APPLIED" ||
            current.row.sync_state !== "SYNCED" ||
            current.row.freshness_state !== "CURRENT"
          ) {
            const eventType =
              reduction.disposition === "APPLIED"
                ? "work_item.operational.projection-updated"
                : "work_item.operational.reconciliation-completed";
            const envelope = {
              schemaVersion: 1,
              workItemId: String(current.row.work_item_id),
              bindingId: String(current.row.id),
              revision: reduction.projection!.revision,
              entityVersion:
                reduction.disposition === "APPLIED"
                  ? reduction.projection!.revision
                  : Date.parse(observation.observedAt),
              externalEntityId: observation.externalEntityId,
              normalizedStatus: reduction.projection!.normalizedStatus,
              occurredAt: observation.observedAt,
              correlationId: claim.id,
              causationId: claim.id,
            };
            await manager.query(
              "INSERT INTO event_outbox(id,workspace_id,project_id,event_type,envelope,envelope_hash,state,created_at) VALUES($1,$2,$3,$4,$5,$6,'READY',clock_timestamp())",
              [
                randomUUID(),
                claim.workspaceId,
                claim.projectId,
                eventType,
                envelope,
                sha256(envelope as JsonValue),
              ],
            );
          }
        }
      };
    },
  };
}
