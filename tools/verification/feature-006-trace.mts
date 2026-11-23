import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { stringifyPortableJson } from "./portable-json.mts";

const workspace = resolve(import.meta.dirname, "../..");
const specPath = resolve(workspace, "specs/006-queue-triage-capacity-sla/spec.md");
const tasksPath = resolve(workspace, "specs/006-queue-triage-capacity-sla/tasks.md");
const reportDirectory = resolve(workspace, "reports/006-queue-triage-capacity-sla");
const reportPath = resolve(reportDirectory, "traceability.json");
const planOnly = process.argv
  .slice(2)
  .filter((value) => value !== "--")
  .includes("--plan");
const unknown = process.argv.slice(2).filter((value) => value !== "--" && value !== "--plan");
if (unknown.length > 0) throw new Error(`Unknown trace:006 arguments: ${unknown.join(", ")}`);
const digest = (value: string | Buffer): `sha256:${string}` =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const spec = readFileSync(specPath, "utf8");
const tasks = readFileSync(tasksPath, "utf8");
const taskStatus = new Map(
  [...tasks.matchAll(/^- \[([ xX])\] (T\d{3})\b/gmu)].map((match) => [
    match[2]!,
    match[1]!.toLowerCase() === "x",
  ]),
);
const required = Object.freeze([
  ...Array.from({ length: 25 }, (_, index) => `FR-${String(index + 1).padStart(3, "0")}`),
  ...Array.from({ length: 7 }, (_, index) => `SC-${String(index + 1).padStart(3, "0")}`),
]);
const declared = new Set([...spec.matchAll(/\b((?:FR|SC)-\d{3})\b/gu)].map((match) => match[1]!));
const groups = Object.freeze({
  foundation: Object.freeze({
    tasks: ["T039", "T048"],
    reports: ["contracts.json", "architecture.json", "unit-matrices.json"],
    evidence: [
      "tests/architecture/006-queue-boundaries.spec.ts",
      "tests/contract/006/design-contracts.spec.ts",
    ],
  }),
  us1: Object.freeze({
    tasks: ["T051", "T069"],
    reports: ["us1.json"],
    evidence: ["tests/unit/006/queue-stage.spec.ts", "tests/e2e/006/us1-distinct-stages.spec.ts"],
  }),
  us2: Object.freeze({
    tasks: ["T070", "T089"],
    reports: ["us2.json"],
    evidence: [
      "tests/unit/006/queue-ordering.spec.ts",
      "tests/e2e/006/us2-project-portfolio.spec.ts",
    ],
  }),
  us3: Object.freeze({
    tasks: ["T090", "T107"],
    reports: ["us3.json"],
    evidence: [
      "tests/contract/006/us3-triage-assessment.spec.ts",
      "tests/e2e/006/us3-triage-controls.spec.ts",
    ],
  }),
  us4: Object.freeze({
    tasks: ["T108", "T133"],
    reports: ["us4.json", "concurrency.json"],
    evidence: [
      "tests/unit/006/capacity-accounting.spec.ts",
      "tests/e2e/006/us4-capacity-expedite.spec.ts",
    ],
  }),
  us5: Object.freeze({
    tasks: ["T134", "T154"],
    reports: ["us5.json"],
    evidence: [
      "tests/unit/006/business-calendar.spec.ts",
      "tests/e2e/006/us5-sla-transparency.spec.ts",
    ],
  }),
  aggregate: Object.freeze({
    tasks: ["T155", "T156", "T157", "T158", "T162", "T163"],
    reports: [
      "migrations-postgres-17.json",
      "migrations-postgres-18.json",
      "security.json",
      "rebuild.json",
      "observability.json",
      "browser.json",
      "smoke.json",
    ],
    evidence: [
      "tests/integration/006-migration-matrix.spec.ts",
      "tests/integration/security/006/production-and-scope-boundary.spec.ts",
      "tests/e2e/006/queue-browser.spec.ts",
      "tools/smoke/feature-006.mts",
    ],
  }),
});
function mapping(id: string) {
  if (id.startsWith("SC-")) {
    const number = Number(id.slice(3));
    return number === 1
      ? groups.us1
      : number === 2
        ? groups.us2
        : number === 3
          ? groups.us3
          : number === 4
            ? groups.us4
            : number === 5
              ? groups.us5
              : groups.aggregate;
  }
  const number = Number(id.slice(3));
  return number <= 4
    ? groups.foundation
    : number <= 9
      ? groups.us1
      : number <= 12
        ? groups.us2
        : number <= 16
          ? groups.us3
          : number <= 21
            ? groups.us4
            : groups.us5;
}
function reportEvidence(name: string) {
  const path = resolve(reportDirectory, name);
  if (!existsSync(path)) return Object.freeze({ name, status: "MISSING", fresh: false });
  const content = readFileSync(path);
  const report = JSON.parse(content.toString("utf8")) as Readonly<Record<string, unknown>>;
  const timestamp = [report.finishedAt, report.generatedAt, report.startedAt].find(
    (value) => typeof value === "string",
  ) as string | undefined;
  const fresh = Boolean(timestamp && Date.now() - Date.parse(timestamp) <= 24 * 60 * 60_000);
  return Object.freeze({
    name,
    status: String(report.status ?? "INVALID"),
    fresh,
    sha256: digest(content),
  });
}
const entries = required.map((id) => {
  const selected = mapping(id);
  const missingTasks = selected.tasks.filter((task) => !taskStatus.has(task));
  const pendingTasks = selected.tasks.filter((task) => taskStatus.get(task) === false);
  const missingEvidence = selected.evidence.filter((path) => !existsSync(resolve(workspace, path)));
  const reports = selected.reports.map(reportEvidence);
  const failedReports = reports
    .filter(({ status, fresh }) => status !== "PASS" || !fresh)
    .map(({ name }) => name);
  return Object.freeze({
    id,
    kind: id.startsWith("FR-") ? "requirement" : "success-criterion",
    tasks: selected.tasks,
    evidence: selected.evidence,
    reports,
    status:
      missingTasks.length === 0 &&
      pendingTasks.length === 0 &&
      missingEvidence.length === 0 &&
      failedReports.length === 0
        ? "PASS"
        : "FAIL",
    missingTasks,
    pendingTasks,
    missingEvidence,
    failedReports,
  });
});
const missingDeclared = required.filter((id) => !declared.has(id));
const unexpectedDeclared = [...declared].filter((id) => !required.includes(id));
const status =
  missingDeclared.length === 0 &&
  unexpectedDeclared.length === 0 &&
  entries.every(({ status: value }) => value === "PASS")
    ? "PASS"
    : "FAIL";
