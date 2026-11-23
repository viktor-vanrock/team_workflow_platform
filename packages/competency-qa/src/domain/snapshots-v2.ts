import type { JsonValue, Sha256Digest } from "@awp/platform-contracts";

import { canonicalEvidenceBytes, evidenceContentHash } from "./evidence-manifest-v2.ts";
import { QaDomainError } from "./primitives.ts";

export interface ExactSnapshotRef {
  readonly id: string;
  readonly version: number;
  readonly contentHash: Sha256Digest;
}

export interface QaTargetSnapshotV2 {
  readonly schemaVersion: "qa-target-snapshot@2.0.0";
  readonly snapshotId: string;
  readonly version: 1;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly workItemId: string;
  readonly sessionId: string;
  readonly mode: "MANUAL" | "AUTOMATED";
  readonly sourceRefs: readonly ExactSnapshotRef[];
  readonly buildRef: ExactSnapshotRef;
  readonly environmentRef: ExactSnapshotRef;
  readonly testDataRefs: readonly ExactSnapshotRef[];
  readonly accountLeaseRefs: readonly ExactSnapshotRef[];
  readonly definitionRefs: readonly ExactSnapshotRef[];
  readonly configurationPins: readonly Readonly<{
    ordinal: number;
    logicalRole: string;
    capabilityKey: string;
    exactContractVersion: string;
    bindingRef: ExactSnapshotRef;
    profileRef: ExactSnapshotRef;
    connectionRef: ExactSnapshotRef;
    mappingRef?: ExactSnapshotRef;
    validationReportRef: ExactSnapshotRef;
    operationSetHash: Sha256Digest;
    externalScopeHash: Sha256Digest;
  }>[];
  readonly policyRefs: readonly ExactSnapshotRef[];
  readonly modeConfiguration: Readonly<{
    schemaRef: unknown;
    value: JsonValue;
    contentHash: Sha256Digest;
  }>;
  readonly capturedAt: string;
  readonly contentHash: Sha256Digest;
}

function assertRef(ref: ExactSnapshotRef): void {
  if (!ref.id || ref.version < 1 || !/^sha256:[a-f0-9]{64}$/u.test(ref.contentHash))
    throw new QaDomainError("TARGET_SNAPSHOT_EXACT_REF_INVALID");
}

export function createTargetSnapshotV2(
  input: Omit<QaTargetSnapshotV2, "schemaVersion" | "version" | "contentHash">,
): QaTargetSnapshotV2 {
  if (
    !input.snapshotId ||
    !input.workspaceId ||
    !input.projectId ||
    !input.workItemId ||
    !input.sessionId ||
    Number.isNaN(Date.parse(input.capturedAt))
  ) {
    throw new QaDomainError("TARGET_SNAPSHOT_V2_INVALID");
  }
  const refs = [
    input.buildRef,
    input.environmentRef,
    ...input.sourceRefs,
    ...input.testDataRefs,
    ...input.accountLeaseRefs,
    ...input.definitionRefs,
    ...input.policyRefs,
  ];
  refs.forEach(assertRef);
  if (
    input.testDataRefs.length + input.accountLeaseRefs.length < 1 ||
    input.configurationPins.length === 0
  ) {
    throw new QaDomainError("TARGET_SNAPSHOT_V2_INCOMPLETE");
  }
  const pins = [...input.configurationPins].sort((left, right) => left.ordinal - right.ordinal);
  const binding = pins[0]!.bindingRef;
  pins.forEach((pin, index) => {
    for (const ref of [
      pin.bindingRef,
      pin.profileRef,
      pin.connectionRef,
      pin.validationReportRef,
      ...(pin.mappingRef ? [pin.mappingRef] : []),
    ])
      assertRef(ref);
    if (
      pin.ordinal !== index + 1 ||
      pin.bindingRef.id !== binding.id ||
      pin.bindingRef.version !== binding.version ||
      pin.bindingRef.contentHash !== binding.contentHash
    ) {
      throw new QaDomainError("TARGET_SNAPSHOT_BINDING_PIN_MISMATCH");
    }
  });
  if (evidenceContentHash(input.modeConfiguration.value) !== input.modeConfiguration.contentHash)
    throw new QaDomainError("TARGET_SNAPSHOT_MODE_CONFIGURATION_HASH_MISMATCH");
  const body = {
    schemaVersion: "qa-target-snapshot@2.0.0" as const,
    version: 1 as const,
    ...structuredClone(input),
    configurationPins: pins,
  };
  canonicalEvidenceBytes(body);
  return Object.freeze({ ...body, contentHash: evidenceContentHash(body) });
}
