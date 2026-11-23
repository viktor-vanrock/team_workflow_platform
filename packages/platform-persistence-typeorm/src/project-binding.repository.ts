import type { DataSource } from "typeorm";

import type {
  BindingFunctionalAcceptance,
  CapabilityModeAssessment,
  CapabilityProbeResult,
  ProjectScope,
} from "@awp/platform-core";

export class ProjectBindingRepository {
  constructor(private readonly source: Pick<DataSource, "query">) {}

  async functionalAcceptance(
    scope: ProjectScope,
    acceptanceId: string,
  ): Promise<BindingFunctionalAcceptance | undefined> {
    const rows = (await this.source.query(
      "SELECT semantic_body FROM binding_functional_acceptances WHERE workspace_id=$1 AND project_id=$2 AND acceptance_id=$3",
      [scope.workspaceId, scope.projectId, acceptanceId],
    )) as readonly { semantic_body: BindingFunctionalAcceptance }[];
    return rows[0]?.semantic_body;
  }

  async capabilityProbe(
    scope: ProjectScope,
    probeId: string,
  ): Promise<CapabilityProbeResult | undefined> {
    const rows = (await this.source.query(
      "SELECT semantic_body FROM capability_probe_results WHERE workspace_id=$1 AND project_id=$2 AND probe_id=$3",
      [scope.workspaceId, scope.projectId, probeId],
    )) as readonly { semantic_body: CapabilityProbeResult }[];
    return rows[0]?.semantic_body;
  }

  async modeAssessment(
    scope: ProjectScope,
    assessmentId: string,
  ): Promise<CapabilityModeAssessment | undefined> {
    const rows = (await this.source.query(
      "SELECT semantic_body FROM capability_mode_assessments WHERE workspace_id=$1 AND project_id=$2 AND assessment_id=$3",
      [scope.workspaceId, scope.projectId, assessmentId],
    )) as readonly { semantic_body: CapabilityModeAssessment }[];
    return rows[0]?.semantic_body;
  }

  async appendFunctionalAcceptance(value: BindingFunctionalAcceptance): Promise<void> {
    await this.source.query(
      `INSERT INTO binding_functional_acceptances(acceptance_id,version,workspace_id,project_id,binding_ref,validation_report_ref,qa_project_context_ref,accepted_resource_refs,checklist_ref,outcome,safe_issue_codes,accepted_by,accepted_at,semantic_body,content_hash)
       VALUES($1,1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        value.acceptanceId,
        value.workspaceId,
        value.projectId,
        JSON.stringify(value.bindingRef),
        JSON.stringify(value.validationReportRef),
        JSON.stringify(value.qaProjectContextRef),
        JSON.stringify(value.acceptedResourceRefs),
        JSON.stringify(value.checklistRef),
        value.outcome,
        JSON.stringify(value.safeIssueCodes),
        JSON.stringify(value.acceptedBy),
        value.acceptedAt,
        JSON.stringify(value),
        value.contentHash,
      ],
    );
  }

  async appendCapabilityProbe(value: CapabilityProbeResult): Promise<void> {
    await this.source.query(
      `INSERT INTO capability_probe_results(probe_id,version,workspace_id,project_id,binding_ref,profile_ref,connection_ref,mapping_ref,validation_report_ref,logical_role,capability_key,exact_contract_version,operation,environment_scope,status,safe_issue_codes,observed_at,valid_until,actor_kind,semantic_body,content_hash)
       VALUES($1,1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'SERVICE',$18,$19)`,
      [
        value.probeId,
        value.workspaceId,
        value.projectId,
        JSON.stringify(value.bindingRef),
        JSON.stringify(value.profileRef),
        JSON.stringify(value.connectionRef),
        value.mappingRef ? JSON.stringify(value.mappingRef) : null,
        JSON.stringify(value.validationReportRef),
        value.logicalRole,
        value.capabilityKey,
        value.exactContractVersion,
        value.operation,
        value.environmentScope,
        value.status,
        JSON.stringify(value.safeIssueCodes),
        value.observedAt,
        value.validUntil,
        JSON.stringify(value),
        value.contentHash,
      ],
    );
  }

  async appendModeAssessment(value: CapabilityModeAssessment): Promise<void> {
    await this.source.query(
      `INSERT INTO capability_mode_assessments(assessment_id,version,workspace_id,project_id,binding_ref,qa_project_context_ref,requirement_set_ref,probe_refs,manual_requirements,automation_requirements,pilot_messaging_requirement,derived_mode,reason_codes,evaluated_at,semantic_body,content_hash)
       VALUES($1,1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        value.assessmentId,
        value.workspaceId,
        value.projectId,
        JSON.stringify(value.bindingRef),
        JSON.stringify(value.qaProjectContextRef),
        JSON.stringify(value.requirementSetRef),
        JSON.stringify(value.probeRefs),
        value.manualRequirements,
        value.automationRequirements,
        value.pilotMessagingRequirement,
        value.derivedMode,
        JSON.stringify(value.reasonCodes),
        value.evaluatedAt,
        JSON.stringify(value),
        value.contentHash,
      ],
    );
  }
}
