import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { stringifyPortableJson } from "./portable-json.mts";

const workspace = resolve(import.meta.dirname, "../..");
const specPath = resolve(workspace, "specs/004-mattermost-hermes-intake/spec.md");
const tasksPath = resolve(workspace, "specs/004-mattermost-hermes-intake/tasks.md");
const reportPath = resolve(workspace, "reports/004-mattermost-hermes-intake/traceability.json");
const args = process.argv.slice(2).filter((value) => value !== "--");
const scenarioIndex = args.indexOf("--scenario");
const scenario = scenarioIndex >= 0 ? args[scenarioIndex + 1] : undefined;
const unexpected = args.filter(
  (value, index) => value !== "--scenario" && index !== scenarioIndex + 1,
);
if (scenarioIndex >= 0 && !scenario) throw new Error("--scenario requires a value");
if (unexpected.length > 0) throw new Error(`Unknown trace:004 arguments: ${unexpected.join(" ")}`);

const spec = readFileSync(specPath, "utf8");
const tasks = readFileSync(tasksPath, "utf8");
const taskRows = [...tasks.matchAll(/^- \[([ xX])\] (T\d{3})\b/gmu)];
const taskStatus = new Map(taskRows.map((match) => [match[2]!, match[1]!.toLowerCase() === "x"]));
const declared = new Set([...spec.matchAll(/\b((?:FR|SC)-\d{3})\b/gu)].map((match) => match[1]!));
const required = [
  ...Array.from({ length: 25 }, (_, index) => `FR-${String(index + 1).padStart(3, "0")}`),
  ...Array.from({ length: 7 }, (_, index) => `SC-${String(index + 1).padStart(3, "0")}`),
];

const evidenceGroups = Object.freeze({
  connector: [
    "tests/contract/004/mattermost-connector-conformance.spec.ts",
    "tests/integration/security/004/connector-hardening.spec.ts",
    "tests/integration/security/004/isolation-hardening.spec.ts",
  ],
  bootstrap: [
    "tests/contract/004/us1-bootstrap-project-selection.spec.ts",
    "tests/integration/security/004/us1-bootstrap-authorization.spec.ts",
    "tests/e2e/004-us1-guided-intake.spec.ts",
  ],
  candidate: [
    "tests/contract/004/us2-candidate.spec.ts",
    "tests/integration/004/us2-candidate-decisions.spec.ts",
    "tests/e2e/004-us2-candidate-decisions.spec.ts",
  ],
  hermes: [
    "tests/contract/004/us3-hermes-skills.spec.ts",
    "tests/integration/004/us3-agent-run.spec.ts",
    "tests/integration/security/004/us3-prompt-boundary.spec.ts",
    "tests/e2e/004-us3-hermes-proposals.spec.ts",
  ],
  notification: [
    "tests/contract/004/us4-notification-delivery.spec.ts",
    "tests/integration/004/us4-notification-recovery.spec.ts",
    "tests/integration/security/004/us4-no-blind-resend.spec.ts",
    "tests/e2e/004-us4-notification-outage.spec.ts",
  ],
  audit: [
    "tests/integration/security/004/audit-lineage.spec.ts",
    "tests/e2e/004-mattermost-hermes-intake.spec.ts",
  ],
} as const);

function evidenceFor(id: string): readonly string[] {
  if (id.startsWith("SC-")) {
    const value = Number(id.slice(3));
    return value <= 3
      ? evidenceGroups.candidate
      : value <= 5
        ? evidenceGroups.notification
        : value === 6
          ? evidenceGroups.audit
          : evidenceGroups.hermes;
  }
  const value = Number(id.slice(3));
  if (value <= 5) return evidenceGroups.connector;
  if (value <= 10) return evidenceGroups.bootstrap;
  if (value <= 15) return evidenceGroups.candidate;
  if (value <= 21) return evidenceGroups.hermes;
  return evidenceGroups.notification;
}

function tasksFor(id: string): readonly string[] {
  const value = Number(id.slice(3));
  if (id.startsWith("SC-"))
    return value <= 2
      ? ["T095", "T119"]
      : value === 3
        ? ["T120", "T140"]
        : value === 4
          ? ["T146", "T169"]
          : value === 5
            ? ["T170", "T192"]
            : ["T193", "T215"];
  if (value <= 5) return ["T016", "T094"];
  if (value <= 10) return ["T095", "T119"];
  if (value <= 15) return ["T120", "T140"];
  if (value <= 21) return ["T141", "T169"];
  return ["T170", "T192"];
}

