import {
  qaAggregateSnapshotHash,
  type QaContentHash,
  QaDomainError,
  type QaExactReference,
} from "./primitives.ts";
import type { QaExternalImmutableRef } from "./qa-project-context.ts";
import type { QaAutomationCapabilityKey, QaAutomationLogicalRole } from "./suite-binding.ts";

export interface QaTargetSnapshot {
  readonly schemaVersion: 1;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly buildRef: QaExternalImmutableRef;
  readonly environmentRef: Readonly<{
    id: string;
    revision: number;
    scope: "LOCAL" | "NON_PROD" | "PREPROD";
  }>;
  readonly testDataRef?: QaExternalImmutableRef;
  readonly accountLeaseRef?: QaExternalImmutableRef;
  readonly checklistRefs: readonly QaExternalImmutableRef[];
  readonly bindingRef: Readonly<{ id: string; version: number }>;
  readonly profileRefs: readonly Readonly<{ id: string; version: number }>[];
  readonly contentHash: QaContentHash;
}

export interface QaScopeSnapshot {
  readonly schemaVersion: 1;
  readonly purpose: string;
  readonly agreedScope: string;
  readonly acceptanceOutcome: string;
  readonly inclusions: readonly string[];
  readonly exclusions: readonly string[];
  readonly checklistDefinition: QaExternalImmutableRef;
  readonly contentHash: QaContentHash;
}

export interface QaAutomatedConfigurationPin {
  readonly ordinal: number;
  readonly logicalRole: QaAutomationLogicalRole;
  readonly capabilityKey: QaAutomationCapabilityKey;
  readonly exactContractVersion: "1.0.0";
  readonly projectIntegrationBindingRef: QaExactReference;
  readonly profileRef: QaExactReference;
  readonly connectionRef: QaExactReference;
  readonly validationReportRef: QaExactReference;
  readonly operationSetHash: QaContentHash;
  readonly externalScopeHash: QaContentHash;
}

export type QaAutomationTarget =
  | Readonly<{
      type: "MERGE_REQUEST";
      mergeRequestRef: string;
      commitSha: string;
      buildRef?: string;
    }>
  | Readonly<{ type: "COMMIT"; commitSha: string; buildRef?: string }>
  | Readonly<{ type: "BUILD"; buildRef: string; commitSha: string }>;

export interface QaAutomatedTargetSnapshot {
  readonly schemaVersion: 2;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly workItemId: string;
  readonly testSessionId: string;
  readonly sourceIssueKey: string;
  readonly target: QaAutomationTarget;
  readonly environment: Readonly<{
    environmentRef: string;
    revision: number;
    class: "LOCAL" | "DEVELOPMENT" | "TEST";
  }>;
  readonly suite: Readonly<{
    suiteKey: string;
    suiteBindingRef: Readonly<{ id: string; version: number }>;
    suiteBindingHash: QaContentHash;
    parameterSchemaRef: QaExactReference;
    acceptedParameters: Readonly<Record<string, unknown>>;
    parametersHash: QaContentHash;
    browser?: "chromium" | "firefox" | "webkit";
  }>;
  readonly configurationPins: readonly QaAutomatedConfigurationPin[];
  readonly configurationPinSetHash: QaContentHash;
  readonly executionPolicies: Readonly<{
    resultSchemaRef: QaExactReference;
    artifactPolicyRef: QaExactReference;
    retryPolicyRef: QaExactReference;
    quarantinePolicyRef: QaExactReference;
  }>;
  readonly testDataRefs: readonly QaExternalImmutableRef[];
  readonly accountLeaseRefs: readonly QaExternalImmutableRef[];
  readonly snapshotHash: QaContentHash;
  readonly capturedAt: string;
}

type QaAutomatedTargetSnapshotInput = Omit<
  QaAutomatedTargetSnapshot,
  "schemaVersion" | "configurationPinSetHash" | "snapshotHash" | "suite"
> &
  Readonly<{
    suite: Omit<QaAutomatedTargetSnapshot["suite"], "parametersHash">;
  }>;

const automationRoles = Object.freeze([
  ["SOURCE_CONTEXT", "source-context.read"],
  ["TEST_EXECUTION", "test-executor.trigger-status"],
  ["ARTIFACT_SOURCE", "artifact.ci-read"],
] as const);

