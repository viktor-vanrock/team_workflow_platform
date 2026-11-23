import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { gitLabDocumentedScenarioNames } from "../local/gitlab-scenario-catalog.mts";
import {
  acceptedFeature005EvidenceStatus,
  captureFeature005HandoffSnapshot,
  readFeature005Report,
  sha256Feature005File,
  verifyFeature005SourceBinding,
} from "./feature-005-evidence-lib.mts";
import { stringifyPortableJson } from "./portable-json.mts";

const workspace = resolve(import.meta.dirname, "../..");
const specPath = resolve(workspace, "specs/005-gitlab-automated-validation/spec.md");
const tasksPath = resolve(workspace, "specs/005-gitlab-automated-validation/tasks.md");
const reportPath = resolve(workspace, "reports/005-gitlab-automated-validation/traceability.json");
const flags = new Set(process.argv.slice(2).filter((value) => value !== "--"));
const unknown = [...flags].filter((value) => value !== "--plan");
if (unknown.length > 0) throw new Error(`Unknown trace:005 arguments: ${unknown.join(", ")}`);

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
const evidenceGroups = Object.freeze({
  foundation: Object.freeze([
    "tests/contract/005/design-contracts.spec.ts",
    "tests/contract/005/gitlab-connector-conformance.spec.ts",
    "tests/integration/security/005/production-boundary.spec.ts",
  ]),
  us1: Object.freeze([
    "tests/contract/005/us1-availability-suite-session.spec.ts",
    "tests/integration/005/us1-automated-session.spec.ts",
    "tests/e2e/005-us1-automated-session.spec.ts",
  ]),
  us2: Object.freeze([
    "tests/contract/005/us2-trigger-contract.spec.ts",
    "tests/integration/005/us2-trigger-once.spec.ts",
    "tests/integration/security/005/us2-launch-boundary.spec.ts",
    "tests/e2e/005-us2-trigger-once.spec.ts",
  ]),
  us3: Object.freeze([
    "tests/contract/005/us3-gitlab-result-artifact-conformance.spec.ts",
    "tests/integration/005/us3-result-retry-review.spec.ts",
    "tests/integration/security/005/artifact-access.spec.ts",
    "tests/e2e/005-us3-technical-result-review.spec.ts",
  ]),
  us4: Object.freeze([
    "tests/integration/security/005/webhook-ingress.spec.ts",
    "tests/integration/005/us4-outage-reconciliation.spec.ts",
    "tests/e2e/005-us4-outage-recovery.spec.ts",
  ]),
  aggregate: Object.freeze([
    "tests/integration/security/005/production-and-scope-boundary.spec.ts",
    "tests/integration/005/observability-slo.spec.ts",
    "tools/smoke/feature-005.mts",
  ]),
});

function mappingFor(
  id: string,
): Readonly<{ tasks: readonly string[]; evidence: readonly string[] }> {
  if (id.startsWith("SC-")) {
    const number = Number(id.slice(3));
    if (number === 1) return { tasks: ["T098"], evidence: evidenceGroups.us2 };
    if (number <= 4) return { tasks: ["T121"], evidence: evidenceGroups.us3 };
    return {
      tasks: ["T137", "T141"],
      evidence: [...evidenceGroups.us4, ...evidenceGroups.aggregate],
    };
  }
  const number = Number(id.slice(3));
  if (number <= 5) return { tasks: ["T016", "T056"], evidence: evidenceGroups.foundation };
  if (number <= 9) return { tasks: ["T057", "T078"], evidence: evidenceGroups.us1 };
  if (number <= 12) return { tasks: ["T079", "T098"], evidence: evidenceGroups.us2 };
  if (number <= 14) return { tasks: ["T122", "T137"], evidence: evidenceGroups.us4 };
  if (number <= 20) return { tasks: ["T099", "T121"], evidence: evidenceGroups.us3 };
  return {
    tasks: ["T099", "T121", "T137"],
    evidence: [...evidenceGroups.us3, ...evidenceGroups.us4],
  };
}

const entries = required.map((id) => {
  const mapping = mappingFor(id);
  const missingTasks = mapping.tasks.filter((task) => !taskStatus.has(task));
  const pendingTasks = mapping.tasks.filter((task) => taskStatus.get(task) === false);
  const missingEvidence = mapping.evidence.filter((path) => !existsSync(resolve(workspace, path)));
  return Object.freeze({
    id,
    kind: id.startsWith("FR-") ? "requirement" : "success-criterion",
    ...mapping,
    status:
      missingTasks.length === 0 && pendingTasks.length === 0 && missingEvidence.length === 0
        ? "PASS"
        : "FAIL",
    missingTasks,
    pendingTasks,
    missingEvidence,
  });
});
const expectedReports = Object.freeze([
  "prerequisites.json",
  "governance.json",
  "setup-gate.json",
  "foundation.json",
  "us1.json",
  "us2.json",
  "us3.json",
  "us4.json",
  "migrations.json",
  "observability.json",
  "documented-scenarios.json",
  "smoke.json",
  "quickstart.json",
  "nonprod-metadata.json",
  "nonprod.json",
]);
const gateStartedAt = process.env.AWP_FEATURE_005_GATE_STARTED_AT
  ? Date.parse(process.env.AWP_FEATURE_005_GATE_STARTED_AT)
  : Date.now() - 24 * 60 * 60_000;
