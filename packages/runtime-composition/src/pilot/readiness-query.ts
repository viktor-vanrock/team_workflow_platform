import type { DataSource, EntityManager } from "typeorm";

import { resolveQaCapabilityRequirementSet } from "@awp/competency-qa/node";
import {
  assertExactRevisionRef,
  type CapabilityProbeResult,
  defaultClassificationCatalog,
  type ExactRevisionRef,
  freezePilotValue,
  pilotContentHash,
  type PilotGateKind,
  type PilotOnboardingGateResult,
  type ProjectScope,
  samePilotRef,
} from "@awp/platform-core";

import { projectPilotCapability } from "./degradation-policy.ts";
import type { PilotGateEvidencePort } from "./gate-evidence.ts";
import { currentProjectCapabilityPlans } from "./maintenance-probes.ts";

export interface PilotReadAuthority extends ProjectScope {
  authorize(
    permission: "pilot.health.read" | "pilot.readiness.read",
  ): Promise<Readonly<{ classificationCeiling: string }>>;
}
export interface PilotInputReadiness extends ProjectScope {
  readonly packageRef: ExactRevisionRef;
  readonly observedAt: string;
  readonly validUntil: string;
  readonly entries: readonly Readonly<{
    id: string;
    ownerRole: string;
    status: "PASS" | "FAIL" | "BLOCKED_INPUT";
    reasonCodes: readonly string[];
  }>[];
}
export interface PilotInputReadinessPort {
  /** Resolves the exact current reviewed input package; no endpoint or secret values are returned. */
  current(
    manager: EntityManager,
    scope: ProjectScope,
    ref: ExactRevisionRef,
  ): Promise<PilotInputReadiness>;
}
type Row = Record<string, unknown>;
const safeCodes = (value: unknown) =>
  Array.isArray(value) &&
  value.length <= 20 &&
  value.every((code) => typeof code === "string" && /^[A-Z][A-Z0-9_]{0,95}$/u.test(code))
    ? (value as string[])
    : ["DIAGNOSTICS_UNAVAILABLE"];
const allGateKinds: readonly PilotGateKind[] = ["L0", "C1", "N2", "P3"];
const inputIds = Array.from({ length: 12 }, (_, i) => `IN-${String(i + 1).padStart(2, "0")}`);
const scopeMatches = (row: { workspaceId?: unknown; projectId?: unknown }, scope: ProjectScope) =>
  row.workspaceId === scope.workspaceId && row.projectId === scope.projectId;