if (planOnly) {
  console.log(
    `[trace:006:plan] ${status}; FR=${entries.filter(({ id, status: value }) => id.startsWith("FR-") && value === "PASS").length}/25; SC=${entries.filter(({ id, status: value }) => id.startsWith("SC-") && value === "PASS").length}/7`,
  );
  process.exitCode = status === "PASS" ? 0 : 1;
} else {
  const report = Object.freeze({
    schemaVersion: 1,
    feature: "006-queue-triage-capacity-sla",
    checkpoint: "TRACEABILITY",
    status,
    generatedAt: new Date().toISOString(),
    summary: Object.freeze({
      required: required.length,
      declared: declared.size,
      passed: entries.filter(({ status: value }) => value === "PASS").length,
      failed: entries.filter(({ status: value }) => value === "FAIL").length,
      missingDeclared,
      unexpectedDeclared,
    }),
    entries,
    sourceBinding: Object.freeze({ spec: digest(spec), tasks: digest(tasks) }),
  });
  mkdirSync(dirname(reportPath), { recursive: true });
  const temporary = `${reportPath}.${process.pid}.tmp`;
  writeFileSync(temporary, stringifyPortableJson(report, workspace), "utf8");
  renameSync(temporary, reportPath);
  console.log(
    `[trace:006] ${status}; FR=${entries.filter(({ id, status: value }) => id.startsWith("FR-") && value === "PASS").length}/25; SC=${entries.filter(({ id, status: value }) => id.startsWith("SC-") && value === "PASS").length}/7; report: ${reportPath}`,
  );
  if (status !== "PASS") process.exitCode = 1;
}