const currentTaskHash = sha256Feature005File(tasksPath);
const evidenceReports = expectedReports.map((name) => {
  const path = resolve(workspace, "reports/005-gitlab-automated-validation", name);
  if (!existsSync(path))
    return Object.freeze({
      name,
      status: "FAIL",
      evidenceStatus: "MISSING",
      fresh: false,
      bindingFailures: [],
    });
  try {
    const report = readFeature005Report(path);
    const evidenceStatus = String(report.status);
    const timestamp = [report.finishedAt, report.generatedAt, report.startedAt].find(
      (value) => typeof value === "string",
    );
    const fresh = typeof timestamp === "string" && Date.parse(timestamp) >= gateStartedAt;
    const bindingFailures = [...verifyFeature005SourceBinding(workspace, report)];
    if (typeof report.taskSourceHash === "string" && report.taskSourceHash !== currentTaskHash)
      bindingFailures.push("TASK_SOURCE_HASH_MISMATCH");
    const accepted = acceptedFeature005EvidenceStatus(name, evidenceStatus);
    return Object.freeze({
      name,
      status: accepted && fresh && bindingFailures.length === 0 ? "PASS" : "FAIL",
      evidenceStatus,
      fresh,
      timestamp,
      sha256: sha256Feature005File(path),
      bindingFailures,
    });
  } catch (error) {
    return Object.freeze({
      name,
      status: "FAIL",
      evidenceStatus: "INVALID",
      fresh: false,
      bindingFailures: [error instanceof Error ? error.message : String(error)],
    });
  }
});
const scenarioPath = resolve(
  workspace,
  "reports/005-gitlab-automated-validation/documented-scenarios.json",
);
const scenarioReport = existsSync(scenarioPath) ? readFeature005Report(scenarioPath) : undefined;
const scenarioRows = Array.isArray(scenarioReport?.scenarios)
  ? (scenarioReport.scenarios.filter(
      (row) => row !== null && typeof row === "object" && !Array.isArray(row),
    ) as readonly Readonly<Record<string, unknown>>[])
  : [];
const passedScenarios = scenarioRows
  .filter(({ status }) => status === "PASS")
  .map(({ id }) => String(id));
const scenarioTrace = gitLabDocumentedScenarioNames.map((id) =>
  Object.freeze({
    id,
    status: passedScenarios.includes(id) ? "PASS" : "FAIL",
    report: "documented-scenarios.json",
    smokeStage: "stateful-scenario-execution",
  }),
);
const missingDeclared = required.filter((id) => !declared.has(id));
const unexpectedDeclared = [...declared].filter((id) => !required.includes(id));
const snapshot = captureFeature005HandoffSnapshot(workspace);
const status =
  missingDeclared.length === 0 &&
  unexpectedDeclared.length === 0 &&
  entries.every(({ status: value }) => value === "PASS") &&
  evidenceReports.every(({ status: value }) => value === "PASS") &&
  scenarioTrace.every(({ status: value }) => value === "PASS")
    ? "PASS"
    : "FAIL";
const report = Object.freeze({
  schemaVersion: 1,
  feature: "005-gitlab-automated-validation",
  gate: "traceability",
  generatedAt: new Date().toISOString(),
  status,
  summary: Object.freeze({
    required: required.length,
    declared: declared.size,
    passed: entries.filter(({ status: value }) => value === "PASS").length,
    failed: entries.filter(({ status: value }) => value === "FAIL").length,
    documentedScenarios: scenarioTrace.length,
    missingDeclared,
    unexpectedDeclared,
  }),
  taskSource: snapshot.taskSnapshot,
  hashes: Object.freeze({
    source: snapshot.sourceSnapshot,
    contract: snapshot.contractSnapshot,
    runtime: snapshot.runtimeSnapshot,
  }),
  entries,
  scenarioTrace,
  evidenceReports,
});
if (flags.has("--plan")) {
  console.log(
    `[trace:005:plan] FR=25 SC=7 scenarios=${gitLabDocumentedScenarioNames.length} reports=${expectedReports.length}`,
  );
  console.log(`[trace:005:plan] current status would be ${status}`);
  process.exit(0);
}
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, stringifyPortableJson(report, workspace), "utf8");
console.log(
  `[trace:005] ${status}; FR=${entries.filter(({ kind, status: value }) => kind === "requirement" && value === "PASS").length}/25; SC=${entries.filter(({ kind, status: value }) => kind === "success-criterion" && value === "PASS").length}/7; scenarios=${scenarioTrace.filter(({ status: value }) => value === "PASS").length}/30; report: ${reportPath}`,
);
if (status === "FAIL") process.exitCode = 1;
