import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { stringifyPortableJson } from "./portable-json.mts";

const workspace = resolve(import.meta.dirname, "../..");
const feature = "007-project-onboarding-evidence-security";
const specPath = resolve(workspace, `specs/${feature}/spec.md`);
const tasksPath = resolve(workspace, `specs/${feature}/tasks.md`);
const reportDirectory = resolve(workspace, `reports/${feature}`);
const reportPath = resolve(reportDirectory, "traceability.json");
const planOnly = process.argv
  .slice(2)
  .filter((value) => value !== "--")
  .includes("--plan");
const unknown = process.argv.slice(2).filter((value) => value !== "--" && value !== "--plan");
if (unknown.length > 0) throw new Error(`Unknown trace:007 arguments: ${unknown.join(", ")}`);
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
  ...Array.from({ length: 28 }, (_, index) => `FR-007-${String(index + 1).padStart(3, "0")}`),
  "FR-007-006A",
  "FR-007-006B",
  ...Array.from({ length: 5 }, (_, index) => `SEC-007-${String(index + 1).padStart(3, "0")}`),
  ...Array.from({ length: 5 }, (_, index) => `SC-007-${String(index + 1).padStart(3, "0")}`),
]);
const declared = new Set(
  [...spec.matchAll(/\b((?:FR|SEC|SC)-007-\d{3}[AB]?)\b/gu)].map((match) => match[1]!),
);
const groups = Object.freeze({
  scope: Object.freeze({
    tasks: ["T027", "T030", "T062", "T119"],
    reports: ["foundation.json", "us3.json", "security.json"],
    evidence: [
      "tests/unit/007/us3-authorization-policy.spec.ts",
      "tests/integration/security/007/us3-read-surface-isolation.spec.ts",
      "tests/integration/security/007/us3-side-channel.spec.ts",
    ],
  }),
  binding: Object.freeze({
    tasks: ["T031", "T043", "T056", "T088"],
    reports: ["foundation.json", "us1.json", "us2.json", "concurrency.json"],
    evidence: [
      "tests/integration/007/us1-manual-binding.spec.ts",
      "tests/integration/007/us2-binding-version-history.spec.ts",
      "tests/contract/007/platform-actions.spec.ts",
    ],
  }),
  resources: Object.freeze({
    tasks: ["T034", "T048", "T054", "T104"],
    reports: ["us1.json", "us3.json", "security.json"],
    evidence: [
      "tests/integration/007/us1-project-resources.spec.ts",
      "tests/integration/007/us1-account-leases.spec.ts",
      "tests/integration/security/007/us3-evidence-artifact-isolation.spec.ts",
    ],
  }),
  evidence: Object.freeze({
    tasks: ["T035", "T049", "T120", "T145"],
    reports: ["us4.json", "security.json", "concurrency.json"],
    evidence: [
      "tests/contract/007/us4-evidence-manifest.spec.ts",
      "tests/unit/007/us4-evidence-signature.spec.ts",
      "tests/integration/007/us4-evidence-signing-uow.spec.ts",
      "tests/integration/security/007/us4-evidence-export.spec.ts",
    ],
  }),
  modes: Object.freeze({
    tasks: ["T057", "T074", "T088"],
    reports: ["us1.json", "us2.json"],
    evidence: [
      "tests/unit/007/us1-capability-mode.spec.ts",
      "tests/unit/007/us2-full-qa-mode.spec.ts",
      "tests/integration/007/us2-automated-session-guards.spec.ts",
    ],
  }),
  suspension: Object.freeze({
    tasks: ["T146", "T158", "T162", "T167"],
    reports: ["us5.json", "security.json", "recovery.json"],
    evidence: [
      "tests/integration/security/007/us5-effect-guard-race.spec.ts",
      "tests/integration/security/007/us5-investigation-access.spec.ts",
      "tests/integration/007/us5-resume-approval.spec.ts",
    ],
  }),
  aggregate: Object.freeze({
    tasks: ["T168", "T169", "T170", "T171", "T175", "T176", "T180"],
    reports: [
      "migrations-postgres-17.json",
      "migrations-postgres-18.json",
      "integration.json",
      "security.json",
      "recovery.json",
      "browser.json",
      "smoke.json",
    ],
    evidence: [
      "tests/integration/007/migration-matrix.spec.ts",
      "tests/e2e/007/project-onboarding-browser.spec.ts",
      "tools/smoke/feature-007.mts",
    ],
  }),
});
type Group = (typeof groups)[keyof typeof groups];
function mapping(id: string): Group {
  if (id.startsWith("SEC-"))
    return id === "SEC-007-004"
      ? groups.evidence
      : id === "SEC-007-005"
        ? groups.scope
        : groups.aggregate;
  if (id.startsWith("SC-")) {
    const number = Number(id.slice(-3));
    return number === 1
      ? groups.binding
      : number === 2
        ? groups.scope
        : number === 3 || number === 4
          ? groups.evidence
          : groups.suspension;
  }
  if (id === "FR-007-006A" || id === "FR-007-006B") return groups.binding;
  const number = Number(id.slice(-3));
  return number <= 5
    ? groups.scope
    : number <= 11
      ? groups.binding
      : number <= 16
        ? groups.resources
        : number <= 23
          ? groups.evidence
          : number <= 25
            ? groups.modes
            : groups.suspension;
}
function reportEvidence(name: string) {
  const file = resolve(reportDirectory, name);
  if (!existsSync(file)) return Object.freeze({ name, status: "MISSING", fresh: false });
  const bytes = readFileSync(file);
  const report = JSON.parse(bytes.toString("utf8")) as Readonly<Record<string, unknown>>;
  const timestamp = [report.finishedAt, report.generatedAt, report.startedAt].find(
    (value) => typeof value === "string",
  ) as string | undefined;
  const fresh = Boolean(timestamp && Date.now() - Date.parse(timestamp) <= 24 * 60 * 60_000);
  return Object.freeze({
    name,
    status: String(report.status ?? "INVALID"),
    fresh,
    sha256: digest(bytes),
  });
}
const entries = required.map((id) => {
  const selected = mapping(id);
  const missingTasks = selected.tasks.filter((task) => !taskStatus.has(task));
  const pendingTasks = selected.tasks.filter((task) => taskStatus.get(task) === false);
  const missingEvidence = selected.evidence.filter((file) => !existsSync(resolve(workspace, file)));
  const reports = selected.reports.map(reportEvidence);
  const failedReports = reports
    .filter(({ status, fresh }) => status !== "PASS" || !fresh)
    .map(({ name }) => name);
  return Object.freeze({
    id,
    kind: id.startsWith("FR-")
      ? "requirement"
      : id.startsWith("SEC-")
        ? "security-requirement"
        : "success-criterion",
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
const counts = Object.freeze({
  fr: entries.filter(({ id, status: value }) => id.startsWith("FR-") && value === "PASS").length,
  sec: entries.filter(({ id, status: value }) => id.startsWith("SEC-") && value === "PASS").length,
  sc: entries.filter(({ id, status: value }) => id.startsWith("SC-") && value === "PASS").length,
});
if (planOnly) {
  console.log(
    `[trace:007:plan] ${status}; FR=${counts.fr}/30; SEC=${counts.sec}/5; SC=${counts.sc}/5`,
  );
  process.exitCode = status === "PASS" ? 0 : 1;
} else {
  const report = Object.freeze({
    schemaVersion: 1,
    feature,
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
      counts,
    }),
    entries,
    sourceBinding: Object.freeze({ spec: digest(spec), tasks: digest(tasks) }),
  });
  mkdirSync(dirname(reportPath), { recursive: true });
  const temporary = `${reportPath}.${process.pid}.tmp`;
  writeFileSync(temporary, stringifyPortableJson(report, workspace), "utf8");
  renameSync(temporary, reportPath);
  console.log(
    `[trace:007] ${status}; FR=${counts.fr}/30; SEC=${counts.sec}/5; SC=${counts.sc}/5; report: ${reportPath}`,
  );
  if (status !== "PASS") process.exitCode = 1;
}
