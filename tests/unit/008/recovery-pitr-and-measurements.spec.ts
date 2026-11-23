import { describe, expect, it } from "vitest";

import { measureRecovery008 } from "../../../tools/recovery/008-measurements.mts";
import {
  executePitrRecovery008,
  validatePitrManifest008,
} from "../../../tools/recovery/008-pitr.mts";
import { evaluateCorporateRecoveryInputs008 } from "../../../tools/verification/feature-008-recovery.mts";

const expected = {
  requestedPoint: "2026-09-05T00:05:00Z",
  databaseMajor: 18,
  sourceDeploymentRef: "deployment-1",
  approvedProviderRef: "provider-1",
  now: Date.parse("2026-09-05T00:10:00Z"),
  maximumAgeMs: 3_600_000,
};
const manifest = () => ({
  schemaVersion: "pitr-manifest@1.0.0",
  kind: "PHYSICAL_PITR",
  sourceDeploymentRef: "deployment-1",
  databaseMajor: 18,
  baseBackupRef: "backup-1",
  baseBackupDigest: `sha256:${"a".repeat(64)}`,
  timeline: "1",
  walSegments: ["000000010000000000000001", "000000010000000000000002"],
  startedAt: "2026-09-05T00:00:00Z",
  completedAt: "2026-09-05T00:06:00Z",
  providerRef: "provider-1",
});
describe("008 physical PITR and recovery measurements", () => {
  it("keeps absent/mismatched physical evidence blocked and separate from logical restore", () => {
    expect(validatePitrManifest008(null, expected)).toMatchObject({ status: "BLOCKED_INPUT" });
    expect(validatePitrManifest008({ ...manifest(), kind: "LOGICAL" }, expected)).toMatchObject({
      status: "BLOCKED_INPUT",
    });
    expect(
      validatePitrManifest008(
        { ...manifest(), walSegments: ["000000010000000000000002", "000000010000000000000001"] },
        expected,
      ),
    ).toMatchObject({ status: "BLOCKED_INPUT", reasonCodes: ["PITR_WAL_CHAIN_INVALID"] });
  });
  it("uses only an approved provider with exact base backup/WAL/timeline", async () => {
    let calls = 0;
    expect(
      await executePitrRecovery008(manifest(), expected, {
        restore: async (input) => {
          calls++;
          expect(input.walSegments).toHaveLength(2);
          return { isolatedTargetId: "isolated-pitr", recoveredAt: "2026-09-05T00:07:00Z" };
        },
      }),
    ).toMatchObject({ status: "PASS" });
    expect(calls).toBe(1);
  });
  it("measures RPO from the fault point and ends RTO after service verification", () =>
    expect(
      measureRecovery008({
        backupCompletedAt: "2026-09-05T00:00:00Z",
        faultDeclaredAt: "2026-09-05T00:10:00Z",
        lastConfirmedRecoverableCommitAt: "2026-09-05T00:09:30Z",
        databaseRestoredAt: "2026-09-05T00:11:00Z",
        verificationCompletedAt: "2026-09-05T00:12:00Z",
        serviceRestoredAt: "2026-09-05T00:13:00Z",
        policy: { ref: "policy-1", maximumRpoSeconds: 60, maximumRtoSeconds: 240 },
      }),
    ).toMatchObject({
      status: "PASS",
      rpoObservedSeconds: 30,
      rtoObservedSeconds: 180,
      rtoEndedAt: "2026-09-05T00:13:00Z",
      databaseStartupIsTerminal: false,
    }));
  it("preserves measurements but blocks an absent policy and fails exceeded targets", () => {
    const base = {
      backupCompletedAt: "2026-09-05T00:00:00Z",
      faultDeclaredAt: "2026-09-05T00:10:00Z",
      lastConfirmedRecoverableCommitAt: "2026-09-05T00:09:00Z",
      databaseRestoredAt: "2026-09-05T00:11:00Z",
      verificationCompletedAt: "2026-09-05T00:12:00Z",
      serviceRestoredAt: "2026-09-05T00:14:00Z",
    };
    expect(measureRecovery008({ ...base, policy: null })).toMatchObject({
      status: "BLOCKED_INPUT",
      rpoObservedSeconds: 60,
      rtoObservedSeconds: 240,
    });
    expect(
      measureRecovery008({
        ...base,
        policy: { ref: "strict", maximumRpoSeconds: 30, maximumRtoSeconds: 120 },
      }),
    ).toMatchObject({ status: "FAIL", reasonCodes: ["RPO_EXCEEDED", "RTO_EXCEEDED"] });
  });
  it("blocks absent, synthetic or incomplete corporate IN-08", () => {
    expect(evaluateCorporateRecoveryInputs008(null)).toMatchObject({ status: "BLOCKED_INPUT" });
    expect(
      evaluateCorporateRecoveryInputs008({
        entries: [{ id: "IN-08", synthetic: true, metadata: {} }],
      }),
    ).toMatchObject({ status: "BLOCKED_INPUT" });
    expect(
      evaluateCorporateRecoveryInputs008({
        entries: [{ id: "IN-08", synthetic: false, metadata: { backupMethod: "PHYSICAL_PITR" } }],
      }),
    ).toMatchObject({
      status: "BLOCKED_INPUT",
      reasonCodes: expect.arrayContaining(["RECOVERY_INPUT_MISSING:targetId"]),
    });
  });
});
