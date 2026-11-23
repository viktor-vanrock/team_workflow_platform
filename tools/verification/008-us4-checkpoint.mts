import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { delimiter, dirname, resolve } from "node:path";

import { tsImport } from "tsx/esm/api";

import { reconcileRecoveryEffects008 } from "../../packages/runtime-composition/src/recovery/reconcile.ts";
import {
  recoveryAuditHash008,
  verifyRecoveryInventory008,
} from "../../packages/runtime-composition/src/recovery/verify.ts";
import { buildBackupManifest008 } from "../recovery/008-backup.mts";
import { measureRecovery008 } from "../recovery/008-measurements.mts";
import { FEATURE_008, ROOT_008, write008Json } from "./feature-008-prerequisites.mts";
import {
  currentFingerprints008,
  type EvidenceRef008,
  evidenceRef008,
  type GateCheck008,
  type GateReport008,
  readGateReport008,
  writeGateReport008,
} from "./feature-008-reports.mts";

if (process.argv.slice(2).some((value) => value !== "--")) throw new Error("UNKNOWN_US4_ARGUMENT");
const runId = `us4-${randomUUID()}`,
  startedAt = new Date().toISOString(),
  scope = { workspaceId: "fixture-workspace-alpha", projectIds: ["fixture-project-web"] },
  fingerprints = currentFingerprints008(),
  checks: GateCheck008[] = [],
  prerequisites: EvidenceRef008[] = [];
