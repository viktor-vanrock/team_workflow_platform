import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  verifyFeature003HandoffReport,
  writeFeature003ReportAtomic,
} from "./feature-003-evidence-lib.mts";

const workspace = resolve(import.meta.dirname, "../..");
const reportPath = resolve(workspace, "reports/003-jira-operational-authority/final-gate.json");

if (!existsSync(reportPath)) {
  console.error(`[evidence:003] FINAL_REPORT_MISSING: ${reportPath}`);
  process.exit(1);
}

let report: Readonly<Record<string, unknown>>;
try {
  report = JSON.parse(readFileSync(reportPath, "utf8")) as Readonly<Record<string, unknown>>;
} catch (error) {
  console.error(
    `[evidence:003] FINAL_REPORT_INVALID: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}

const verification = verifyFeature003HandoffReport({ workspace, report });
if (verification.status === "PASS") {
  console.log(`[evidence:003] PASS; task/runtime/report hashes match ${reportPath}`);
  process.exit(0);
}

const previousStatus = String(report.status);
const previousHandoff =
  report.handoff !== null && typeof report.handoff === "object"
    ? (report.handoff as Readonly<Record<string, unknown>>)
    : {};
const invalidated = {
  ...report,
  status: "FAIL",
  handoff: { ...previousHandoff, status: "INVALIDATED" },
  invalidation: {
    invalidatedAt: new Date().toISOString(),
    previousStatus,
    reasonCodes: verification.failures.map(({ code }) => code),
    failures: verification.failures,
  },
};
writeFeature003ReportAtomic(workspace, reportPath, invalidated);
for (const failure of verification.failures) {
  console.error(`[evidence:003] ${failure.code}: ${failure.detail}`);
}
console.error(`[evidence:003] FAIL; stale PASS invalidated in ${reportPath}`);
process.exit(1);
