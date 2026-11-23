import type { DataSource, EntityManager } from "typeorm";

import {
  type QaAuthorizationBasis,
  type QaAutomationAvailability,
  qaAutomationSuiteValidationCheckOrder,
  type QaHumanActor,
  type QaScope,
} from "@awp/competency-qa/node";
import { type ExactRevisionRef, freezePilotValue, pilotContentHash } from "@awp/platform-core";

import { integrationConfigurationHash } from "../onboarding/configuration-hash.ts";
import {
  decidePilotDegradation,
  type PilotCapabilityProjection,
  projectPilotCapability,
} from "./degradation-policy.ts";

const requirements = Object.freeze([
  {
    logicalRole: "SOURCE_CONTEXT",
    capabilityKey: "source-context.read",
    operations: ["merge-request.read", "commit.read", "build.read"],
  },
  {
    logicalRole: "TEST_EXECUTION",
    capabilityKey: "test-executor.trigger-status",
    operations: ["pipeline.trigger", "pipeline.read", "pipeline.lookup"],
  },
  {
    logicalRole: "ARTIFACT_SOURCE",
    capabilityKey: "artifact.ci-read",
    operations: ["artifact.metadata", "artifact.stream"],
  },
] as const);
type Role = (typeof requirements)[number]["logicalRole"];
type Classification = "PUBLIC" | "INTERNAL" | "RESTRICTED" | "CONFIDENTIAL";
const classifications: readonly string[] = ["PUBLIC", "INTERNAL", "RESTRICTED", "CONFIDENTIAL"];
export interface QaAutomationAvailabilityPins extends QaScope {
  readonly bindingRef: ExactRevisionRef;
  readonly contextRef: ExactRevisionRef;
  readonly suiteBindingId: string;
  readonly suiteRef: ExactRevisionRef;
  readonly suiteValidationRef: ExactRevisionRef;
  readonly bindingValidationRef: ExactRevisionRef;
  readonly acceptanceRef: ExactRevisionRef;
  readonly environmentRef: ExactRevisionRef;
  readonly evidencePolicyRef: ExactRevisionRef;
  readonly roles: readonly Readonly<{
    logicalRole: Role;
    profileRef: ExactRevisionRef;
    connectionRef: ExactRevisionRef;
  }>[];
  readonly maximumEvidenceAgeMs: number;
  /** Omission retains the published corporate NON_PROD pin format. */
  readonly environmentScope?: "LOCAL" | "NON_PROD";
}
export interface QaAutomationAvailabilityAuthority {
  authorize(): Promise<
    Readonly<{
      scope: QaScope;
      actor: QaHumanActor;
      basis: QaAuthorizationBasis;
      classificationCeiling: Classification;
    }>
  >;
}
type Document = Record<string, unknown>;
const invalid = () => new Error("QA_AUTOMATION_CONFIGURATION_INVALID");
const denied = () => new Error("QA_AUTOMATION_ACCESS_DENIED");
function requireFact(value: unknown): asserts value {
  if (!value) throw invalid();
}
function object(value: unknown): Document {
  requireFact(value && typeof value === "object" && !Array.isArray(value));
  return value as Document;
}
function array(value: unknown): readonly Document[] {
  requireFact(Array.isArray(value));
  return value.map(object);
}
function same(value: unknown, ref: ExactRevisionRef): boolean {
  const other = object(value);
  return (
    other.id === ref.id &&
    Number(other.version) === ref.version &&
    other.contentHash === ref.contentHash
  );
}
function validRef(value: ExactRevisionRef): void {
  requireFact(
    value &&
      typeof value.id === "string" &&
      /^[a-zA-Z0-9:._/-]{1,200}$/u.test(value.id) &&
      Number.isSafeInteger(value.version) &&
      value.version > 0 &&
      /^sha256:[a-f0-9]{64}$/u.test(value.contentHash),
  );
}
function signedBody(value: unknown, hash: unknown): Document {
  const full = object(value);
  const { contentHash, ...body } = full;
  requireFact(contentHash === hash && pilotContentHash(body) === hash);
  return full;
}
const configurationPin = (value: unknown, ref: ExactRevisionRef) => {
  const pin = object(value);
  return (
    pin.id === ref.id &&
    pin.version === ref.version &&
    (pin.contentHash === undefined || pin.contentHash === ref.contentHash)
  );
};
const connectorKey = (value: Document) => value.connectorKey ?? object(value.connectorRef).key;
const timestamp = (value: unknown) => (value instanceof Date ? value.toISOString() : String(value));

