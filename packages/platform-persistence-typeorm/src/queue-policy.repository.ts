import type { DataSource, EntityManager } from "typeorm";

import {
  type BusinessCalendarRevision,
  type ProjectQueuePolicyFacet,
  type QueuePolicyNeutralView,
  type QueuePolicyRevision,
  type ResourceScope,
  validateBusinessCalendar,
  validateQueuePolicy,
} from "@awp/platform-core";

import { ScopedRepositoryBase } from "./scoped-repository-base.ts";

type Row = Record<string, unknown>;
export type RevisionWriteOutcome = Readonly<{
  outcome: "APPENDED" | "NO_OP_UNCHANGED";
  revision: number;
  semanticHash: string;
}>;

export class QueuePolicyRepository extends ScopedRepositoryBase {
  async publishBusinessCalendar(
    scope: Extract<ResourceScope, { kind: "WORKSPACE" }>,
    calendar: BusinessCalendarRevision,
    calendarRevisionId: string,
    expectedResourceVersion: number,
    executor?: EntityManager,
  ): Promise<void> {
    validateBusinessCalendar(calendar);
    if (calendar.workspaceId !== scope.workspaceId)
      throw new Error("BUSINESS_CALENDAR_SCOPE_MISMATCH");
    const run = async (manager: EntityManager) => {
      const heads = (await manager.query(
        "SELECT current_revision_id,resource_version FROM workspace_business_calendar_heads WHERE workspace_id=$1 AND calendar_id=$2 FOR UPDATE",
        [scope.workspaceId, calendar.calendarId],
      )) as Row[];
      if (heads.length === 0 && expectedResourceVersion !== 0)
        throw new Error("BUSINESS_CALENDAR_CAS_CONFLICT");
      if (heads.length === 0 && expectedResourceVersion === 0) {
        await manager.query(
          "INSERT INTO workspace_business_calendar_heads(calendar_id,workspace_id,calendar_key,current_revision_id,resource_version,created_at,updated_at) VALUES($1,$2,$3,$4,1,$5,$5)",
          [
            calendar.calendarId,
            scope.workspaceId,
            calendar.calendarKey,
            calendarRevisionId,
            calendar.publishedAt,
          ],
        );
      } else if (Number(heads[0]?.resource_version) !== expectedResourceVersion)
        throw new Error("BUSINESS_CALENDAR_CAS_CONFLICT");
      await manager.query(
        "INSERT INTO workspace_business_calendar_revisions(calendar_revision_id,calendar_id,workspace_id,revision_number,previous_revision_id,time_zone,weekly_intervals,date_overrides,valid_from,valid_through,dst_algorithm_ref,dst_rules,source_kind,source_ref,source_hash,owner_principal_id,effective_from,published_at,published_by,semantic_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)",
        [
          calendarRevisionId,
          calendar.calendarId,
          scope.workspaceId,
          calendar.revision,
          heads[0]?.current_revision_id ?? null,
          calendar.timeZone,
          JSON.stringify(calendar.weeklyIntervals),
          JSON.stringify(calendar.dateOverrides),
          calendar.validFrom,
          calendar.validThrough,
          JSON.stringify(calendar.dstAlgorithmRef),
          JSON.stringify(calendar.dstRules),
          calendar.sourceKind,
          calendar.sourceRef,
          calendar.sourceHash,
          calendar.ownerPrincipalId,
          calendar.effectiveFrom,
          calendar.publishedAt,
          calendar.publishedByPrincipalId,
          calendar.semanticHash,
        ],
      );
      if (heads.length === 1)
        await manager.query(
          "UPDATE workspace_business_calendar_heads SET current_revision_id=$3,resource_version=resource_version+1,updated_at=$4 WHERE workspace_id=$1 AND calendar_id=$2 AND resource_version=$5",
          [
            scope.workspaceId,
            calendar.calendarId,
            calendarRevisionId,
            calendar.publishedAt,
            expectedResourceVersion,
          ],
        );
    };
    if (executor) await run(executor);
    else await this.source.transaction("SERIALIZABLE", run);
  }

