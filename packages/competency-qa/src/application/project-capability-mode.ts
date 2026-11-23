import type { Sha256Digest } from "@awp/platform-contracts";

import { qaAggregateSnapshotHash, type QaScope } from "../domain/primitives.ts";

interface ExactRevisionRef {
  readonly id: string;
  readonly version: number;
  readonly contentHash: Sha256Digest;
}

export interface ProjectCapabilityProbe {
  readonly ref: ExactRevisionRef;
  readonly requirementKey?: string;
  readonly requirement: "MANUAL" | "AUTOMATION" | "PILOT_MESSAGING";
  readonly status: "AVAILABLE" | "DEGRADED" | "UNAVAILABLE";
  readonly validUntil: string;
}

export interface ProjectCapabilityModeInput extends QaScope {
  readonly assessmentId?: string;
  readonly bindingRef: ExactRevisionRef;
  readonly contextRef: ExactRevisionRef;
  readonly requirementSetRef: ExactRevisionRef;
  readonly requirementSet?: Readonly<{
    readonly requirements: readonly Readonly<{
      readonly requirementKey: string;
      readonly mode: ProjectCapabilityProbe["requirement"];
      readonly logicalRole: string;
    }>[];
  }>;
  readonly acceptedAutomationSuite?: Readonly<{
    readonly suiteBindingRef: ExactRevisionRef;
    readonly bindingRef: ExactRevisionRef;
    readonly environmentRef: ExactRevisionRef;
    readonly evidencePolicyRef: ExactRevisionRef;
  }>;
  readonly probes: readonly ProjectCapabilityProbe[];
  readonly now: string;
}