/** Canonical suite-validation pin format for the published corporate configuration. */
export function qaAutomationProfilePinSetHash(
  pins: Pick<
    QaAutomationAvailabilityPins,
    "workspaceId" | "projectId" | "bindingRef" | "roles" | "environmentScope"
  >,
): `sha256:${string}` {
  return pilotContentHash({
    schemaVersion: 1,
    workspaceId: pins.workspaceId,
    projectId: pins.projectId,
    bindingRef: pins.bindingRef,
    roles: requirements.map((requirement) => {
      const selected = pins.roles.filter((role) => role.logicalRole === requirement.logicalRole);
      requireFact(selected.length === 1);
      return {
        ...requirement,
        exactContractVersion: "1.0.0",
        environmentScope: pins.environmentScope ?? "NON_PROD",
        profileRef: selected[0]!.profileRef,
        connectionRef: selected[0]!.connectionRef,
      };
    }),
  }) as `sha256:${string}`;
}

/** Read projection only. Launch still requires current command authority, deployment readiness and the effect fence. */
export class PublishedQaAutomationAvailability {
  readonly #pins: readonly QaAutomationAvailabilityPins[];
  constructor(
    private readonly source: DataSource,
    pins: readonly QaAutomationAvailabilityPins[],
    private readonly deadlineMs = 1000,
  ) {
    try {
      requireFact(
        pins.length > 0 &&
          pins.length <= 100 &&
          new Set(pins.map((pin) => `${pin.workspaceId}:${pin.projectId}`)).size === pins.length,
      );
      requireFact(Number.isSafeInteger(deadlineMs) && deadlineMs >= 100 && deadlineMs <= 5000);
      for (const pin of pins) {
        requireFact(
          [pin.workspaceId, pin.projectId, pin.suiteBindingId].every((value) =>
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value),
          ),
        );
        [
          pin.bindingRef,
          pin.contextRef,
          pin.suiteRef,
          pin.suiteValidationRef,
          pin.bindingValidationRef,
          pin.acceptanceRef,
          pin.environmentRef,
          pin.evidencePolicyRef,
        ].forEach(validRef);
        requireFact(
          pin.roles.length === 3 &&
            Number.isSafeInteger(pin.maximumEvidenceAgeMs) &&
            pin.maximumEvidenceAgeMs >= 1000 &&
            pin.maximumEvidenceAgeMs <= 600_000,
        );
        for (const role of pin.roles) {
          validRef(role.profileRef);
          validRef(role.connectionRef);
        }
        requireFact(
          pin.environmentScope === undefined ||
            ["LOCAL", "NON_PROD"].includes(pin.environmentScope),
        );
        qaAutomationProfilePinSetHash(pin);
      }
      this.#pins = freezePilotValue(structuredClone(pins));
    } catch {
      throw invalid();
    }
  }

  async current(
    scope: QaScope,
    authority?: QaAutomationAvailabilityAuthority,
  ): Promise<QaAutomationAvailability> {
    const signal = AbortSignal.timeout(this.deadlineMs);
    const bounded = async <T>(work: Promise<T>): Promise<T> => {
      let abort!: () => void;
      try {
        if (signal.aborted) throw invalid();
        return await Promise.race([
          work,
          new Promise<never>((_resolve, reject) => {
            abort = () => reject(invalid());
            signal.addEventListener("abort", abort, { once: true });
          }),
        ]);
      } finally {
        if (abort) signal.removeEventListener("abort", abort);
      }
    };
    const authorize = async () => {
      try {
        const result = await bounded(authority ? authority.authorize() : Promise.reject(denied()));
        requireFact(
          result.scope.workspaceId === scope.workspaceId &&
            result.scope.projectId === scope.projectId &&
            result.actor.kind === "HUMAN" &&
            result.actor.principalId &&
            result.actor.issuer &&
            result.actor.subject &&
            result.basis.kind === "PROJECT" &&
            result.basis.membershipRef &&
            result.basis.entitlementRefs.length &&
            result.basis.roleAssignmentRefs.length &&
            classifications.includes(result.classificationCeiling),
        );
        return freezePilotValue(structuredClone(result));
      } catch {
        throw denied();
      }
    };
    const initial = await authorize();
    const pin = this.#pins.find(
      (value) => value.workspaceId === scope.workspaceId && value.projectId === scope.projectId,
    );
    if (!pin) throw denied();
    try {
      return await bounded(
        this.source.transaction("READ COMMITTED", async (manager) => {
          await manager.query(
            "SELECT set_config('statement_timeout',$1,true),set_config('lock_timeout',$1,true)",
            [`${this.deadlineMs}ms`],
          );
          const first = await readPublishedQaAutomationFacts(manager, pin, signal);
          const current = await authorize();
          if (pilotContentHash(current.actor) !== pilotContentHash(initial.actor)) throw denied();
          // Re-read after asynchronous authorization; revocation/head changes cannot reuse the first snapshot.
          const second = await readPublishedQaAutomationFacts(manager, pin, signal);
          requireFact(
            pilotContentHash(first) === pilotContentHash(second) && first.validUntil > Date.now(),
          );
          if (
            classifications.indexOf(current.classificationCeiling) <
            classifications.indexOf(first.classification)
          )
            throw denied();
          return freezePilotValue(first.projection);
        }),
      );
    } catch (error) {
      if (error instanceof Error && error.message === "QA_AUTOMATION_ACCESS_DENIED") throw error;
      return freezePilotValue({
        capabilityMode: "MANUAL_ONLY",
        configurationReasonCodes: ["CONFIGURATION_VALIDATION_STALE"],
        liveAvailability: "UNAVAILABLE",
        liveReasonCodes: ["AUTOMATION_CONFIGURATION_UNAVAILABLE"],
        launchPermitted: false,
      });
    }
  }
}