  async publishQueuePolicy(
    scope: Extract<ResourceScope, { kind: "WORKSPACE" }>,
    policy: QueuePolicyRevision,
    calendar: BusinessCalendarRevision,
    policyRevisionId: string,
    expectedResourceVersion: number,
    executor?: EntityManager,
  ): Promise<void> {
    if (policy.workspaceId !== scope.workspaceId) throw new Error("QUEUE_POLICY_SCOPE_MISMATCH");
    validateQueuePolicy(policy, calendar);
    const run = async (manager: EntityManager) => {
      const calendars = (await manager.query(
        "SELECT calendar_revision_id FROM workspace_business_calendar_revisions WHERE workspace_id=$1 AND calendar_id=$2 AND revision_number=$3 AND semantic_hash=$4",
        [
          scope.workspaceId,
          policy.calendarRef.id,
          policy.calendarRef.version,
          policy.calendarRef.semanticHash,
        ],
      )) as Row[];
      if (!calendars[0]) throw new Error("QUEUE_POLICY_CALENDAR_REVISION_NOT_FOUND");
      const heads = (await manager.query(
        "SELECT current_revision_id,resource_version FROM workspace_queue_policy_heads WHERE workspace_id=$1 AND queue_policy_id=$2 FOR UPDATE",
        [scope.workspaceId, policy.queuePolicyId],
      )) as Row[];
      if (heads.length === 0 && expectedResourceVersion !== 0)
        throw new Error("QUEUE_POLICY_CAS_CONFLICT");
      if (heads.length === 0 && expectedResourceVersion === 0) {
        await manager.query(
          "INSERT INTO workspace_queue_policy_heads(queue_policy_id,workspace_id,policy_key,current_revision_id,resource_version,created_at,updated_at) VALUES($1,$2,$3,$4,1,$5,$5)",
          [
            policy.queuePolicyId,
            scope.workspaceId,
            policy.policyKey,
            policyRevisionId,
            policy.publishedAt,
          ],
        );
      } else if (Number(heads[0]?.resource_version) !== expectedResourceVersion)
        throw new Error("QUEUE_POLICY_CAS_CONFLICT");
      await manager.query(
        "INSERT INTO workspace_queue_policy_revisions(policy_revision_id,queue_policy_id,workspace_id,revision_number,previous_revision_id,mode,calendar_revision_id,calendar_semantic_hash,comparator_ref,stage_rule_ref,status_mapping_ref,service_class_rules,workspace_human_wip_limit,active_expedite_limit,external_active_consumes_wip,block_reason_rules,sla_goals,aging_bands,project_entries,baseline_evidence_ref,effective_from,published_at,published_by,semantic_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)",
        [
          policyRevisionId,
          policy.queuePolicyId,
          scope.workspaceId,
          policy.revision,
          heads[0]?.current_revision_id ?? null,
          policy.mode,
          calendars[0].calendar_revision_id,
          policy.calendarRef.semanticHash,
          JSON.stringify(policy.comparatorRef),
          JSON.stringify(policy.stageRuleRef),
          JSON.stringify(policy.statusMappingRef),
          JSON.stringify(policy.serviceClassRules),
          policy.workspaceHumanWipLimit,
          policy.activeExpediteLimit,
          JSON.stringify(policy.externalActiveConsumesWip),
          JSON.stringify(policy.blockReasonRules),
          JSON.stringify(policy.slaGoals),
          JSON.stringify(policy.agingBands),
          JSON.stringify(policy.projectEntries),
          "baselineEvidenceRef" in policy ? JSON.stringify(policy.baselineEvidenceRef) : null,
          policy.effectiveFrom,
          policy.publishedAt,
          policy.publishedByPrincipalId,
          policy.semanticHash,
        ],
      );
      if (heads.length === 1)
        await manager.query(
          "UPDATE workspace_queue_policy_heads SET current_revision_id=$3,resource_version=resource_version+1,updated_at=$4 WHERE workspace_id=$1 AND queue_policy_id=$2 AND resource_version=$5",
          [
            scope.workspaceId,
            policy.queuePolicyId,
            policyRevisionId,
            policy.publishedAt,
            expectedResourceVersion,
          ],
        );
    };
    if (executor) await run(executor);
    else await this.source.transaction("SERIALIZABLE", run);
  }

