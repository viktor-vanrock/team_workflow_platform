import {
  qaAggregateSnapshotHash,
  type QaContentHash,
  QaDomainError,
  type QaScope,
} from "../domain/primitives.ts";
import type {
  QaAutomationSuiteHeader,
  QaAutomationSuiteValidationReport,
  QaAutomationSuiteVersion,
} from "../domain/suite-binding.ts";
import type { QaQueryExecutor } from "./repository-helpers.ts";

function rows<T>(value: unknown): readonly T[] {
  const raw = value as readonly unknown[];
  return (Array.isArray(raw[0]) ? raw[0] : raw) as readonly T[];
}

function json<T>(value: unknown): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

export interface QaAutomationSuiteHeaderRecord {
  readonly id: string;
  readonly suiteKey: string;
  readonly currentPublishedVersion: number | null;
  readonly currentPublishedVersionId: string | null;
  readonly resourceVersion: number;
  readonly createdBy: QaAutomationSuiteHeader["createdBy"];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface QaAutomationSuiteVersionRecord {
  readonly id: string;
  readonly suiteBindingId: string;
  readonly suiteKey: string;
  readonly version: number;
  readonly state: "DRAFT" | "VALIDATED" | "PUBLISHED" | "RETIRED";
  readonly content: QaAutomationSuiteVersion["content"];
  readonly contentHash: QaContentHash;
  readonly validationReportId: string | null;
  readonly validationReportContentHash: QaContentHash | null;
  readonly createdBy: QaAutomationSuiteVersion["createdBy"];
  readonly createdAt: string;
  readonly publishedAt: string | null;
  readonly retiredAt: string | null;
}

export interface QaAutomationSuiteValidationReportRecord {
  readonly id: string;
  readonly suiteBindingId: string;
  readonly suiteBindingVersionId: string;
  readonly suiteBindingVersion: number;
  readonly suiteContentHash: QaContentHash;
  readonly status: "VALID" | "INVALID";
  readonly coreBindingRef: unknown;
  readonly profilePinSetHash: QaContentHash;
  readonly discoverySnapshotRef: unknown;
  readonly discoverySnapshotHash: QaContentHash;
  readonly suiteProbeRef: unknown;
  readonly suiteProbeHash: QaContentHash;
  readonly checks: readonly unknown[];
  readonly issues: readonly unknown[];
  readonly validatedBy: QaAutomationSuiteValidationReport["validatedBy"];
  readonly authorizationBasisHash: QaContentHash;
  readonly contentHash: QaContentHash;
  readonly createdAt: string;
}

export interface QaAutomationConfigurationPinRecord {
  readonly id: string;
  readonly sessionId: string;
  readonly ordinal: number;
  readonly logicalRole: "SOURCE_CONTEXT" | "TEST_EXECUTION" | "ARTIFACT_SOURCE";
  readonly capabilityKey:
    "source-context.read" | "test-executor.trigger-status" | "artifact.ci-read";
  readonly exactContractVersion: "1.0.0";
  readonly profileId: string;
  readonly profileVersion: number;
  readonly profileContentHash: QaContentHash;
  readonly connectionId: string;
  readonly connectionVersion: number;
  readonly connectionContentHash: QaContentHash;
  readonly pinContentHash: QaContentHash;
}

export class TypeOrmAutomationSuiteRepository {
  constructor(private readonly source: QaQueryExecutor) {}

  async insertHeader(header: QaAutomationSuiteHeader): Promise<void> {
    const inserted = rows<unknown>(
      await this.source.query(
        `
INSERT INTO qa_automation_suite_bindings(
  suite_binding_id,workspace_id,project_id,suite_key,current_published_version,
  current_published_version_id,resource_version,created_by,created_at,updated_at
) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
RETURNING suite_binding_id`,
        [
          header.id,
          header.workspaceId,
          header.projectId,
          header.suiteKey,
          header.currentPublishedVersion,
          header.currentPublishedVersionId,
          header.resourceVersion,
          JSON.stringify(header.createdBy),
          header.createdAt,
          header.updatedAt,
        ],
      ),
    );
    if (inserted.length !== 1) throw new QaDomainError("QA_AUTOMATION_SUITE_HEADER_INSERT_FAILED");
  }