/** Transaction-scoped facts for both onboarding evaluation and the launch read projection.
 * The caller must supply verified pins and current authority; live facts alone never authorize launch. */
export async function readPublishedQaAutomationFacts(
  manager: EntityManager,
  pin: QaAutomationAvailabilityPins,
  signal: AbortSignal,
) {
  const environmentScope = pin.environmentScope ?? "NON_PROD";
  const query = async (sql: string, params: unknown[] = []) => {
    requireFact(!signal.aborted);
    return (await manager.query(sql, params)) as Document[];
  };
  const one = async (sql: string, params: unknown[]) => {
    const rows = await query(sql, params);
    requireFact(rows.length === 1);
    return rows[0]!;
  };
  const scope = [pin.workspaceId, pin.projectId];
  const project = await one(
    `SELECT p.state,p.classification_key,p.registration_status,w.state AS workspace_state,h.current_stage,h.current_capability_mode,h.current_operational_state,h.current_version,
      r.binding_ref,r.qa_project_context_ref FROM projects p JOIN workspaces w ON w.id=p.workspace_id
      JOIN project_onboarding_headers h ON h.workspace_id=p.workspace_id AND h.project_id=p.id
      JOIN project_onboarding_revisions r ON r.workspace_id=h.workspace_id AND r.project_id=h.project_id AND r.onboarding_id=h.onboarding_id AND r.version=h.current_version
      WHERE p.workspace_id=$1 AND p.id=$2`,
    scope,
  );
  requireFact(
    classifications.includes(String(project.classification_key)) &&
      same(project.binding_ref, pin.bindingRef) &&
      same(project.qa_project_context_ref, pin.contextRef),
  );
  const operationallyActive =
    project.state === "ACTIVE" &&
    project.workspace_state === "ACTIVE" &&
    project.registration_status === "ACTIVE" &&
    project.current_operational_state === "ACTIVE";
  const coreActive = operationallyActive && project.current_stage === "PILOT_ACTIVE";
  const currentContent = async (
    table: "connection" | "connector_profile" | "project_integration_binding",
    ref: ExactRevisionRef,
  ) => {
    const scoped = table === "project_integration_binding";
    const row = await one(
      `SELECT r.content FROM ${table}_headers h JOIN ${table}_revisions r ON r.workspace_id=h.workspace_id AND r.header_id=h.id AND r.version=h.current_published_version ${scoped ? "AND r.project_id=h.project_id" : ""}
        WHERE h.workspace_id=$1 AND h.id=$2 AND r.version=$3 AND r.content_hash=$4 AND r.status='PUBLISHED' ${scoped ? "AND h.project_id=$5" : ""}`,
      [pin.workspaceId, ref.id, ref.version, ref.contentHash, ...(scoped ? [pin.projectId] : [])],
    );
    requireFact(integrationConfigurationHash(table, object(row.content)) === ref.contentHash);
    return object(row.content);
  };
  const binding = await currentContent("project_integration_binding", pin.bindingRef);
  for (const requirement of requirements) {
    const role = pin.roles.find((value) => value.logicalRole === requirement.logicalRole)!;
    const entries = array(binding.entries).filter(
      (value) =>
        value.logicalRole === requirement.logicalRole &&
        value.capabilityKey === requirement.capabilityKey,
    );
    requireFact(entries.length === 1);
    const entry = entries[0]!;
    requireFact(
      entry.exactContractVersion === "1.0.0" &&
        entry.environmentScope === environmentScope &&
        configurationPin(entry.profileRef, role.profileRef),
    );
    const profile = await currentContent("connector_profile", role.profileRef);
    const connection = await currentContent("connection", role.connectionRef);
    requireFact(
      connectorKey(profile) === "connector-gitlab" &&
        connectorKey(connection) === connectorKey(profile) &&
        configurationPin(profile.connectionRef, role.connectionRef) &&
        !profile.mappingRef,
    );
    const capabilities = array(profile.capabilityConfigurations).filter(
      (value) =>
        value.capabilityKey === requirement.capabilityKey && value.exactContractVersion === "1.0.0",
    );
    requireFact(
      capabilities.length === 1 &&
        Array.isArray(capabilities[0]!.environmentScopes) &&
        capabilities[0]!.environmentScopes.includes(environmentScope),
    );
    requireFact(
      requirement.operations.every(
        (operation) =>
          array(capabilities[0]!.operations).filter((value) => value.operation === operation)
            .length === 1,
      ),
    );
  }
  const contextRow = await one(
    `SELECT r.semantic_body,r.content_hash FROM qa_project_context_headers_v2 h JOIN qa_project_context_revisions_v2 r ON r.workspace_id=h.workspace_id AND r.project_id=h.project_id AND r.context_id=h.context_id AND r.version=h.current_published_version
      WHERE h.workspace_id=$1 AND h.project_id=$2 AND h.context_id=$3 AND r.version=$4 AND r.content_hash=$5 AND r.state='PUBLISHED'`,
    [...scope, pin.contextRef.id, pin.contextRef.version, pin.contextRef.contentHash],
  );
  const context = signedBody(contextRow.semantic_body, contextRow.content_hash);
  requireFact(
    context.workspaceId === pin.workspaceId &&
      context.projectId === pin.projectId &&
      context.contextId === pin.contextRef.id &&
      context.version === pin.contextRef.version &&
      context.state === "PUBLISHED" &&
      array(context.environmentRefs).some((value) => same(value, pin.environmentRef)) &&
      same(context.evidencePolicyRef, pin.evidencePolicyRef),
  );
  requireFact(classifications.includes(String(context.maximumClassificationKey)));
  const classification =
    classifications[
      Math.max(
        classifications.indexOf(String(project.classification_key)),
        classifications.indexOf(String(context.maximumClassificationKey)),
      )
    ]!;
  const now = Date.now();
  let validUntil = Infinity;
  const fresh = (at: unknown, until?: unknown) => {
    const observed = Date.parse(timestamp(at));
    const end = Math.min(
      observed + pin.maximumEvidenceAgeMs,
      until === undefined ? Infinity : Date.parse(timestamp(until)),
    );
    requireFact(Number.isFinite(observed) && observed <= now && end > now);
    validUntil = Math.min(validUntil, end);
  };
  const validation = await one(
    `SELECT id,subject_version,outcome,content_hash,report,created_at FROM integration_validation_reports
      WHERE workspace_id=$1 AND project_id=$2 AND subject_kind='BINDING' AND subject_id=$3 AND subject_version=$4 ORDER BY created_at DESC,id DESC LIMIT 1`,
    [...scope, pin.bindingRef.id, pin.bindingRef.version],
  );
  requireFact(
    validation.id === pin.bindingValidationRef.id &&
      pin.bindingValidationRef.version === 1 &&
      validation.subject_version === pin.bindingRef.version &&
      validation.outcome === "VALID" &&
      validation.content_hash === pin.bindingRef.contentHash &&
      pilotContentHash(validation.report) === pin.bindingValidationRef.contentHash,
  );
  fresh(validation.created_at);
  const suiteFacts = await readPublishedQaAutomationSuite(manager, pin);
  validUntil = Math.min(validUntil, suiteFacts.validUntil);
  const acceptanceRow = await one(
    `SELECT semantic_body,content_hash,acceptance_id,accepted_at,outcome FROM binding_functional_acceptances WHERE workspace_id=$1 AND project_id=$2 AND binding_ref->>'id'=$3 ORDER BY accepted_at DESC,acceptance_id DESC LIMIT 1`,
    [...scope, pin.bindingRef.id],
  );
  const acceptance = signedBody(acceptanceRow.semantic_body, acceptanceRow.content_hash);
  requireFact(
    acceptanceRow.acceptance_id === pin.acceptanceRef.id &&
      acceptanceRow.content_hash === pin.acceptanceRef.contentHash &&
      acceptance.acceptanceId === pin.acceptanceRef.id &&
      acceptance.version === pin.acceptanceRef.version &&
      acceptance.workspaceId === pin.workspaceId &&
      acceptance.projectId === pin.projectId &&
      acceptance.outcome === "ACCEPTED" &&
      acceptanceRow.outcome === acceptance.outcome &&
      timestamp(acceptanceRow.accepted_at) === acceptance.acceptedAt &&
      Array.isArray(acceptance.safeIssueCodes) &&
      acceptance.safeIssueCodes.length === 0 &&
      object(acceptance.acceptedBy).kind === "HUMAN" &&
      object(acceptance.acceptedBy).principalId &&
      same(acceptance.bindingRef, pin.bindingRef) &&
      same(acceptance.validationReportRef, pin.bindingValidationRef) &&
      same(acceptance.qaProjectContextRef, pin.contextRef) &&
      [pin.suiteRef, pin.environmentRef, pin.evidencePolicyRef].every((ref) =>
        array(acceptance.acceptedResourceRefs).some((value) => same(value, ref)),
      ),
  );
  fresh(acceptance.acceptedAt);
  const probes = await query(
    `SELECT DISTINCT ON(logical_role,operation) * FROM capability_probe_results WHERE workspace_id=$1 AND project_id=$2 AND binding_ref->>'id'=$3
      AND logical_role=ANY($4::text[]) ORDER BY logical_role,operation,observed_at DESC,probe_id DESC`,
    [...scope, pin.bindingRef.id, requirements.map((value) => value.logicalRole)],
  );
  let liveAvailability: QaAutomationAvailability["liveAvailability"] = "AVAILABLE";
  const capabilityProjections: PilotCapabilityProjection[] = [];
  const evidenceRefs: ExactRevisionRef[] = [...suiteFacts.evidenceRefs];
  for (const requirement of requirements)
    for (const operation of requirement.operations) {
      const role = pin.roles.find((value) => value.logicalRole === requirement.logicalRole)!;
      const row = probes.find(
        (value) => value.logical_role === requirement.logicalRole && value.operation === operation,
      );
      if (!row) {
        liveAvailability = "UNAVAILABLE";
        capabilityProjections.push({
          status: "UNKNOWN",
          reasonCodes: ["CAPABILITY_PROBE_MISSING"],
        });
        continue;
      }
      const probe = signedBody(row.semantic_body, row.content_hash);
      requireFact(
        probe.probeId === row.probe_id &&
          probe.version === 1 &&
          probe.workspaceId === pin.workspaceId &&
          probe.projectId === pin.projectId &&
          probe.logicalRole === requirement.logicalRole &&
          probe.operation === operation &&
          probe.capabilityKey === requirement.capabilityKey &&
          probe.exactContractVersion === "1.0.0" &&
          probe.environmentScope === environmentScope &&
          probe.actorKind === "SERVICE" &&
          !probe.mappingRef &&
          same(probe.bindingRef, pin.bindingRef) &&
          same(probe.profileRef, role.profileRef) &&
          same(probe.connectionRef, role.connectionRef) &&
          same(probe.validationReportRef, pin.bindingValidationRef) &&
          row.status === probe.status &&
          timestamp(row.observed_at) === probe.observedAt &&
          timestamp(row.valid_until) === probe.validUntil,
      );
      fresh(probe.observedAt, probe.validUntil);
      const capability = projectPilotCapability({
        target: {
          workspaceId: pin.workspaceId,
          projectId: pin.projectId,
          bindingRef: pin.bindingRef,
          profileRef: role.profileRef,
          connectionRef: role.connectionRef,
          validationReportRef: pin.bindingValidationRef,
          logicalRole: requirement.logicalRole,
          capabilityKey: requirement.capabilityKey,
          exactContractVersion: "1.0.0",
          operation,
          environmentScope,
        },
        probe: row.semantic_body,
        storedHash: String(row.content_hash),
        now,
        maximumAgeMs: pin.maximumEvidenceAgeMs,
      });
      requireFact(capability.status !== "UNKNOWN");
      capabilityProjections.push(capability);
      evidenceRefs.push({
        id: String(probe.probeId),
        version: 1,
        contentHash: String(probe.contentHash) as `sha256:${string}`,
      });
      if (probe.status === "UNAVAILABLE") liveAvailability = "UNAVAILABLE";
      else if (probe.status === "DEGRADED") {
        if (liveAvailability === "AVAILABLE") liveAvailability = "DEGRADED";
      } else
        requireFact(
          probe.status === "AVAILABLE" &&
            Array.isArray(probe.safeIssueCodes) &&
            probe.safeIssueCodes.length === 0,
        );
    }
  const full = coreActive && project.current_capability_mode === "FULL_QA";
  const projection: QaAutomationAvailability = {
    capabilityMode: full ? "FULL_QA" : "MANUAL_ONLY",
    configurationReasonCodes: full ? [] : ["CONFIGURATION_VALIDATION_STALE"],
    liveAvailability,
    liveReasonCodes: liveAvailability === "AVAILABLE" ? [] : ["AUTOMATION_CAPABILITY_UNAVAILABLE"],
    launchPermitted: decidePilotDegradation({
      action: "AUTOMATION_START",
      authorized: full,
      now,
      dependencies: { GITLAB: capabilityProjections },
    }).allowed,
  };
  return {
    projection,
    classification,
    validUntil,
    version: project.current_version,
    evidenceRefs,
    operationallyActive,
  };
}

