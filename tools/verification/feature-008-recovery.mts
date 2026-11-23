import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  FEATURE_008,
  record,
  ROOT_008,
  safeFile,
  write008Json,
} from "./feature-008-prerequisites.mts";
import {
  currentFingerprints008,
  evidenceRef008,
  type GateReport008,
  writeGateReport008,
} from "./feature-008-reports.mts";

export function evaluateCorporateRecoveryInputs008(value: unknown) {
  if (!record(value))
    return Object.freeze({
      status: "BLOCKED_INPUT" as const,
      reasonCodes: Object.freeze(["RECOVERY_INPUT_PACKAGE_MISSING"]),
    });
  const entries = Array.isArray(value.entries) ? value.entries : [],
    entry = entries.find((item) => record(item) && item.id === "IN-08");
  if (!record(entry) || entry.synthetic === true || !record(entry.metadata))
    return Object.freeze({
      status: "BLOCKED_INPUT" as const,
      reasonCodes: Object.freeze(["RECOVERY_IN08_MISSING"]),
    });
  const metadata = entry.metadata,
    required = [
      "backupMethod",
      "destinationRef",
      "recoveryPolicyRef",
      "fencePolicyRef",
      "restoreOwner",
      "targetId",
      "maximumRpoSeconds",
      "maximumRtoSeconds",
      "oldRuntimeFenceProofRef",
    ],
    missing = required.filter(
      (key) => metadata[key] === undefined || metadata[key] === null || metadata[key] === "",
    );
  if (
    metadata.backupMethod !== "PHYSICAL_PITR" ||
    typeof metadata.maximumRpoSeconds !== "number" ||
    metadata.maximumRpoSeconds < 0 ||
    typeof metadata.maximumRtoSeconds !== "number" ||
    metadata.maximumRtoSeconds <= 0
  )
    missing.push("approvedPhysicalPolicy");
  return Object.freeze({
    status: missing.length ? ("BLOCKED_INPUT" as const) : ("PASS" as const),
    reasonCodes: Object.freeze([...new Set(missing.map((key) => `RECOVERY_INPUT_MISSING:${key}`))]),
  });
}
async function run(): Promise<void> {
  const args = process.argv.slice(2).filter((value) => value !== "--"),
    inputPath = args[0] === "--input" && args.length === 2 ? args[1] : undefined;
  if (args.length && inputPath === undefined) throw new Error("RECOVERY_ARGUMENT_INVALID");
  const startedAt = new Date().toISOString(),
    fingerprints = currentFingerprints008(),
    scope = { workspaceId: "fixture-workspace-alpha", projectIds: ["fixture-project-web"] };
  let value: unknown = null;
  try {
    if (inputPath)
      value = JSON.parse(readFileSync(safeFile(ROOT_008, inputPath), "utf8")) as unknown;
  } catch {
    /* missing input remains blocked */
  }
  const evaluation = evaluateCorporateRecoveryInputs008(value),
    reasonCodes =
      evaluation.status === "PASS" ? ["CORPORATE_DRILL_RESULT_REQUIRED"] : evaluation.reasonCodes,
    runId = `recovery-${randomUUID()}`,
    evidencePath = `reports/${FEATURE_008}/evidence/${runId}/corporate-recovery-inputs.json`;
  write008Json(evidencePath, {
    inputPath: inputPath ?? null,
    evaluation,
    execution: "NOT_STARTED_WITHOUT_APPROVED_IN08",
  });
  const report: GateReport008 = {
    schemaVersion: 1,
    feature: FEATURE_008,
    runId,
    gate: "recovery",
    status: "BLOCKED_INPUT",
    deploymentProfile: "pilot",
    scope,
    startedAt,
    finishedAt: new Date().toISOString(),
    fingerprints,
    executorIdentity: "local-cli",
    checks: [
      {
        id: "approved-recovery-inputs",
        status: "BLOCKED_INPUT",
        evidence: [evidenceRef008(ROOT_008, evidencePath)],
        reasonCodes,
      },
    ],
    prerequisites: [],
    reasonCodes,
  };
  const ref = writeGateReport008(ROOT_008, report, {
    now: Date.now(),
    maximumAgeMs: 3_600_000,
    scope,
    fingerprints,
    allowedExecutors: ["local-cli"],
  });
  write008Json(`reports/${FEATURE_008}/recovery.json`, {
    status: report.status,
    report: ref,
    corporateExecution: "BLOCKED_INPUT",
  });
  console.log(`[verify:008:recovery] ${report.status}; report=${ref.path}`);
  process.exitCode = 1;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  await run();