  async insertVersion(version: QaAutomationSuiteVersion): Promise<void> {
    const content = version.content;
    const inserted = rows<unknown>(
      await this.source.query(
        `
INSERT INTO qa_automation_suite_binding_versions(
  suite_binding_version_id,workspace_id,project_id,suite_binding_id,version,state,owner_principal_id,
  suite_definition_ref,suite_definition_hash,logical_pipeline_key,source_ref_policy_ref,result_job_key,
  logical_execution_contract_hash,accepted_target_types,environment_policy_ref,allowed_parameter_schema_ref,
  allowed_parameter_schema_digest,result_schema_ref,result_schema_digest,result_source_contract,
  artifact_policy_ref,artifact_policy_content_hash,retry_policy_ref,retry_policy_content_hash,
  quarantine_policy_ref,quarantine_policy_content_hash,required_capability_set_hash,validation_report_id,
  validation_report_content_hash,content,content_hash,created_by,created_at,published_at,retired_at
) VALUES(
  $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,
  $27,$28,$29,$30,$31,$32,$33,$34,$35
)
RETURNING suite_binding_version_id`,
        [
          version.id,
          version.workspaceId,
          version.projectId,
          version.suiteBindingId,
          version.version,
          version.state,
          content.ownerPrincipalId,
          JSON.stringify(content.suiteDefinitionRef),
          content.suiteDefinitionRef.contentHash,
          content.logicalExecutionContract.pipelineKey,
          JSON.stringify({ ref: content.logicalExecutionContract.sourceRefPolicyRef }),
          content.logicalExecutionContract.resultJobKey,
          content.logicalExecutionContract.contractHash,
          JSON.stringify(content.allowedTargetTypes),
          JSON.stringify({ allowedEnvironmentRefs: content.allowedEnvironmentRefs }),
          JSON.stringify(content.parameterSchemaRef),
          content.parameterSchemaRef.contentHash,
          JSON.stringify(content.resultSchemaRef),
          content.resultSchemaRef.contentHash,
          JSON.stringify({ resultJobKey: content.logicalExecutionContract.resultJobKey }),
          JSON.stringify(content.artifactPolicyRef),
          content.artifactPolicyRef.contentHash,
          JSON.stringify(content.retryPolicyRef),
          content.retryPolicyRef.contentHash,
          JSON.stringify(content.quarantinePolicyRef),
          content.quarantinePolicyRef.contentHash,
          qaAggregateSnapshotHash(content.capabilityRequirements as never),
          version.validationReportId,
          version.validationReportContentHash,
          JSON.stringify(content),
          version.contentHash,
          JSON.stringify(version.createdBy),
          version.createdAt,
          version.publishedAt,
          version.retiredAt,
        ],
      ),
    );
    if (inserted.length !== 1) throw new QaDomainError("QA_AUTOMATION_SUITE_VERSION_INSERT_FAILED");
  }