  async ensureNeutralViewHead(
    input: Readonly<{
      workspaceId: string;
      policyViewId: string;
      policyKey: string;
      recordedAt: string;
    }>,
    manager: EntityManager,
  ): Promise<void> {
    await manager.query(
      "INSERT INTO workspace_queue_policy_view_heads(policy_view_id,workspace_id,policy_key,current_revision_id,resource_version,reconciled_source_revision,created_at,updated_at) VALUES($1,$2,$3,NULL,0,0,$4,$4) ON CONFLICT(workspace_id,policy_key) DO NOTHING",
      [input.policyViewId, input.workspaceId, input.policyKey, input.recordedAt],
    );
  }

  async ensureProjectFacetHead(
    input: Readonly<{
      workspaceId: string;
      projectId: string;
      policyFacetId: string;
      policyKey: string;
      recordedAt: string;
    }>,
    manager: EntityManager,
  ): Promise<void> {
    await manager.query(
      "INSERT INTO project_queue_policy_facet_heads(policy_facet_id,workspace_id,project_id,policy_key,current_revision_id,resource_version,reconciled_source_revision,created_at,updated_at) VALUES($1,$2,$3,$4,NULL,0,0,$5,$5) ON CONFLICT(workspace_id,project_id,policy_key) DO NOTHING",
      [input.policyFacetId, input.workspaceId, input.projectId, input.policyKey, input.recordedAt],
    );
  }

  async appendNeutralView(
    scope: Extract<ResourceScope, { kind: "WORKSPACE" }>,
    view: QueuePolicyNeutralView,
    sourcePolicyRevisionId: string,
    sourcePolicyRevision: number,
    recordedAt: string,
    storageRevisionId: string,
    executor?: EntityManager,
  ): Promise<RevisionWriteOutcome> {
    return await this.appendSafeRevision(
      this.source,
      "workspace_queue_policy_view",
      scope.workspaceId,
      undefined,
      view.policyViewRef.id,
      view.policyViewRef.version,
      view.policyViewRef.semanticHash,
      view,
      sourcePolicyRevisionId,
      sourcePolicyRevision,
      recordedAt,
      storageRevisionId,
      executor,
    );
  }

  async appendProjectFacet(
    scope: Extract<ResourceScope, { kind: "PROJECT" }>,
    facet: ProjectQueuePolicyFacet,
    sourcePolicyRevisionId: string,
    sourcePolicyRevision: number,
    recordedAt: string,
    storageRevisionId: string,
    executor?: EntityManager,
  ): Promise<RevisionWriteOutcome> {
    this.assertEntityScope(scope, { workspaceId: facet.workspaceId, projectId: facet.projectId });
    return await this.appendSafeRevision(
      this.source,
      "project_queue_policy_facet",
      scope.workspaceId,
      scope.projectId,
      facet.policyFacetRef.id,
      facet.policyFacetRef.version,
      facet.policyFacetRef.semanticHash,
      facet,
      sourcePolicyRevisionId,
      sourcePolicyRevision,
      recordedAt,
      storageRevisionId,
      executor,
    );
  }

