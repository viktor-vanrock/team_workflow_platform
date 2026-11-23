import type { Sha256Digest } from "@awp/platform-contracts";

import type { ExactRevisionRef, HumanActorSnapshot, ProjectScope } from "./primitives.ts";

export interface BindingFunctionalAcceptance extends ProjectScope {
  readonly acceptanceId: string;
  readonly version: 1;
  readonly bindingRef: ExactRevisionRef;
  readonly validationReportRef: ExactRevisionRef;
  readonly qaProjectContextRef: ExactRevisionRef;
  readonly acceptedResourceRefs: readonly ExactRevisionRef[];
  readonly checklistRef: ExactRevisionRef;
  readonly outcome: "ACCEPTED" | "REJECTED";
  readonly safeIssueCodes: readonly string[];
  readonly acceptedBy: HumanActorSnapshot;
  readonly acceptedAt: string;
  readonly contentHash: Sha256Digest;
}

export interface CapabilityProbeResult extends ProjectScope {
  readonly probeId: string;
  readonly version: 1;
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
  readonly actorKind: "SERVICE";
  readonly contentHash: Sha256Digest;
}

export interface CapabilityRequirementEntry {
  readonly key: string;
  readonly mode: "MANUAL" | "AUTOMATION" | "PILOT_MESSAGING";
  readonly logicalRole: string;
  readonly capabilityKey: string;
  readonly operations: readonly string[];
  readonly required: boolean;
}

export interface CapabilityModeAssessment extends ProjectScope {
  readonly assessmentId: string;
  readonly version: 1;
  readonly bindingRef: ExactRevisionRef;
  readonly qaProjectContextRef: ExactRevisionRef;
  readonly requirementSetRef: ExactRevisionRef;
  readonly probeRefs: readonly ExactRevisionRef[];
  readonly manualRequirements: "SATISFIED" | "UNSATISFIED";
  readonly automationRequirements: "SATISFIED" | "UNSATISFIED";
  readonly pilotMessagingRequirement: "SATISFIED" | "DEGRADED" | "UNSATISFIED";
  readonly derivedMode: "MANUAL_ONLY" | "FULL_QA";
  readonly reasonCodes: readonly string[];
  readonly evaluatedAt: string;
  readonly contentHash: Sha256Digest;
}

export function deriveCapabilityMode(
  input: Readonly<{
    manualSatisfied: boolean;
    automationSatisfied: boolean;
    messagingStatus: "SATISFIED" | "DEGRADED" | "UNSATISFIED";
  }>,
): Pick<
  CapabilityModeAssessment,
  | "manualRequirements"
  | "automationRequirements"
  | "pilotMessagingRequirement"
  | "derivedMode"
  | "reasonCodes"
> {
  const reasonCodes: string[] = [];
  if (!input.manualSatisfied) reasonCodes.push("MANUAL_REQUIREMENTS_UNSATISFIED");
  if (!input.automationSatisfied) reasonCodes.push("AUTOMATION_REQUIREMENTS_UNSATISFIED");
  if (input.messagingStatus !== "SATISFIED")
    reasonCodes.push(`PILOT_MESSAGING_${input.messagingStatus}`);
  return Object.freeze({
    manualRequirements: input.manualSatisfied ? "SATISFIED" : "UNSATISFIED",
    automationRequirements: input.automationSatisfied ? "SATISFIED" : "UNSATISFIED",
    pilotMessagingRequirement: input.messagingStatus,
    derivedMode: input.manualSatisfied && input.automationSatisfied ? "FULL_QA" : "MANUAL_ONLY",
    reasonCodes: Object.freeze(reasonCodes),
  });
}