  async persistValidation(
    input: Readonly<{
      scope: QaScope;
      previousVersion: QaAutomationSuiteVersion;
      nextVersion: QaAutomationSuiteVersion;
      report: QaAutomationSuiteValidationReport;
    }>,
  ): Promise<void> {
    const { scope, previousVersion, nextVersion, report } = input;
    if (
      previousVersion.id !== nextVersion.id ||
      previousVersion.state !== "DRAFT" ||
      previousVersion.workspaceId !== scope.workspaceId ||
      previousVersion.projectId !== scope.projectId ||
      report.workspaceId !== scope.workspaceId ||
      report.projectId !== scope.projectId
    )
      throw new QaDomainError("QA_AUTOMATION_SUITE_VALIDATION_SCOPE_MISMATCH");
    const inserted = rows<unknown>(
      await this.source.query(
        `
INSERT INTO qa_automation_suite_validation_reports(
  report_id,workspace_id,project_id,suite_binding_id,suite_binding_version_id,suite_binding_version,
  suite_content_hash,status,core_binding_ref,profile_pin_set_hash,gitlab_discovery_snapshot_ref,
  gitlab_discovery_snapshot_hash,suite_probe_ref,suite_probe_hash,checks,issues,validated_by,
  authorization_basis_hash,created_at,content_hash
) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
RETURNING report_id`,
        [
          report.id,
          report.workspaceId,
          report.projectId,
          nextVersion.suiteBindingId,
          nextVersion.id,
          nextVersion.version,
          nextVersion.contentHash,
          report.status,
          JSON.stringify(report.coreBindingRef),
          report.profilePinSetHash,
          JSON.stringify({ ref: report.discoverySnapshotRef }),
          report.discoverySnapshotHash,
          JSON.stringify({ ref: report.suiteProbeRef }),
          report.suiteProbeHash,
          JSON.stringify(report.checks),
          JSON.stringify(report.issues),
          JSON.stringify(report.validatedBy),
          report.authorizationBasisHash,
          report.createdAt,
          report.contentHash,
        ],
      ),
    );
    if (inserted.length !== 1) throw new QaDomainError("QA_AUTOMATION_SUITE_REPORT_INSERT_FAILED");
    if (report.status === "INVALID") {
      if (nextVersion.state !== "DRAFT")
        throw new QaDomainError("QA_AUTOMATION_SUITE_INVALID_REPORT_STATE_MISMATCH");
      return;
    }
    if (
      nextVersion.state !== "VALIDATED" ||
      nextVersion.validationReportId !== report.id ||
      nextVersion.validationReportContentHash !== report.contentHash
    ) {
      throw new QaDomainError("QA_AUTOMATION_SUITE_VALID_REPORT_STATE_MISMATCH");
    }
    const updated = rows<unknown>(
      await this.source.query(
        `
UPDATE qa_automation_suite_binding_versions version_row
SET state='VALIDATED',validation_report_id=$1,validation_report_content_hash=$2
WHERE version_row.workspace_id=$3 AND version_row.project_id=$4
  AND version_row.suite_binding_version_id=$5 AND version_row.state='DRAFT'
  AND version_row.content_hash=$6
  AND EXISTS(
    SELECT 1 FROM qa_automation_suite_validation_reports report
    WHERE report.report_id=$1 AND report.workspace_id=$3 AND report.project_id=$4
      AND report.suite_binding_version_id=version_row.suite_binding_version_id
      AND report.suite_binding_version=version_row.version
      AND report.suite_content_hash=version_row.content_hash
      AND report.content_hash=$2 AND report.status='VALID'
  )
RETURNING version_row.suite_binding_version_id`,
        [
          report.id,
          report.contentHash,
          scope.workspaceId,
          scope.projectId,
          previousVersion.id,
          previousVersion.contentHash,
        ],
      ),
    );
    if (updated.length !== 1) throw new QaDomainError("QA_AUTOMATION_SUITE_VALIDATION_STALE");
  }