const options = () => ({
  now: Date.now(),
  maximumAgeMs: 3_600_000,
  scope,
  fingerprints,
  allowedExecutors: ["local-cli"],
});
const check = (id: string, passed: boolean, evidence: unknown): void => {
  const path = `reports/${FEATURE_008}/evidence/${runId}/${id}.json`;
  write008Json(path, evidence);
  checks.push({
    id,
    status: passed ? "PASS" : "FAIL",
    evidence: [evidenceRef008(ROOT_008, path)],
    reasonCodes: passed ? [] : ["US4_CHECK_FAILED"],
  });
  console.log(`[us4:008] ${id}: ${passed ? "PASS" : "FAIL"}`);
};
try {
  const summary = JSON.parse(
    readFileSync(resolve(ROOT_008, `reports/${FEATURE_008}/foundation.json`), "utf8"),
  ) as { report: EvidenceRef008 };
  const report = readGateReport008(ROOT_008, summary.report, options());
  if (report.gate !== "foundation" || report.status !== "PASS")
    throw new Error("FOUNDATION_REQUIRED");
  prerequisites.push(summary.report);
  check("foundation-prerequisite", true, { report: summary.report });
} catch (error) {
  check("foundation-prerequisite", false, {
    reasonCode: error instanceof Error ? error.message : "FOUNDATION_REQUIRED",
  });
}
if (prerequisites.length) {
  const args = [
      "node_modules/vitest/vitest.mjs",
      "run",
      "tests/integration/008/isolated-restore.spec.ts",
      "tests/integration/008/post-backup-effects.spec.ts",
      "tests/integration/008/restored-evidence.spec.ts",
      "tests/unit/008/recovery-pitr-and-measurements.spec.ts",
      "tests/unit/008/recovery-evidence-api.spec.ts",
      "--maxWorkers=1",
    ],
    environment = {
      ...process.env,
      CI: "true",
      AWP_RUN_CONTAINER_TESTS: "true",
      PATH: [dirname(process.execPath), process.env.PATH].filter(Boolean).join(delimiter),
    },
    result = spawnSync(process.execPath, args, {
      cwd: ROOT_008,
      env: environment,
      encoding: "utf8",
      timeout: 300_000,
      maxBuffer: 5_000_000,
    }),
    output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  process.stdout.write(output);
  check("recovery-suite", result.status === 0 && !result.error, {
    command: args,
    exitCode: result.status,
    output,
  });
  const { runLocalRestoreDrill008 } = (await tsImport(
      "../../tests/support/008-recovery-drill.ts",
      import.meta.url,
    )) as typeof import("../../tests/support/008-recovery-drill.ts"),
    drill = await runLocalRestoreDrill008();
  check(
    "actual-isolated-restore",
    drill.restore.status === "PASS" &&
      drill.restore.workerEgress === "FENCED" &&
      drill.targetIdentityChecked &&
      drill.activeTargetRejected &&
      JSON.stringify(drill.counts) ===
        JSON.stringify({ canonical: 1, commands: 2, audit: 2, keys: 1, artifacts: 2 }),
    drill,
  );
  const backup = buildBackupManifest008({
    backupId: `backup-${runId}`,
    sourceDeploymentRef: "fixture:development-deployment",
    workspaceId: scope.workspaceId,
    projectIds: scope.projectIds,
    databaseIdentity: "awp_test",
    databaseMajor: 18,
    backupKind: "LOGICAL",
    backupStartedAt: startedAt,
    completedAt: new Date().toISOString(),
    consistentRecoveryPoint: startedAt,
    schemaPins: { core: 185, qa: 2100, jira: 3050, gitlab: 4020 },
    inventory: {
      canonical: drill.counts.canonical ?? 0,
      audit: drill.counts.audit ?? 0,
      delivery: drill.counts.commands ?? 0,
      configuration: 4,
      publicKeys: drill.counts.keys ?? 0,
      artifacts: drill.counts.artifacts ?? 0,
    },
    auditWatermark: "audit-2",
    effectWatermark: "effect-uncertain",
    protectedLocationRef: "fixture:isolated-memory-dump",
    retentionPolicyRef: "fixture:development-retention",
    dumpDigest: drill.restore.dumpDigest,
    dumpBytes: drill.restore.dumpBytes,
  });
  check(
    "backup-manifest",
    backup.inventory.canonical === 1 && backup.inventoryHashes.audit.startsWith("sha256:"),
    backup,
  );
  const reconciliation = await reconcileRecoveryEffects008(
    [
      {
        commandId: "command-1",
        provider: "JIRA",
        effectKey: "effect-before-backup",
        certainty: "CONFIRMED_APPLIED",
        outboxState: "CONFIRMED",
      },
      {
        commandId: "command-2",
        provider: "JIRA",
        effectKey: "effect-uncertain",
        certainty: "POSSIBLY_APPLIED",
        outboxState: "DISPATCHED",
      },
    ],
    ["effect-after-backup"],
    {
      lookup: async (effectKey) => ({
        effectKey,
        state: "MATCH",
        definitive: true,
        observedVersion: "jira-43",
      }),
    },
  );
  check(
    "post-backup-reconciliation",
    reconciliation.providerWriteCount === 0 &&
      reconciliation.providerReadCount === 1 &&
      reconciliation.unresolvedEffects.includes("effect-after-backup") &&
      reconciliation.actions.some(
        (action) => action.effectKey === "effect-uncertain" && action.action === "CONFIRM",
      ),
    reconciliation,
  );
  const first = { id: "audit-1", previousHash: null, body: { action: "created" } },
    firstHash = recoveryAuditHash008(first.id, first.previousHash, first.body),
    integrity = verifyRecoveryInventory008({
      schemaPins: { core: 185, qa: 2100 },
      expectedSchemaPins: { core: 185, qa: 2100 },
      bindings: [{ id: "jira", expectedHash: "binding", actualHash: "binding" }],
      audit: [{ ...first, contentHash: firstHash }],
      signatures: [
        { id: "signature-v1", publicKeyRef: "public-key-v1", status: "VALID" },
        { id: "signature-v2", publicKeyRef: "public-key-v2", status: "VALID" },
      ],
      artifacts: [
        {
          id: "required",
          required: true,
          state: "AVAILABLE",
          metadataHash: "metadata",
          bytesHash: "bytes",
        },
        { id: "expired", required: false, state: "EXPIRED", metadataHash: "expired-metadata" },
      ],
      secretStoreOwnerEvidenceRef: "fixture:secret-owner",
    });
  const measurements = measureRecovery008({
    backupCompletedAt: startedAt,
    faultDeclaredAt: new Date(Date.parse(startedAt) + 1_000).toISOString(),
    lastConfirmedRecoverableCommitAt: startedAt,
    databaseRestoredAt: new Date(Date.parse(startedAt) + 2_000).toISOString(),
    verificationCompletedAt: new Date(Date.parse(startedAt) + 3_000).toISOString(),
    serviceRestoredAt: new Date(Date.parse(startedAt) + 4_000).toISOString(),
    policy: {
      ref: "fixture:development-recovery-policy",
      maximumRpoSeconds: 5,
      maximumRtoSeconds: 10,
    },
  });
  check(
    "integrity-and-measurements",
    integrity.status === "PASS" &&
      measurements.status === "PASS" &&
      !measurements.databaseStartupIsTerminal,
    { integrity, measurements, corporatePolicy: "BLOCKED_INPUT" },
  );
}
const unchanged = JSON.stringify(currentFingerprints008()) === JSON.stringify(fingerprints);
check("unchanged-source", unchanged, { fingerprints });
const failed = checks.some((item) => item.status !== "PASS"),
  report: GateReport008 = {
    schemaVersion: 1,
    feature: FEATURE_008,
    runId,
    gate: "us4",
    status: failed ? "FAIL" : "PASS",
    deploymentProfile: "local",
    scope,
    startedAt,
    finishedAt: new Date().toISOString(),
    fingerprints,
    executorIdentity: "local-cli",
    checks,
    prerequisites,
    reasonCodes: failed ? ["US4_FAILED"] : [],
  };
const ref = writeGateReport008(ROOT_008, report, options());
write008Json(`reports/${FEATURE_008}/us4.json`, {
  status: report.status,
  report: ref,
  mode: "DEVELOPMENT_MOCKS",
  corporateRecovery: "BLOCKED_INPUT",
});
console.log(
  `[verify:008:us4] local=${report.status}; corporateRecovery=BLOCKED_INPUT; report=${ref.path}`,
);
if (failed) process.exitCode = 1;