const entries = required.map((id) => {
  const evidence = evidenceFor(id);
  const mappedTasks = tasksFor(id);
  const missingEvidence = evidence.filter((path) => !existsSync(resolve(workspace, path)));
  const missingTasks = mappedTasks.filter((task) => !taskStatus.has(task));
  const pendingTasks = mappedTasks.filter((task) => taskStatus.get(task) === false);
  const status =
    missingEvidence.length === 0 && missingTasks.length === 0 && pendingTasks.length === 0
      ? "PASS"
      : "FAIL";
  return {
    id,
    kind: id.startsWith("FR-") ? "requirement" : "success-criterion",
    tasks: mappedTasks,
    evidence,
    status,
    missingEvidence,
    missingTasks,
    pendingTasks,
  };
});

const evidenceReportNames = [
  "prerequisites.json",
  "setup-gate.json",
  "foundation.json",
  "us1.json",
  "us2.json",
  "us3.json",
  "us4.json",
  "migrations.json",
  "smoke.json",
  "quickstart.json",
  "nonprod-metadata.json",
  "nonprod.json",
] as const;
const taskMtimeMs = statSync(tasksPath).mtimeMs;
const evidenceReports = evidenceReportNames.map((name) => {
  const path = resolve(workspace, "reports/004-mattermost-hermes-intake", name);
  if (!existsSync(path)) return { name, status: "FAIL", evidenceStatus: "MISSING", fresh: false };
  let report: Readonly<Record<string, unknown>>;
  try {
    report = JSON.parse(readFileSync(path, "utf8")) as Readonly<Record<string, unknown>>;
  } catch {
    return { name, status: "FAIL", evidenceStatus: "INVALID_JSON", fresh: false };
  }
  const evidenceStatus = String(report.status);
  const timestamp = [report.finishedAt, report.generatedAt, report.startedAt].find(
    (value) => typeof value === "string",
  );
  const fresh = typeof timestamp === "string" && Date.parse(timestamp) >= taskMtimeMs;
  const accepted =
    name === "nonprod-metadata.json" || name === "nonprod.json"
      ? ["PASS", "SKIPPED_GATED"].includes(evidenceStatus)
      : evidenceStatus === "PASS";
  return { name, status: accepted && fresh ? "PASS" : "FAIL", evidenceStatus, fresh, timestamp };
});

let scenarioResult: "PASS" | "FAIL" | "NOT_REQUESTED" = "NOT_REQUESTED";
if (scenario) {
  const dispatcher = readFileSync(
    resolve(workspace, "tools/local/mattermost-scenario-catalog.mts"),
    "utf8",
  );
  scenarioResult = dispatcher.includes(`"${scenario}"`) ? "PASS" : "FAIL";
}
const missingDeclared = required.filter((id) => !declared.has(id));
const unexpectedDeclared = [...declared].filter((id) => !required.includes(id));
const status =
  missingDeclared.length === 0 &&
  unexpectedDeclared.length === 0 &&
  entries.every((entry) => entry.status === "PASS") &&
  evidenceReports.every((entry) => entry.status === "PASS") &&
  scenarioResult !== "FAIL"
    ? "PASS"
    : "FAIL";
const report = {
  schemaVersion: 1,
  feature: "004-mattermost-hermes-intake",
  gate: "traceability",
  generatedAt: new Date().toISOString(),
  status,
  scenario: scenario ? { name: scenario, status: scenarioResult } : null,
  summary: {
    required: required.length,
    declared: declared.size,
    passed: entries.filter((entry) => entry.status === "PASS").length,
    failed: entries.filter((entry) => entry.status === "FAIL").length,
    missingDeclared,
    unexpectedDeclared,
  },
  taskSource: {
    path: "specs/004-mattermost-hermes-intake/tasks.md",
    declaredTasks: taskStatus.size,
    completedTasks: [...taskStatus.values()].filter(Boolean).length,
    pendingTasks: [...taskStatus.values()].filter((value) => !value).length,
  },
  entries,
  evidenceReports,
};
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, stringifyPortableJson(report, workspace), "utf8");
console.log(
  `[trace:004] ${status}; FR=${entries.filter(({ kind, status: entryStatus }) => kind === "requirement" && entryStatus === "PASS").length}/25; SC=${entries.filter(({ kind, status: entryStatus }) => kind === "success-criterion" && entryStatus === "PASS").length}/7; report: ${reportPath}`,
);
if (status === "FAIL") process.exitCode = 1;
