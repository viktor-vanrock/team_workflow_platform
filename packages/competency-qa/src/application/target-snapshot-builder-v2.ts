import { QaDomainError } from "../domain/primitives.ts";
import {
  createTargetSnapshotV2,
  type ExactSnapshotRef,
  type QaTargetSnapshotV2,
} from "../domain/snapshots-v2.ts";

export interface UnorderedConfigurationPinV2 {
  readonly logicalRole: string;
  readonly capabilityKey: string;
  readonly exactContractVersion: string;
  readonly profileRef: ExactSnapshotRef;
  readonly connectionRef: ExactSnapshotRef;
  readonly mappingRef?: ExactSnapshotRef;
  readonly validationReportRef: ExactSnapshotRef;
  readonly operationSetHash: ExactSnapshotRef["contentHash"];
  readonly externalScopeHash: ExactSnapshotRef["contentHash"];
}

export interface BuildTargetSnapshotV2Input extends Omit<
  Parameters<typeof createTargetSnapshotV2>[0],
  "configurationPins"
> {
  readonly bindingRef: ExactSnapshotRef;
  readonly configurationPins: readonly UnorderedConfigurationPinV2[];
}

const automationRoles = Object.freeze([
  "SOURCE_CONTEXT",
  "TEST_EXECUTION",
  "ARTIFACT_SOURCE",
] as const);

export function buildTargetSnapshotV2(input: BuildTargetSnapshotV2Input): QaTargetSnapshotV2 {
  const identifiers = [
    input.snapshotId,
    input.workItemId,
    input.sessionId,
    input.bindingRef?.id,
    ...input.sourceRefs.map(({ id }) => id),
    input.buildRef.id,
    input.environmentRef.id,
    ...input.testDataRefs.map(({ id }) => id),
    ...input.accountLeaseRefs.map(({ id }) => id),
    ...input.definitionRefs.map(({ id }) => id),
    ...input.policyRefs.map(({ id }) => id),
  ];
  if (
    identifiers.some(
      (value) =>
        value === undefined ||
        /(?:^|[:/_-])(latest|current|secret|production|prod)(?:$|[:/_-])/iu.test(value),
    )
  ) {
    throw new QaDomainError("TARGET_SNAPSHOT_UNSAFE_IDENTIFIER");
  }
  const ordered = [...input.configurationPins].sort((left, right) =>
    `${left.logicalRole}:${left.capabilityKey}`.localeCompare(
      `${right.logicalRole}:${right.capabilityKey}`,
    ),
  );
  if (
    input.mode === "AUTOMATED" &&
    (ordered.length !== automationRoles.length ||
      automationRoles.some((role) => !ordered.some((pin) => pin.logicalRole === role)))
  ) {
    throw new QaDomainError("TARGET_SNAPSHOT_AUTOMATION_PINS_INCOMPLETE");
  }
  const { bindingRef, ...snapshot } = input;
  return createTargetSnapshotV2({
    ...snapshot,
    configurationPins: ordered.map((pin, index) =>
      Object.freeze({ ...pin, ordinal: index + 1, bindingRef }),
    ),
  });
}