  /** Must be invoked with a transaction-scoped executor. */
  async persistPublication(
    input: Readonly<{
      scope: QaScope;
      previousHeader: QaAutomationSuiteHeader;
      nextHeader: QaAutomationSuiteHeader;
      previousVersions: readonly QaAutomationSuiteVersion[];
      nextVersions: readonly QaAutomationSuiteVersion[];
    }>,
  ): Promise<void> {
    const { scope, previousHeader, nextHeader } = input;
    if (
      previousHeader.workspaceId !== scope.workspaceId ||
      previousHeader.projectId !== scope.projectId ||
      nextHeader.id !== previousHeader.id ||
      nextHeader.resourceVersion !== previousHeader.resourceVersion + 1 ||
      nextHeader.currentPublishedVersionId === null ||
      nextHeader.currentPublishedVersion === null
    )
      throw new QaDomainError("QA_AUTOMATION_SUITE_PUBLICATION_INVALID");
    const selectedBefore = input.previousVersions.find(
      ({ id }) => id === nextHeader.currentPublishedVersionId,
    );
    const selectedAfter = input.nextVersions.find(
      ({ id }) => id === nextHeader.currentPublishedVersionId,
    );
    if (
      !selectedBefore ||
      !selectedAfter ||
      selectedBefore.state !== "VALIDATED" ||
      selectedAfter.state !== "PUBLISHED" ||
      selectedBefore.contentHash !== selectedAfter.contentHash
    ) {
      throw new QaDomainError("QA_AUTOMATION_SUITE_PUBLICATION_VERSION_INVALID");
    }
    const published = rows<unknown>(
      await this.source.query(
        `
UPDATE qa_automation_suite_binding_versions version_row
SET state='PUBLISHED',published_at=$1
WHERE version_row.workspace_id=$2 AND version_row.project_id=$3
  AND version_row.suite_binding_id=$4 AND version_row.suite_binding_version_id=$5
  AND version_row.version=$6 AND version_row.content_hash=$7 AND version_row.state='VALIDATED'
  AND EXISTS(
    SELECT 1 FROM qa_automation_suite_validation_reports report
    WHERE report.report_id=version_row.validation_report_id
      AND report.workspace_id=version_row.workspace_id AND report.project_id=version_row.project_id
      AND report.suite_binding_version_id=version_row.suite_binding_version_id
      AND report.suite_binding_version=version_row.version
      AND report.suite_content_hash=version_row.content_hash
      AND report.content_hash=version_row.validation_report_content_hash AND report.status='VALID'
  )
RETURNING version_row.suite_binding_version_id`,
        [
          selectedAfter.publishedAt,
          scope.workspaceId,
          scope.projectId,
          previousHeader.id,
          selectedBefore.id,
          selectedBefore.version,
          selectedBefore.contentHash,
        ],
      ),
    );
    if (published.length !== 1)
      throw new QaDomainError("QA_AUTOMATION_SUITE_PUBLICATION_EVIDENCE_STALE");

    const previouslyPublished = input.previousVersions.find(({ state }) => state === "PUBLISHED");
    if (previouslyPublished && previouslyPublished.id !== selectedBefore.id) {
      const retiredAfter = input.nextVersions.find(({ id }) => id === previouslyPublished.id);
      if (retiredAfter?.state !== "RETIRED" || retiredAfter.retiredAt === null)
        throw new QaDomainError("QA_AUTOMATION_SUITE_RETIREMENT_INVALID");
      const retired = rows<unknown>(
        await this.source.query(
          `
UPDATE qa_automation_suite_binding_versions
SET state='RETIRED',retired_at=$1
WHERE workspace_id=$2 AND project_id=$3 AND suite_binding_id=$4
  AND suite_binding_version_id=$5 AND state='PUBLISHED'
RETURNING suite_binding_version_id`,
          [
            retiredAfter.retiredAt,
            scope.workspaceId,
            scope.projectId,
            previousHeader.id,
            previouslyPublished.id,
          ],
        ),
      );
      if (retired.length !== 1) throw new QaDomainError("QA_AUTOMATION_SUITE_RETIREMENT_STALE");
    }
    const header = rows<unknown>(
      await this.source.query(
        `
UPDATE qa_automation_suite_bindings
SET current_published_version=$1,current_published_version_id=$2,
    resource_version=$3,updated_at=$4
WHERE workspace_id=$5 AND project_id=$6 AND suite_binding_id=$7 AND resource_version=$8
RETURNING suite_binding_id`,
        [
          nextHeader.currentPublishedVersion,
          nextHeader.currentPublishedVersionId,
          nextHeader.resourceVersion,
          nextHeader.updatedAt,
          scope.workspaceId,
          scope.projectId,
          previousHeader.id,
          previousHeader.resourceVersion,
        ],
      ),
    );
    if (header.length !== 1) throw new QaDomainError("QA_AUTOMATION_SUITE_HEADER_STALE");
  }

  async header(
    scope: QaScope,
    suiteBindingId: string,
  ): Promise<QaAutomationSuiteHeaderRecord | undefined> {
    const found = rows<Record<string, unknown>>(
      await this.source.query(
        `
SELECT suite_binding_id AS id,suite_key AS "suiteKey",
       current_published_version AS "currentPublishedVersion",
       current_published_version_id AS "currentPublishedVersionId",
       resource_version AS "resourceVersion",created_by AS "createdBy",
       created_at AS "createdAt",updated_at AS "updatedAt"
FROM qa_automation_suite_bindings
WHERE workspace_id=$1 AND project_id=$2 AND suite_binding_id=$3`,
        [scope.workspaceId, scope.projectId, suiteBindingId],
      ),
    );
    return found[0] === undefined ? undefined : this.#header(found[0]);
  }

