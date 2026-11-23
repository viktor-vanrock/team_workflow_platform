import {
  assertExactRevisionRef,
  assertProjectScope,
  type CapabilityProbeResult,
  type ExactRevisionRef,
  freezePilotValue,
  onboardingContentHash,
  type ProjectScope,
} from "@awp/platform-core";

export interface ManualBindingEntry {
  readonly connectorType: "JIRA" | "MATTERMOST";
  readonly logicalRole:
    "QA_REQUEST_AUTHORITY" | "SOURCE_CONTEXT" | "DEFECT_DESTINATION" | "PILOT_MESSAGING";
  readonly profileRef: ExactRevisionRef;
  readonly connectionRef?: ExactRevisionRef;
  readonly mappingRef?: ExactRevisionRef;
}

export interface ManualBindingValidationInput extends ProjectScope {
  readonly bindingRef: ExactRevisionRef;
  readonly qaProjectContextRef: ExactRevisionRef;
  readonly entries: readonly ManualBindingEntry[];
  readonly now: string;
}

export interface ManualBindingValidationReport {
  readonly ref: ExactRevisionRef;
  readonly outcome: "PASS" | "FAIL";
  readonly safeIssueCodes: readonly string[];
  readonly observedAt: string;
}

export interface ManualBindingValidationResult extends ManualBindingValidationInput {
  readonly state: "DRAFT" | "VALIDATED";
  readonly validationReportId: string | undefined;
  readonly report: ManualBindingValidationReport;
}

const requiredManualRoles = Object.freeze([
  Object.freeze({ connectorType: "JIRA", logicalRole: "QA_REQUEST_AUTHORITY" }),
  Object.freeze({ connectorType: "JIRA", logicalRole: "SOURCE_CONTEXT" }),
  Object.freeze({ connectorType: "JIRA", logicalRole: "DEFECT_DESTINATION" }),
  Object.freeze({ connectorType: "MATTERMOST", logicalRole: "PILOT_MESSAGING" }),
] as const);

export function validateManualBindingCandidate(
  input: ManualBindingValidationInput,
): ManualBindingValidationResult {
  assertProjectScope(input);
  assertExactRevisionRef(input.bindingRef);
  assertExactRevisionRef(input.qaProjectContextRef);
  if (Number.isNaN(Date.parse(input.now))) throw new Error("CAPABILITY_PROBE_TIMESTAMP_INVALID");
  input.entries.forEach(({ profileRef, connectionRef, mappingRef }) => {
    assertExactRevisionRef(profileRef);
    if (connectionRef) assertExactRevisionRef(connectionRef);
    if (mappingRef) assertExactRevisionRef(mappingRef);
  });

  const safeIssueCodes = requiredManualRoles
    .filter(
      (requirement) =>
        !input.entries.some(
          (entry) =>
            entry.connectorType === requirement.connectorType &&
            entry.logicalRole === requirement.logicalRole,
        ),
    )
    .map(({ logicalRole }) => `${logicalRole}_MISSING`)
    .sort((left, right) => left.localeCompare(right));
  const outcome = safeIssueCodes.length === 0 ? ("PASS" as const) : ("FAIL" as const);
  const reportBody = {
    reportId: `${input.bindingRef.id}:manual-validation`,
    version: 1,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    bindingRef: input.bindingRef,
    qaProjectContextRef: input.qaProjectContextRef,
    outcome,
    safeIssueCodes,
    observedAt: input.now,
  };
  const report = Object.freeze({
    ref: Object.freeze({
      id: reportBody.reportId,
      version: 1,
      contentHash: onboardingContentHash(reportBody as never),
    }),
    outcome,
    safeIssueCodes: Object.freeze(safeIssueCodes),
    observedAt: input.now,
  });
  return Object.freeze({
    ...structuredClone(input),
    state: outcome === "PASS" ? ("VALIDATED" as const) : ("DRAFT" as const),
    validationReportId: outcome === "PASS" ? report.ref.id : undefined,
    report,
  });
}

export interface SafeCapabilityProbeInput extends ProjectScope {
  readonly probeId: string;
  readonly bindingRef: ExactRevisionRef;
  readonly profileRef: ExactRevisionRef;
  readonly connectionRef: ExactRevisionRef;
  readonly mappingRef?: ExactRevisionRef;
  readonly validationReportRef: ExactRevisionRef;
  readonly logicalRole: string;
  readonly capabilityKey: string;
  readonly exactContractVersion: string;
  readonly operation: string;
  readonly environmentScope: "LOCAL" | "NON_PROD" | "PREPROD";
  readonly status: "AVAILABLE" | "DEGRADED" | "UNAVAILABLE";
  readonly safeIssueCodes: readonly string[];
  readonly observedAt: string;
  readonly validUntil: string;
}

export function createSafeCapabilityProbe(input: SafeCapabilityProbeInput): CapabilityProbeResult {
  assertProjectScope(input);
  for (const ref of [
    input.bindingRef,
    input.profileRef,
    input.connectionRef,
    input.validationReportRef,
    ...(input.mappingRef ? [input.mappingRef] : []),
  ]) {
    assertExactRevisionRef(ref);
  }
  if (
    !input.probeId ||
    !input.logicalRole ||
    !input.capabilityKey ||
    !input.exactContractVersion ||
    !input.operation ||
    !["AVAILABLE", "DEGRADED", "UNAVAILABLE"].includes(input.status) ||
    !["LOCAL", "NON_PROD", "PREPROD"].includes(input.environmentScope) ||
    !Number.isFinite(Date.parse(input.observedAt)) ||
    !Number.isFinite(Date.parse(input.validUntil)) ||
    Date.parse(input.validUntil) <= Date.parse(input.observedAt)
  ) {
    throw new Error("CAPABILITY_PROBE_INVALID");
  }
  const safeIssueCodes = Object.freeze(
    [...input.safeIssueCodes].sort((left, right) => left.localeCompare(right)),
  );
  const body = {
    ...structuredClone(input),
    version: 1 as const,
    safeIssueCodes,
    actorKind: "SERVICE" as const,
  };
  return freezePilotValue({ ...body, contentHash: onboardingContentHash(body as never) });
}
