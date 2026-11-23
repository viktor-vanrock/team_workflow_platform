import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

import {
  acceptedFeature004EvidenceStatus,
  captureFeature004HandoffSnapshot,
  FEATURE_004_AUTHORITATIVE_EVIDENCE,
  isJsonRecord,
  readSafeJsonReport,
  sha256File,
  verifyFeature004FinalReport,
  writeFeature004ReportAtomic,
} from "./feature-004-evidence-lib.mts";

const workspace = resolve(import.meta.dirname, "../..");
const reportsDirectory = resolve(workspace, "reports/004-mattermost-hermes-intake");
const evidencePath = resolve(reportsDirectory, "evidence.json");
const finalPath = resolve(reportsDirectory, "final-gate.json");
const collect = process.argv.includes("--collect");
const unexpected = process.argv.slice(2).filter((value) => value !== "--collect" && value !== "--");
if (unexpected.length > 0)
  throw new Error(`Unknown verify:004:evidence arguments: ${unexpected.join(" ")}`);

if (!collect) {
  if (!existsSync(finalPath)) {
    console.error(`[evidence:004] FINAL_REPORT_MISSING: ${finalPath}`);
    process.exit(1);
  }
  let finalReport: Readonly<Record<string, unknown>>;
  try {
    finalReport = readSafeJsonReport(finalPath);
  } catch (error) {
    console.error(
      `[evidence:004] FINAL_REPORT_INVALID: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
  const verification = verifyFeature004FinalReport(workspace, finalReport);
  if (verification.status === "PASS") {
    console.log(
      `[evidence:004] PASS; task/source/contract/runtime/report hashes match ${finalPath}`,
    );
    process.exit(0);
  }
  const handoff = isJsonRecord(finalReport.handoff) ? finalReport.handoff : {};
  writeFeature004ReportAtomic(workspace, finalPath, {
    ...finalReport,
    status: "FAIL",
    handoff: { ...handoff, status: "INVALIDATED" },
    invalidation: { invalidatedAt: new Date().toISOString(), failures: verification.failures },
  });
  for (const failure of verification.failures)
    console.error(`[evidence:004] ${failure.code}: ${failure.detail}`);
  process.exit(1);
}

const startedAt = new Date();
const snapshot = captureFeature004HandoffSnapshot(workspace);
const tasksMtime = statSync(resolve(workspace, snapshot.taskSnapshot.path)).mtimeMs;
const failures: Array<Readonly<{ code: string; detail: string }>> = [];
const evidence = FEATURE_004_AUTHORITATIVE_EVIDENCE.map((name) => {
  const path = resolve(reportsDirectory, name);
  if (!existsSync(path)) {
    failures.push({ code: "EVIDENCE_MISSING", detail: name });
    return { name, status: "MISSING", fresh: false };
  }
  try {
    const report = readSafeJsonReport(path);
    const status = String(report.status);
    const timestamp = [report.finishedAt, report.generatedAt, report.startedAt].find(
      (value) => typeof value === "string",
    );
    const fresh = typeof timestamp === "string" && Date.parse(timestamp) >= tasksMtime;
    if (!acceptedFeature004EvidenceStatus(name, status))
      failures.push({ code: "EVIDENCE_STATUS_NOT_ACCEPTED", detail: `${name}:${status}` });
    if (!fresh)
      failures.push({
        code: "EVIDENCE_STALE",
        detail: `${name}:${timestamp ?? "MISSING_TIMESTAMP"}`,
      });
    if (
      typeof report.taskSourceHash === "string" &&
      report.taskSourceHash !== snapshot.taskSnapshot.sha256
    )
      failures.push({ code: "EVIDENCE_TASK_HASH_MISMATCH", detail: name });
    return { name, status, fresh, timestamp, sha256: sha256File(path) };
  } catch (error) {
    failures.push({
      code: "EVIDENCE_INVALID",
      detail: `${name}:${error instanceof Error ? error.message : String(error)}`,
    });
    return { name, status: "INVALID", fresh: false };
  }
});
if (snapshot.taskSnapshot.pendingTaskIds.length > 0)
  failures.push({ code: "TASKS_PENDING", detail: snapshot.taskSnapshot.pendingTaskIds.join(",") });
const report = {
  schemaVersion: 1,
  feature: "004-mattermost-hermes-intake",
  gate: "evidence-aggregation",
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  status: failures.length === 0 ? "PASS" : "FAIL",
  evidence,
  failures,
  snapshots: snapshot,
};
writeFeature004ReportAtomic(workspace, evidencePath, report);
console.log(
  `[evidence:004:collect] ${report.status}; evidence=${evidence.length}; report: ${evidencePath}`,
);
if (failures.length > 0) process.exitCode = 1;