export function assessProjectCapabilityMode(input: ProjectCapabilityModeInput) {
  const now = Date.parse(input.now);
  if (Number.isNaN(now)) throw new Error("CAPABILITY_ASSESSMENT_TIMESTAMP_INVALID");
  const byRequirement = (requirement: ProjectCapabilityProbe["requirement"]) =>
    input.probes.filter((probe) => probe.requirement === requirement);
  const manual = byRequirement("MANUAL");
  const automation = byRequirement("AUTOMATION");
  const messaging = byRequirement("PILOT_MESSAGING");
  const freshAvailable = (probe: ProjectCapabilityProbe) =>
    probe.status === "AVAILABLE" && Date.parse(probe.validUntil) > now;
  const requirementsFor = (mode: ProjectCapabilityProbe["requirement"]) =>
    input.requirementSet?.requirements.filter((requirement) => requirement.mode === mode) ?? [];
  const matchedAndFresh = (requirementKey: string) =>
    input.probes.some((probe) => probe.requirementKey === requirementKey && freshAvailable(probe));
  const manualDefinitions = requirementsFor("MANUAL");
  const automationDefinitions = requirementsFor("AUTOMATION");
  const manualSatisfied =
    manualDefinitions.length > 0
      ? manualDefinitions.every(({ requirementKey }) => matchedAndFresh(requirementKey))
      : manual.length > 0 && manual.every(freshAvailable);
  const suiteMatchesBinding =
    input.acceptedAutomationSuite !== undefined &&
    input.acceptedAutomationSuite.bindingRef.id === input.bindingRef.id &&
    input.acceptedAutomationSuite.bindingRef.version === input.bindingRef.version &&
    input.acceptedAutomationSuite.bindingRef.contentHash === input.bindingRef.contentHash;
  const automationProbesSatisfied =
    automationDefinitions.length > 0
      ? automationDefinitions.every(({ requirementKey }) => matchedAndFresh(requirementKey))
      : automation.length > 0 && automation.every(freshAvailable);
  const automationSatisfied = automationProbesSatisfied && suiteMatchesBinding;
  const messagingDefinitions = requirementsFor("PILOT_MESSAGING");
  const messagingSatisfied =
    messagingDefinitions.length > 0
      ? messagingDefinitions.every(({ requirementKey }) => matchedAndFresh(requirementKey))
      : messaging.length > 0 && messaging.every(freshAvailable);
  const staleReasons = [
    ...(manual.some((probe) => Date.parse(probe.validUntil) <= now) ? ["MANUAL_PROBE_STALE"] : []),
    ...(automation.some((probe) => Date.parse(probe.validUntil) <= now)
      ? ["AUTOMATION_PROBE_STALE"]
      : []),
    ...(messaging.some((probe) => Date.parse(probe.validUntil) <= now)
      ? ["PILOT_MESSAGING_PROBE_STALE"]
      : []),
  ];
  const messagingStatus = messagingSatisfied
    ? ("SATISFIED" as const)
    : messaging.some((probe) => probe.status === "DEGRADED" && Date.parse(probe.validUntil) > now)
      ? ("DEGRADED" as const)
      : ("UNSATISFIED" as const);
  const reasonCodes = [
    ...manualDefinitions
      .filter(({ requirementKey }) => !matchedAndFresh(requirementKey))
      .map(({ logicalRole }) => `OPERATIONAL_${logicalRole}_UNSATISFIED`),
    ...automationDefinitions
      .filter(({ requirementKey }) => !matchedAndFresh(requirementKey))
      .map(({ logicalRole }) => `AUTOMATION_${logicalRole}_UNSATISFIED`),
    ...(input.acceptedAutomationSuite !== undefined && !suiteMatchesBinding
      ? ["AUTOMATION_SUITE_ACCEPTANCE_MISMATCH"]
      : []),
    ...(input.requirementSet !== undefined && input.acceptedAutomationSuite === undefined
      ? ["AUTOMATION_SUITE_ACCEPTANCE_MISSING"]
      : []),
    ...(!manualSatisfied ? ["MANUAL_REQUIREMENTS_UNSATISFIED"] : []),
    ...(!automationSatisfied ? ["AUTOMATION_REQUIREMENTS_UNSATISFIED"] : []),
    ...(messagingStatus !== "SATISFIED" ? [`PILOT_MESSAGING_${messagingStatus}`] : []),
  ];
  const body = {
    assessmentId: input.assessmentId ?? `${input.bindingRef.id}:mode:${input.now}`,
    version: 1 as const,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    bindingRef: input.bindingRef,
    qaProjectContextRef: input.contextRef,
    requirementSetRef: input.requirementSetRef,
    probeRefs: Object.freeze(input.probes.map(({ ref }) => ref)),
    manualRequirements: manualSatisfied ? ("SATISFIED" as const) : ("UNSATISFIED" as const),
    automationRequirements: automationSatisfied ? ("SATISFIED" as const) : ("UNSATISFIED" as const),
    pilotMessagingRequirement: messagingStatus,
    messagingFallback:
      messagingStatus === "SATISFIED" ? ("NONE" as const) : ("WEB_AND_OUTBOX" as const),
    derivedMode:
      manualSatisfied && automationSatisfied ? ("FULL_QA" as const) : ("MANUAL_ONLY" as const),
    reasonCodes: Object.freeze([...staleReasons, ...reasonCodes]),
    evaluatedAt: input.now,
  };
  return Object.freeze({ ...body, contentHash: qaAggregateSnapshotHash(body as never) });
}

/** Domain fallback after fresh resume probes; Core keeps the capability key opaque. */
export function parseQaProjectCapabilityMode(
  intendedCapabilityMode: string,
): "FULL_QA" | "MANUAL_ONLY" {
  if (intendedCapabilityMode !== "FULL_QA" && intendedCapabilityMode !== "MANUAL_ONLY")
    throw new Error("QA_CAPABILITY_MODE_INVALID");
  return intendedCapabilityMode;
}

export function recalculateProjectResumeMode(
  intendedCapabilityMode: string,
  currentRequirementsPass: boolean,
): "FULL_QA" | "MANUAL_ONLY" {
  parseQaProjectCapabilityMode(intendedCapabilityMode);
  return intendedCapabilityMode === "FULL_QA" && currentRequirementsPass
    ? "FULL_QA"
    : "MANUAL_ONLY";
}
