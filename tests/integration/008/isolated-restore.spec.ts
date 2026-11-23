import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  advanceRecoveryFence008,
  assertRecoveryWrite008,
  planRecoveryFence008,
  type RecoveryFence008,
  resumeRecoveryFence008,
} from "../../../packages/runtime-composition/src/recovery/fence.ts";
import { buildBackupManifest008 } from "../../../tools/recovery/008-backup.mts";
import {
  assertIsolatedRestoreTarget008,
  restoreLogicalDump008,
} from "../../../tools/recovery/008-restore.mts";
import { type RecoveryPair008, startRecoveryPair008 } from "../../support/008-recovery-drill.ts";

describe.runIf(process.env.AWP_RUN_CONTAINER_TESTS === "true")(
  "008 actual isolated logical restore",
  () => {
    let pair: RecoveryPair008, restored: ReturnType<typeof restoreLogicalDump008>;
    beforeAll(async () => {
      pair = await startRecoveryPair008();
      restored = restoreLogicalDump008(pair.input);
    }, 120_000);
    afterAll(async () => await pair?.close());
    it("rejects an active target and restores selected durable tables into an isolated fenced database", async () => {
      expect(restored).toMatchObject({
        status: "PASS",
        tables: pair.input.tables,
        targetId: "isolated-drill-008",
        workerEgress: "FENCED",
      });
      expect(restored.dumpBytes).toBeGreaterThan(100);
      expect(
        (
          await pair.target.container.exec([
            "psql",
            "-U",
            "awp_test",
            "-d",
            "awp_test",
            "-At",
            "-c",
            "SELECT count(*) FROM canonical_records",
          ])
        ).stdout.trim(),
      ).toBe("1");
      await pair.target.container.exec([
        "psql",
        "-U",
        "awp_test",
        "-d",
        "awp_test",
        "-c",
        "INSERT INTO recovery_runtime_leases VALUES('active','ACTIVE')",
      ]);
      expect(() => assertIsolatedRestoreTarget008(pair.input)).toThrow(
        "LOGICAL_RESTORE_ACTIVE_TARGET_DENIED",
      );
    });
    it("fences old and new runtimes until a separate exact resume", () => {
      const hash = `sha256:${"a".repeat(64)}`,
        old = "runtime-old",
        fresh = "runtime-restored";
      let fence: RecoveryFence008 = planRecoveryFence008({
        recoveryId: "recovery-1",
        deploymentId: "deployment-1",
        configDigest: hash,
        imageDigest: hash,
        oldRuntimeIds: [old],
      });
      fence = advanceRecoveryFence008(fence, {
        expectedVersion: 1,
        stage: "FENCED",
        evidenceRefs: ["old-fence-proof"],
      });
      fence = advanceRecoveryFence008(fence, {
        expectedVersion: 2,
        stage: "RESTORED",
        newRuntimeId: fresh,
        evidenceRefs: ["restore-proof"],
      });
      for (const stage of ["VERIFIED", "RECONCILED", "READY_FOR_RESUME"] as const)
        fence = advanceRecoveryFence008(fence, {
          expectedVersion: fence.version,
          stage,
          evidenceRefs: [`${stage}-proof`],
        });
      expect(() => assertRecoveryWrite008(fence, old)).toThrow("RECOVERY_WRITE_FENCED");
      expect(() => assertRecoveryWrite008(fence, fresh)).toThrow("RECOVERY_WRITE_FENCED");
      expect(() =>
        resumeRecoveryFence008(fence, {
          expectedVersion: fence.version,
          newRuntimeId: fresh,
          resumeNonce: "wrong",
          approvalRef: "approval",
        }),
      ).toThrow("RECOVERY_RESUME_DENIED");
      fence = resumeRecoveryFence008(fence, {
        expectedVersion: fence.version,
        newRuntimeId: fresh,
        resumeNonce: fence.resumeNonce!,
        approvalRef: "approval",
      });
      expect(() => assertRecoveryWrite008(fence, fresh)).not.toThrow();
      expect(() => assertRecoveryWrite008(fence, old)).toThrow();
    });
    it("creates a scoped secret-free inventory manifest for the actual dump", () => {
      const manifest = buildBackupManifest008({
        backupId: "backup-1",
        sourceDeploymentRef: "deployment-1",
        workspaceId: "workspace-1",
        projectIds: ["project-1"],
        databaseIdentity: "awp_test",
        databaseMajor: 18,
        backupKind: "LOGICAL",
        backupStartedAt: "2026-09-05T00:00:00Z",
        completedAt: "2026-09-05T00:00:01Z",
        consistentRecoveryPoint: "2026-09-05T00:00:00.500Z",
        schemaPins: { core: 185, qa: 2100 },
        inventory: {
          canonical: 1,
          audit: 2,
          delivery: 2,
          configuration: 2,
          publicKeys: 1,
          artifacts: 2,
        },
        auditWatermark: "audit-2",
        effectWatermark: "effect-uncertain",
        protectedLocationRef: "fixture:protected-backup",
        retentionPolicyRef: "fixture:retention",
        dumpDigest: restored.dumpDigest,
        dumpBytes: restored.dumpBytes,
      });
      expect(manifest).toMatchObject({
        backupKind: "LOGICAL",
        inventory: { canonical: 1, artifacts: 2 },
      });
      expect(JSON.stringify(manifest)).not.toMatch(/password|token|secretValue/u);
    });
  },
);