export type QaPublishedSuitePins = Pick<
  QaAutomationAvailabilityPins,
  | "workspaceId"
  | "projectId"
  | "bindingRef"
  | "roles"
  | "environmentScope"
  | "suiteBindingId"
  | "suiteRef"
  | "suiteValidationRef"
  | "environmentRef"
  | "evidencePolicyRef"
  | "maximumEvidenceAgeMs"
>;
/** Verifies the published Suite and its latest immutable report; no client-supplied readiness flags. */
export async function readPublishedQaAutomationSuite(
  manager: EntityManager,
  pin: QaPublishedSuitePins,
) {
  const scope = [pin.workspaceId, pin.projectId];
  const one = async (sql: string, params: unknown[]) => {
    const rows = (await manager.query(sql, params)) as Document[];
    requireFact(rows.length === 1);
    return rows[0]!;
  };
  const suite = await one(
    `SELECT v.*,h.suite_key FROM qa_automation_suite_bindings h JOIN qa_automation_suite_binding_versions v ON v.workspace_id=h.workspace_id AND v.project_id=h.project_id AND v.suite_binding_id=h.suite_binding_id AND v.suite_binding_version_id=h.current_published_version_id AND v.version=h.current_published_version
      WHERE h.workspace_id=$1 AND h.project_id=$2 AND h.suite_binding_id=$3 AND v.suite_binding_version_id=$4 AND v.version=$5 AND v.state='PUBLISHED'`,
    [...scope, pin.suiteBindingId, pin.suiteRef.id, pin.suiteRef.version],
  );
  requireFact(
    suite.content_hash === pin.suiteRef.contentHash &&
      pilotContentHash(suite.content) === pin.suiteRef.contentHash,
  );
  const content = object(suite.content);
  requireFact(
    Array.isArray(content.allowedEnvironmentRefs) &&
      content.allowedEnvironmentRefs.includes(
        `${pin.environmentRef.id}@${pin.environmentRef.version}`,
      ) &&
      same(content.artifactPolicyRef, pin.evidencePolicyRef),
  );
  const report = await one(
    `SELECT * FROM qa_automation_suite_validation_reports WHERE workspace_id=$1 AND project_id=$2 AND suite_binding_id=$3 AND suite_binding_version_id=$4 ORDER BY created_at DESC,report_id DESC LIMIT 1`,
    [...scope, pin.suiteBindingId, pin.suiteRef.id],
  );
  const reportBody = {
    id: report.report_id,
    workspaceId: pin.workspaceId,
    projectId: pin.projectId,
    suiteBindingRef: {
      id: report.suite_binding_version_id,
      version: report.suite_binding_version,
      contentHash: report.suite_content_hash,
    },
    status: report.status,
    coreBindingRef: report.core_binding_ref,
    profilePinSetHash: report.profile_pin_set_hash,
    discoverySnapshotRef: object(report.gitlab_discovery_snapshot_ref).ref,
    discoverySnapshotHash: report.gitlab_discovery_snapshot_hash,
    suiteProbeRef: object(report.suite_probe_ref).ref,
    suiteProbeHash: report.suite_probe_hash,
    checks: report.checks,
    issues: report.issues,
    validatedBy: report.validated_by,
    authorizationBasisHash: report.authorization_basis_hash,
    createdAt: timestamp(report.created_at),
  };
  requireFact(
    report.report_id === pin.suiteValidationRef.id &&
      pin.suiteValidationRef.version === 1 &&
      report.content_hash === pin.suiteValidationRef.contentHash &&
      pilotContentHash(reportBody) === report.content_hash &&
      suite.validation_report_id === report.report_id &&
      suite.validation_report_content_hash === report.content_hash &&
      report.status === "VALID" &&
      same(reportBody.suiteBindingRef, pin.suiteRef) &&
      same(report.core_binding_ref, pin.bindingRef) &&
      report.profile_pin_set_hash === qaAutomationProfilePinSetHash(pin) &&
      Array.isArray(report.issues) &&
      report.issues.length === 0,
  );
  const checks = array(report.checks);
  requireFact(
    checks.length === qaAutomationSuiteValidationCheckOrder.length &&
      checks.every(
        (check, index) =>
          check.key === qaAutomationSuiteValidationCheckOrder[index] && check.passed === true,
      ),
  );

  const at = Date.parse(timestamp(report.created_at)),
    validUntil = at + pin.maximumEvidenceAgeMs;
  requireFact(Number.isFinite(at) && at <= Date.now() && validUntil > Date.now());
  return { validUntil, evidenceRefs: [pin.suiteRef, pin.suiteValidationRef] };
}