  async currentProjectFacet(
    scope: Extract<ResourceScope, { kind: "PROJECT" }>,
    policyKey: string,
  ): Promise<ProjectQueuePolicyFacet | undefined> {
    const rows = await this.projectRows<Row>(
      scope,
      "SELECT r.safe_body FROM project_queue_policy_facet_heads h JOIN project_queue_policy_facet_revisions r ON r.workspace_id=h.workspace_id AND r.project_id=h.project_id AND r.policy_facet_revision_id=h.current_revision_id WHERE h.workspace_id=$1 AND h.project_id=$2 AND h.policy_key=$3",
      [policyKey],
    );
    return rows[0]?.safe_body as ProjectQueuePolicyFacet | undefined;
  }

  private async appendSafeRevision(
    source: DataSource,
    prefix: "workspace_queue_policy_view" | "project_queue_policy_facet",
    workspaceId: string,
    projectId: string | undefined,
    id: string,
    revision: number,
    semanticHash: string,
    safeBody: unknown,
    sourcePolicyRevisionId: string,
    sourcePolicyRevision: number,
    recordedAt: string,
    storageRevisionId: string,
    executor?: EntityManager,
  ): Promise<RevisionWriteOutcome> {
    const run = async (manager: EntityManager) => {
      const projectClause = projectId === undefined ? "" : " AND project_id=$3";
      const parameters = projectId === undefined ? [workspaceId, id] : [workspaceId, id, projectId];
      const rows = (await manager.query(
        `SELECT current_revision_id FROM ${prefix}_heads WHERE workspace_id=$1 AND ${prefix === "workspace_queue_policy_view" ? "policy_view_id" : "policy_facet_id"}=$2${projectClause} FOR UPDATE`,
        parameters,
      )) as Row[];
      if (rows.length !== 1) throw new Error("QUEUE_POLICY_PUBLIC_HEAD_NOT_FOUND");
      const current = (await manager.query(
        `SELECT revision_number,semantic_hash FROM ${prefix}_revisions WHERE workspace_id=$1 AND ${prefix === "workspace_queue_policy_view" ? "policy_view_id" : "policy_facet_id"}=$2 ORDER BY revision_number DESC LIMIT 1`,
        [workspaceId, id],
      )) as Row[];
      if (current[0]?.semantic_hash === semanticHash) {
        return Object.freeze({
          outcome: "NO_OP_UNCHANGED" as const,
          revision: Number(current[0].revision_number),
          semanticHash,
        });
      }
      const revisionIdColumn =
        prefix === "workspace_queue_policy_view"
          ? "policy_view_revision_id"
          : "policy_facet_revision_id";
      const idColumn =
        prefix === "workspace_queue_policy_view" ? "policy_view_id" : "policy_facet_id";
      const projectColumns = projectId === undefined ? "" : ",project_id";
      const projectValue = projectId === undefined ? "" : ",$4";
      const offset = projectId === undefined ? 3 : 4;
      await manager.query(
        `INSERT INTO ${prefix}_revisions(${revisionIdColumn},${idColumn},workspace_id${projectColumns},revision_number,previous_revision_id,source_policy_revision_id,safe_body,semantic_hash,recorded_at) VALUES($1,$2,$3${projectValue},$${offset + 1},$${offset + 2},$${offset + 3},$${offset + 4},$${offset + 5},$${offset + 6})`,
        [
          storageRevisionId,
          id,
          workspaceId,
          ...(projectId === undefined ? [] : [projectId]),
          revision,
          rows[0]?.current_revision_id ?? null,
          sourcePolicyRevisionId,
          JSON.stringify(safeBody),
          semanticHash,
          recordedAt,
        ],
      );
      await manager.query(
        `UPDATE ${prefix}_heads SET current_revision_id=$3,resource_version=resource_version+1,reconciled_source_revision=$4,updated_at=$5 WHERE workspace_id=$1 AND ${idColumn}=$2`,
        [workspaceId, id, storageRevisionId, sourcePolicyRevision, recordedAt],
      );
      return Object.freeze({ outcome: "APPENDED" as const, revision, semanticHash });
    };
    return executor ? await run(executor) : await source.transaction("SERIALIZABLE", run);
  }
}
