import type { QaContentHash, QaExactReference } from "../domain/primitives.ts";
import type {
  QaAutomationCapabilityKey,
  QaAutomationLogicalRole,
} from "../domain/suite-binding.ts";

export type QaAutomationCapabilityMode = "FULL_QA" | "MANUAL_ONLY";
export type QaAutomationLiveAvailability = "AVAILABLE" | "DEGRADED" | "UNAVAILABLE";

export type QaAutomationConfigurationReasonCode =
  | "NO_PUBLISHED_SUITE"
  | "ROLE_INTERSECTION_INCOMPLETE"
  | "CONFIGURATION_VALIDATION_STALE"
  | "AUTHORIZATION_UNAVAILABLE"
  | "ENTITLEMENT_UNAVAILABLE"
  | "NON_PRODUCTION_POLICY_UNPROVEN";

export interface QaAutomationRolePinProjection {
  readonly logicalRole: QaAutomationLogicalRole;
  readonly capabilityKey: QaAutomationCapabilityKey;
  readonly exactContractVersion: "1.0.0";
  readonly bindingRef: QaExactReference;
  readonly profileRef: QaExactReference;
  readonly connectionRef: QaExactReference;
  readonly validationReportRef: QaExactReference;
  readonly current: boolean;
}

export interface QaAutomationConfigurationIntersection {
  readonly publishedSuite?: QaExactReference;
  readonly rolePins: readonly QaAutomationRolePinProjection[];
  readonly validationEvidence: Readonly<{ exact: boolean; current: boolean }>;
  readonly authorizationCurrent: boolean;
  readonly entitlementCurrent: boolean;
  readonly nonProductionProven: boolean;
  readonly liveHealth: Readonly<{
    availability: QaAutomationLiveAvailability;
    reasonCodes: readonly string[];
  }>;
}

export interface QaAutomationAvailability {
  readonly capabilityMode: QaAutomationCapabilityMode;
  readonly configurationReasonCodes: readonly QaAutomationConfigurationReasonCode[];
  readonly liveAvailability: QaAutomationLiveAvailability;
  readonly liveReasonCodes: readonly string[];
  readonly launchPermitted: boolean;
}

const exactRoles = Object.freeze([
  ["SOURCE_CONTEXT", "source-context.read"],
  ["TEST_EXECUTION", "test-executor.trigger-status"],
  ["ARTIFACT_SOURCE", "artifact.ci-read"],
] as const);

function validHash(value: QaContentHash): boolean {
  return /^sha256:[a-f0-9]{64}$/u.test(value);
}

function exactReference(ref: QaExactReference | undefined): ref is QaExactReference {
  return (
    ref !== undefined &&
    !!ref.id &&
    Number.isInteger(ref.version) &&
    ref.version > 0 &&
    validHash(ref.contentHash)
  );
}

function exactRoleIntersection(pins: readonly QaAutomationRolePinProjection[]): boolean {
  if (pins.length !== exactRoles.length) return false;
  const ordered = [...pins].sort((left, right) =>
    left.logicalRole.localeCompare(right.logicalRole),
  );
  const expected = [...exactRoles].sort((left, right) => left[0].localeCompare(right[0]));
  const bindings = new Set(
    pins.map(
      ({ bindingRef }) => `${bindingRef.id}\0${bindingRef.version}\0${bindingRef.contentHash}`,
    ),
  );
  return (
    bindings.size === 1 &&
    ordered.every((pin, index) => {
      const role = expected[index]!;
      return (
        pin.logicalRole === role[0] &&
        pin.capabilityKey === role[1] &&
        pin.exactContractVersion === "1.0.0" &&
        pin.current &&
        exactReference(pin.bindingRef) &&
        exactReference(pin.profileRef) &&
        exactReference(pin.connectionRef) &&
        exactReference(pin.validationReportRef)
      );
    })
  );
}

function liveReasons(
  input: QaAutomationConfigurationIntersection["liveHealth"],
): readonly string[] {
  const reasons = [...new Set(input.reasonCodes)];
  if (reasons.some((reason) => !/^[A-Z][A-Z0-9_]{2,127}$/u.test(reason)))
    return Object.freeze(["AUTOMATION_HEALTH_REASON_INVALID"]);
  return Object.freeze(reasons);
}

export function deriveAutomationAvailability(
  input: QaAutomationConfigurationIntersection,
): QaAutomationAvailability {
  const configurationReasonCodes: QaAutomationConfigurationReasonCode[] = [];
  if (!exactReference(input.publishedSuite)) configurationReasonCodes.push("NO_PUBLISHED_SUITE");
  if (!exactRoleIntersection(input.rolePins))
    configurationReasonCodes.push("ROLE_INTERSECTION_INCOMPLETE");
  if (!input.validationEvidence.exact || !input.validationEvidence.current)
    configurationReasonCodes.push("CONFIGURATION_VALIDATION_STALE");
  if (!input.authorizationCurrent) configurationReasonCodes.push("AUTHORIZATION_UNAVAILABLE");
  if (!input.entitlementCurrent) configurationReasonCodes.push("ENTITLEMENT_UNAVAILABLE");
  if (!input.nonProductionProven) configurationReasonCodes.push("NON_PRODUCTION_POLICY_UNPROVEN");
  const capabilityMode: QaAutomationCapabilityMode =
    configurationReasonCodes.length === 0 ? "FULL_QA" : "MANUAL_ONLY";
  const liveReasonCodes = liveReasons(input.liveHealth);
  return Object.freeze({
    capabilityMode,
    configurationReasonCodes: Object.freeze(configurationReasonCodes),
    liveAvailability: input.liveHealth.availability,
    liveReasonCodes,
    launchPermitted: capabilityMode === "FULL_QA" && input.liveHealth.availability === "AVAILABLE",
  });
}