  async headers(scope: QaScope): Promise<readonly QaAutomationSuiteHeaderRecord[]> {
    const found = rows<Record<string, unknown>>(
      await this.source.query(
        `
SELECT suite_binding_id AS id,suite_key AS "suiteKey",
       current_published_version AS "currentPublishedVersion",
       current_published_version_id AS "currentPublishedVersionId",
       resource_version AS "resourceVersion",created_by AS "createdBy",
       created_at AS "createdAt",updated_at AS "updatedAt"
FROM qa_automation_suite_bindings
WHERE workspace_id=$1 AND project_id=$2
ORDER BY suite_key,suite_binding_id`,
        [scope.workspaceId, scope.projectId],
      ),
    );
    return Object.freeze(found.map((row) => this.#header(row)));
  }

  async headerByKey(
    scope: QaScope,
    suiteKey: string,
  ): Promise<QaAutomationSuiteHeaderRecord | undefined> {
    const found = rows<Record<string, unknown>>(
      await this.source.query(
        `
SELECT suite_binding_id AS id,suite_key AS "suiteKey",
       current_published_version AS "currentPublishedVersion",
       current_published_version_id AS "currentPublishedVersionId",
       resource_version AS "resourceVersion",created_by AS "createdBy",
       created_at AS "createdAt",updated_at AS "updatedAt"
FROM qa_automation_suite_bindings
WHERE workspace_id=$1 AND project_id=$2 AND suite_key=$3`,
        [scope.workspaceId, scope.projectId, suiteKey],
      ),
    );
    return found[0] === undefined ? undefined : this.#header(found[0]);
  }

  async versions(
    scope: QaScope,
    suiteBindingId: string,
  ): Promise<readonly QaAutomationSuiteVersionRecord[]> {
    const found = rows<Record<string, unknown>>(
      await this.source.query(
        `
SELECT version_row.suite_binding_version_id AS id,
       version_row.suite_binding_id AS "suiteBindingId",header.suite_key AS "suiteKey",
       version_row.version,version_row.state,version_row.content,
       version_row.content_hash AS "contentHash",
       version_row.validation_report_id AS "validationReportId",
       version_row.validation_report_content_hash AS "validationReportContentHash",
       version_row.created_by AS "createdBy",
       version_row.created_at AS "createdAt",version_row.published_at AS "publishedAt",
       version_row.retired_at AS "retiredAt"
FROM qa_automation_suite_binding_versions version_row
JOIN qa_automation_suite_bindings header ON header.suite_binding_id=version_row.suite_binding_id
WHERE version_row.workspace_id=$1 AND version_row.project_id=$2 AND version_row.suite_binding_id=$3
ORDER BY version_row.version`,
        [scope.workspaceId, scope.projectId, suiteBindingId],
      ),
    );
    return Object.freeze(
      found.map((row) =>
        Object.freeze({
          id: String(row.id),
          suiteBindingId: String(row.suiteBindingId),
          suiteKey: String(row.suiteKey),
          version: Number(row.version),
          state: String(row.state) as QaAutomationSuiteVersionRecord["state"],
          content: json<QaAutomationSuiteVersion["content"]>(row.content),
          contentHash: String(row.contentHash) as QaContentHash,
          validationReportId:
            row.validationReportId === null ? null : String(row.validationReportId),
          validationReportContentHash:
            row.validationReportContentHash === null
              ? null
              : (String(row.validationReportContentHash) as QaContentHash),
          createdBy: json<QaAutomationSuiteVersion["createdBy"]>(row.createdBy),
          createdAt: new Date(String(row.createdAt)).toISOString(),
          publishedAt:
            row.publishedAt === null ? null : new Date(String(row.publishedAt)).toISOString(),
          retiredAt: row.retiredAt === null ? null : new Date(String(row.retiredAt)).toISOString(),
        }),
      ),
    );
  }

  async validationReports(
    scope: QaScope,
    suiteBindingVersionId: string,
  ): Promise<readonly QaAutomationSuiteValidationReportRecord[]> {
    const found = rows<Record<string, unknown>>(
      await this.source.query(
        `
SELECT report_id AS id,suite_binding_id AS "suiteBindingId",
       suite_binding_version_id AS "suiteBindingVersionId",
       suite_binding_version AS "suiteBindingVersion",suite_content_hash AS "suiteContentHash",
       status,core_binding_ref AS "coreBindingRef",profile_pin_set_hash AS "profilePinSetHash",
       gitlab_discovery_snapshot_ref AS "discoverySnapshotRef",
       gitlab_discovery_snapshot_hash AS "discoverySnapshotHash",
       suite_probe_ref AS "suiteProbeRef",suite_probe_hash AS "suiteProbeHash",
       checks,issues,validated_by AS "validatedBy",authorization_basis_hash AS "authorizationBasisHash",
       content_hash AS "contentHash",created_at AS "createdAt"
FROM qa_automation_suite_validation_reports
WHERE workspace_id=$1 AND project_id=$2 AND suite_binding_version_id=$3
ORDER BY created_at,report_id`,
        [scope.workspaceId, scope.projectId, suiteBindingVersionId],
      ),
    );
    return Object.freeze(
      found.map((row) =>
        Object.freeze({
          id: String(row.id),
          suiteBindingId: String(row.suiteBindingId),
          suiteBindingVersionId: String(row.suiteBindingVersionId),
          suiteBindingVersion: Number(row.suiteBindingVersion),
          suiteContentHash: String(row.suiteContentHash) as QaContentHash,
          status: String(row.status) as QaAutomationSuiteValidationReportRecord["status"],
          coreBindingRef: json(row.coreBindingRef),
          profilePinSetHash: String(row.profilePinSetHash) as QaContentHash,
          discoverySnapshotRef: json(row.discoverySnapshotRef),
          discoverySnapshotHash: String(row.discoverySnapshotHash) as QaContentHash,
          suiteProbeRef: json(row.suiteProbeRef),
          suiteProbeHash: String(row.suiteProbeHash) as QaContentHash,
          checks: Object.freeze(json<unknown[]>(row.checks)),
          issues: Object.freeze(json<unknown[]>(row.issues)),
          validatedBy: json<QaAutomationSuiteValidationReport["validatedBy"]>(row.validatedBy),
          authorizationBasisHash: String(row.authorizationBasisHash) as QaContentHash,
          contentHash: String(row.contentHash) as QaContentHash,
          createdAt: new Date(String(row.createdAt)).toISOString(),
        }),
      ),
    );
  }

  async sessionPins(
    scope: QaScope,
    sessionId: string,
  ): Promise<readonly QaAutomationConfigurationPinRecord[]> {
    const found = rows<Record<string, unknown>>(
      await this.source.query(
        `
SELECT pin_id AS id,session_id AS "sessionId",ordinal,logical_role AS "logicalRole",
       capability_key AS "capabilityKey",exact_contract_version AS "exactContractVersion",
       profile_id AS "profileId",profile_version AS "profileVersion",profile_content_hash AS "profileContentHash",
       connection_id AS "connectionId",connection_version AS "connectionVersion",connection_content_hash AS "connectionContentHash",
       pin_content_hash AS "pinContentHash"
FROM qa_automation_session_configuration_pins
WHERE workspace_id=$1 AND project_id=$2 AND session_id=$3 ORDER BY ordinal`,
        [scope.workspaceId, scope.projectId, sessionId],
      ),
    );
    return Object.freeze(
      found.map((row) =>
        Object.freeze({
          id: String(row.id),
          sessionId: String(row.sessionId),
          ordinal: Number(row.ordinal),
          logicalRole: String(row.logicalRole) as QaAutomationConfigurationPinRecord["logicalRole"],
          capabilityKey: String(
            row.capabilityKey,
          ) as QaAutomationConfigurationPinRecord["capabilityKey"],
          exactContractVersion: String(row.exactContractVersion) as "1.0.0",
          profileId: String(row.profileId),
          profileVersion: Number(row.profileVersion),
          profileContentHash: String(row.profileContentHash) as QaContentHash,
          connectionId: String(row.connectionId),
          connectionVersion: Number(row.connectionVersion),
          connectionContentHash: String(row.connectionContentHash) as QaContentHash,
          pinContentHash: String(row.pinContentHash) as QaContentHash,
        }),
      ),
    );
  }

  #header(row: Record<string, unknown>): QaAutomationSuiteHeaderRecord {
    return Object.freeze({
      id: String(row.id),
      suiteKey: String(row.suiteKey),
      currentPublishedVersion:
        row.currentPublishedVersion === null ? null : Number(row.currentPublishedVersion),
      currentPublishedVersionId:
        row.currentPublishedVersionId === null ? null : String(row.currentPublishedVersionId),
      resourceVersion: Number(row.resourceVersion),
      createdBy: json<QaAutomationSuiteHeader["createdBy"]>(row.createdBy),
      createdAt: new Date(String(row.createdAt)).toISOString(),
      updatedAt: new Date(String(row.updatedAt)).toISOString(),
    });
  }
}