function exactReference(ref: QaExactReference): boolean {
  return (
    !!ref.id &&
    Number.isInteger(ref.version) &&
    ref.version > 0 &&
    /^sha256:[a-f0-9]{64}$/u.test(ref.contentHash)
  );
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

export function createAutomatedTargetSnapshot(
  input: QaAutomatedTargetSnapshotInput,
): QaAutomatedTargetSnapshot {
  if (
    [input.workspaceId, input.projectId, input.workItemId, input.testSessionId].some(
      (value) => !value,
    ) ||
    !/^[A-Z][A-Z0-9_]+-[1-9][0-9]*$/u.test(input.sourceIssueKey) ||
    !/^[a-f0-9]{40}$/u.test(input.target.commitSha) ||
    (input.target.type === "MERGE_REQUEST" && !input.target.mergeRequestRef) ||
    (input.target.type === "BUILD" && !input.target.buildRef) ||
    !input.environment.environmentRef ||
    !Number.isInteger(input.environment.revision) ||
    input.environment.revision < 1 ||
    !["LOCAL", "DEVELOPMENT", "TEST"].includes(input.environment.class) ||
    !/^[a-z][a-z0-9._-]{0,127}$/u.test(input.suite.suiteKey) ||
    !input.suite.suiteBindingRef.id ||
    input.suite.suiteBindingRef.version < 1 ||
    !/^sha256:[a-f0-9]{64}$/u.test(input.suite.suiteBindingHash) ||
    !exactReference(input.suite.parameterSchemaRef) ||
    Number.isNaN(Date.parse(input.capturedAt))
  )
    throw new QaDomainError("QA_AUTOMATED_TARGET_SNAPSHOT_INVALID");
  if (
    input.testDataRefs.length + input.accountLeaseRefs.length < 1 ||
    [...input.testDataRefs, ...input.accountLeaseRefs].some((ref) => !immutable(ref))
  ) {
    throw new QaDomainError("QA_AUTOMATED_TARGET_RESOURCES_INVALID");
  }
  if (input.configurationPins.length !== automationRoles.length)
    throw new QaDomainError("QA_AUTOMATED_CONFIGURATION_PINS_INCOMPLETE");
  const pins = [...input.configurationPins].sort((left, right) => left.ordinal - right.ordinal);
  pins.forEach((pin, index) => {
    const expected = automationRoles[index]!;
    if (
      pin.ordinal !== index + 1 ||
      pin.logicalRole !== expected[0] ||
      pin.capabilityKey !== expected[1] ||
      pin.exactContractVersion !== "1.0.0" ||
      !exactReference(pin.projectIntegrationBindingRef) ||
      !exactReference(pin.profileRef) ||
      !exactReference(pin.connectionRef) ||
      !exactReference(pin.validationReportRef) ||
      !/^sha256:[a-f0-9]{64}$/u.test(pin.operationSetHash) ||
      !/^sha256:[a-f0-9]{64}$/u.test(pin.externalScopeHash)
    )
      throw new QaDomainError("QA_AUTOMATED_CONFIGURATION_PIN_INVALID");
  });
  const binding = pins[0]!.projectIntegrationBindingRef;
  if (
    pins.some(
      (pin) =>
        pin.projectIntegrationBindingRef.id !== binding.id ||
        pin.projectIntegrationBindingRef.version !== binding.version ||
        pin.projectIntegrationBindingRef.contentHash !== binding.contentHash,
    )
  ) {
    throw new QaDomainError("QA_AUTOMATED_CONFIGURATION_BINDING_MISMATCH");
  }
  for (const ref of Object.values(input.executionPolicies)) {
    if (!exactReference(ref)) throw new QaDomainError("QA_AUTOMATED_EXECUTION_POLICY_INVALID");
  }
  const acceptedParameters = deepFreeze(structuredClone(input.suite.acceptedParameters));
  const suite = deepFreeze({
    ...structuredClone(input.suite),
    acceptedParameters,
    parametersHash: qaAggregateSnapshotHash(acceptedParameters as never),
  });
  const configurationPins = deepFreeze(structuredClone(pins));
  const body = deepFreeze({
    schemaVersion: 2 as const,
    ...structuredClone(input),
    suite,
    configurationPins,
    configurationPinSetHash: qaAggregateSnapshotHash(configurationPins as never),
  });
  return deepFreeze({ ...body, snapshotHash: qaAggregateSnapshotHash(body as never) });
}

const immutable = (ref: QaExternalImmutableRef) =>
  ref.id.length > 0 && ref.version.length > 0 && ref.contentHash.startsWith("sha256:");

export function makeTargetSnapshot(
  input: Omit<QaTargetSnapshot, "schemaVersion" | "contentHash">,
): QaTargetSnapshot {
  if (
    !input.workspaceId ||
    !input.projectId ||
    !immutable(input.buildRef) ||
    input.environmentRef.revision < 1 ||
    input.environmentRef.scope === ("PRODUCTION" as never) ||
    (!input.testDataRef && !input.accountLeaseRef) ||
    input.checklistRefs.length === 0 ||
    input.checklistRefs.some((ref) => !immutable(ref)) ||
    input.bindingRef.version < 1 ||
    input.profileRefs.length === 0 ||
    input.profileRefs.some(({ id, version }) => !id || version < 1)
  )
    throw new QaDomainError("QA_TARGET_SNAPSHOT_INVALID");
  if (input.testDataRef && !immutable(input.testDataRef))
    throw new QaDomainError("QA_TARGET_SNAPSHOT_MUTABLE_ALIAS");
  if (input.accountLeaseRef && !immutable(input.accountLeaseRef))
    throw new QaDomainError("QA_TARGET_SNAPSHOT_MUTABLE_ALIAS");
  const body = Object.freeze({ schemaVersion: 1 as const, ...structuredClone(input) });
  return Object.freeze({ ...body, contentHash: qaAggregateSnapshotHash(body as never) });
}

export function makeScopeSnapshot(
  input: Omit<QaScopeSnapshot, "schemaVersion" | "contentHash">,
): QaScopeSnapshot {
  if (
    [input.purpose, input.agreedScope, input.acceptanceOutcome].some(
      (value) => value.trim().length === 0,
    ) ||
    !immutable(input.checklistDefinition)
  )
    throw new QaDomainError("QA_SCOPE_SNAPSHOT_INVALID");
  const body = Object.freeze({
    schemaVersion: 1 as const,
    ...structuredClone(input),
    inclusions: Object.freeze([...input.inclusions]),
    exclusions: Object.freeze([...input.exclusions]),
  });
  return Object.freeze({ ...body, contentHash: qaAggregateSnapshotHash(body as never) });
}