/** Read-only projections of Core authority; missing or stale facts cannot advertise readiness. */
export class PilotReadinessQuery {
  constructor(
    private readonly source: DataSource,
    private readonly inputs: PilotInputReadinessPort,
    private readonly gateEvidence: PilotGateEvidencePort,
    private readonly clock = () => Date.now(),
  ) {}
  async health(authority: PilotReadAuthority) {
    await this.authorize(authority, "pilot.health.read");
    return this.source.transaction("REPEATABLE READ", async (manager) => {
      const scope = { workspaceId: authority.workspaceId, projectId: authority.projectId };
      const [project] = (await manager.query(
        "SELECT p.state,h.current_operational_state,h.current_stage,h.current_capability_mode FROM projects p LEFT JOIN project_onboarding_headers h ON h.workspace_id=p.workspace_id AND h.project_id=p.id WHERE p.workspace_id=$1 AND p.id=$2",
        [scope.workspaceId, scope.projectId],
      )) as Row[];
      if (!project) throw new Error("PILOT_RESOURCE_UNAVAILABLE");
      const plans = await currentProjectCapabilityPlans(manager, scope);
      const capabilities: Array<
        Readonly<{
          bindingRef: ExactRevisionRef;
          requirementKey: string;
          logicalRole: string;
          capabilityKey: string;
          operation: string;
          status: "AVAILABLE" | "DEGRADED" | "UNAVAILABLE" | "UNKNOWN";
          reasonCodes: readonly string[];
          probeRef?: ExactRevisionRef;
          observedAt?: string;
          validUntil?: string;
        }>
      > = [];
      for (const plan of plans)
        for (const requirement of resolveQaCapabilityRequirementSet(plan.requirementSetRef)
          ?.requirements ?? [])
          for (const operation of requirement.operations) {
            const base = {
              bindingRef: plan.bindingRef,
              requirementKey: requirement.requirementKey,
              logicalRole: requirement.logicalRole,
              capabilityKey: requirement.capabilityKey,
              operation,
            };
            const target = plan.targets.find(
              (value) =>
                value.logicalRole === requirement.logicalRole &&
                value.capabilityKey === requirement.capabilityKey &&
                value.operation === operation,
            );
            if (!target) {
              capabilities.push({
                ...base,
                status: "UNKNOWN",
                reasonCodes: ["CAPABILITY_CONFIGURATION_UNAVAILABLE"],
              });
              continue;
            }
            const [row] = (await manager.query(
              `SELECT semantic_body,content_hash FROM capability_probe_results WHERE workspace_id=$1 AND project_id=$2
          AND binding_ref=$3 AND profile_ref=$4 AND connection_ref=$5 AND mapping_ref IS NOT DISTINCT FROM $6::jsonb AND validation_report_ref=$7
          AND logical_role=$8 AND capability_key=$9 AND exact_contract_version=$10 AND operation=$11 AND environment_scope=$12
          ORDER BY observed_at DESC,probe_id DESC LIMIT 1`,
              [
                scope.workspaceId,
                scope.projectId,
                target.bindingRef,
                target.profileRef,
                target.connectionRef,
                target.mappingRef ?? null,
                target.validationReportRef,
                target.logicalRole,
                target.capabilityKey,
                target.exactContractVersion,
                target.operation,
                target.environmentScope,
              ],
            )) as { semantic_body: CapabilityProbeResult; content_hash: string }[];
            capabilities.push({
              ...base,
              ...projectPilotCapability({
                target,
                now: this.clock(),
                ...(row ? { probe: row.semantic_body, storedHash: row.content_hash } : {}),
              }),
            });
          }
      await this.authorize(authority, "pilot.health.read");
      for (let i = 0; i < capabilities.length; i++) {
        const value = capabilities[i]!;
        if (value.validUntil && Date.parse(value.validUntil) <= this.clock())
          capabilities[i] = {
            ...value,
            status: "UNKNOWN",
            reasonCodes: ["CAPABILITY_PROBE_EXPIRED"],
          };
      }
      return freezePilotValue({
        ...scope,
        projectState: project.state,
        onboardingState: project.current_operational_state ?? "UNKNOWN",
        stage: project.current_stage ?? "UNKNOWN",
        capabilityMode: project.current_capability_mode ?? "UNKNOWN",
        capabilities,
        reasonCodes: plans.length ? [] : ["CAPABILITY_CONFIGURATION_UNAVAILABLE"],
        evaluatedAt: new Date(this.clock()).toISOString(),
      });
    });
  }
  async readiness(authority: PilotReadAuthority, deploymentId: string) {
    await this.authorize(authority, "pilot.readiness.read");
    return this.source.transaction("REPEATABLE READ", async (manager) => {
      const scope = { workspaceId: authority.workspaceId, projectId: authority.projectId };
      const [row] = (await manager.query(
        `SELECT r.semantic_body,r.content_hash,h.current_version FROM pilot_record_headers h JOIN pilot_record_revisions r
        ON (r.workspace_id,r.project_id,r.record_id,r.version,r.content_hash)=(h.workspace_id,h.project_id,h.record_id,h.current_version,h.current_hash)
        WHERE h.workspace_id=$1 AND h.project_id=$2 AND h.record_id=$3 AND h.kind='DEPLOYMENT'`,
        [scope.workspaceId, scope.projectId, deploymentId],
      )) as { semantic_body: Row; content_hash: `sha256:${string}`; current_version: number }[];
      if (
        !row ||
        !scopeMatches(row.semantic_body, scope) ||
        row.semantic_body.id !== deploymentId ||
        row.semantic_body.version !== row.current_version ||
        pilotContentHash(row.semantic_body) !== row.content_hash
      )
        throw new Error("PILOT_RESOURCE_UNAVAILABLE");
      const deploymentRef = {
        id: deploymentId,
        version: row.current_version,
        contentHash: row.content_hash,
      };
      const configuration = row.semantic_body.body as {
        deploymentProfile?: string;
        inputPackageRef?: ExactRevisionRef;
      };
      if (
        !configuration ||
        !["local", "integration", "pilot"].includes(configuration.deploymentProfile ?? "")
      )
        throw new Error("PILOT_RESOURCE_UNAVAILABLE");
      let inputState: PilotInputReadiness | undefined;
      try {
        assertExactRevisionRef(configuration.inputPackageRef!);
        inputState = await this.inputs.current(manager, scope, configuration.inputPackageRef!);
        if (
          !scopeMatches(inputState, scope) ||
          !samePilotRef(inputState.packageRef, configuration.inputPackageRef) ||
          inputState.entries.length !== inputIds.length ||
          new Set(inputState.entries.map((value) => value.id)).size !== inputIds.length ||
          inputState.entries.some(
            (value) =>
              !inputIds.includes(value.id) ||
              !["PASS", "FAIL", "BLOCKED_INPUT"].includes(value.status) ||
              !value.ownerRole ||
              value.ownerRole.length > 80 ||
              !Array.isArray(value.reasonCodes) ||
              (value.status === "PASS" && value.reasonCodes.length !== 0),
          )
        )
          inputState = undefined;
      } catch {
        inputState = undefined;
      }
      const gates: Array<{
        kind: PilotGateKind;
        status: "PASS" | "FAIL" | "BLOCKED_INPUT";
        reasonCodes: readonly string[];
        validUntil?: string;
      }> = [];
      const evidenceDeadline = AbortSignal.timeout(30_000);
      for (const kind of allGateKinds) {
        const [gate] = (await manager.query(
          "SELECT semantic_body,content_hash FROM project_onboarding_gate_results WHERE workspace_id=$1 AND project_id=$2 AND gate_kind=$3 AND subject_refs=$4 ORDER BY evaluated_at DESC,gate_result_id DESC LIMIT 1",
          [scope.workspaceId, scope.projectId, kind, JSON.stringify([deploymentRef])],
        )) as { semantic_body: Row; content_hash: string }[];
        const body = gate?.semantic_body;
        if (
          !body ||
          !scopeMatches(body, scope) ||
          body.gateKind !== kind ||
          !samePilotRef(body.subjectRef as ExactRevisionRef, deploymentRef) ||
          pilotContentHash(body) !== gate?.content_hash ||
          !["PASS", "FAIL", "BLOCKED_INPUT"].includes(String(body.outcome))
        ) {
          gates.push({ kind, status: "BLOCKED_INPUT", reasonCodes: ["GATE_EVIDENCE_MISSING"] });
          continue;
        }
        const fresh =
          typeof body.evaluatedAt === "string" &&
          Date.parse(body.evaluatedAt) <= this.clock() &&
          typeof body.validUntil === "string" &&
          Date.parse(body.validUntil) > this.clock();
        if (
          fresh &&
          !(await this.gateEvidence.isCurrent(
            manager,
            { ...body, contentHash: gate!.content_hash } as unknown as PilotOnboardingGateResult,
            evidenceDeadline,
          ))
        ) {
          gates.push({ kind, status: "BLOCKED_INPUT", reasonCodes: ["GATE_EVIDENCE_UNVERIFIED"] });
          continue;
        }
        gates.push({
          kind,
          status: fresh ? (body.outcome as "PASS" | "FAIL" | "BLOCKED_INPUT") : "BLOCKED_INPUT",
          reasonCodes: fresh ? safeCodes(body.safeIssueCodes) : ["GATE_EVIDENCE_EXPIRED"],
          ...(typeof body.validUntil === "string" ? { validUntil: body.validUntil } : {}),
        });
      }
      await this.authorize(authority, "pilot.readiness.read");
      for (const gate of gates)
        if (gate.validUntil && Date.parse(gate.validUntil) <= this.clock()) {
          gate.status = "BLOCKED_INPUT";
          gate.reasonCodes = ["GATE_EVIDENCE_EXPIRED"];
        }
      const inputsFresh =
        inputState !== undefined &&
        Date.parse(inputState.observedAt) <= this.clock() &&
        Date.parse(inputState.validUntil) > this.clock() &&
        Date.parse(inputState.validUntil) > Date.parse(inputState.observedAt);
      const inputsReady =
        inputsFresh && (inputState?.entries.every((value) => value.status === "PASS") ?? false);
      const engineeringReady = gates[0]!.status === "PASS";
      const corporateGatesReady = inputsReady && gates.every((value) => value.status === "PASS");
      const gateReady =
        configuration.deploymentProfile === "local"
          ? engineeringReady
          : configuration.deploymentProfile === "integration"
            ? inputsReady && gates.slice(0, 3).every((value) => value.status === "PASS")
            : corporateGatesReady;
      return freezePilotValue({
        ...scope,
        deploymentRef,
        deploymentProfile: configuration.deploymentProfile,
        gateReady,
        engineeringReady,
        corporateGatesReady,
        gates,
        inputs: inputState
          ? {
              packageRef: inputState.packageRef,
              entries: inputState.entries.map((value) => ({
                ...value,
                ...(!inputsFresh
                  ? { status: "BLOCKED_INPUT", reasonCodes: ["INPUT_PACKAGE_EXPIRED"] }
                  : { reasonCodes: safeCodes(value.reasonCodes) }),
              })),
              validUntil: inputState.validUntil,
            }
          : { entries: [], reasonCodes: ["INPUT_PACKAGE_UNAVAILABLE"] },
        evaluatedAt: new Date(this.clock()).toISOString(),
      });
    });
  }
  private async authorize(
    authority: PilotReadAuthority,
    permission: "pilot.health.read" | "pilot.readiness.read",
  ) {
    const result = await authority.authorize(permission);
    if (
      !authority.workspaceId ||
      !authority.projectId ||
      !defaultClassificationCatalog.permits(
        defaultClassificationCatalog.reference(result.classificationCeiling),
        defaultClassificationCatalog.reference("CONFIDENTIAL"),
      )
    )
      throw new Error("PILOT_READ_DENIED");
  }
}
