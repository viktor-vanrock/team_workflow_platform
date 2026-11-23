import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { stringifyPortableJson } from "./portable-json.mts";

const workspace = resolve(import.meta.dirname, "../..");
const specPath = resolve(workspace, "specs/001-extension-kernel-local-skeleton/spec.md");
const tasksPath = resolve(workspace, "specs/001-extension-kernel-local-skeleton/tasks.md");
const reportPath = resolve(workspace, "artifacts/verification/feature-001-trace.json");
const allowPending = process.argv.slice(2).includes("--allow-pending");
const unexpected = process.argv.slice(2).filter((value) => value !== "--allow-pending");
if (unexpected.length > 0) throw new Error(`Unknown trace arguments: ${unexpected.join(" ")}`);

type TraceKind = "requirement" | "success-criterion" | "acceptance";
interface TraceDefinition {
  readonly id: string;
  readonly kind: TraceKind;
  readonly tasks: readonly string[];
  readonly tests: readonly string[];
}

function ids(prefix: "FR" | "SC", from: number, to: number): string[] {
  return Array.from(
    { length: to - from + 1 },
    (_, index) => `${prefix}-${String(from + index).padStart(3, "0")}`,
  );
}

function expand(
  kind: TraceKind,
  requirementIds: readonly string[],
  tasks: readonly string[],
  tests: readonly string[],
): TraceDefinition[] {
  return requirementIds.map((id) => ({ id, kind, tasks, tests }));
}

const traces: TraceDefinition[] = [
  ...expand(
    "requirement",
    ids("FR", 1, 9),
    [
      "T006",
      "T017",
      "T018",
      "T019",
      "T032",
      "T033",
      "T036",
      "T039",
      "T041",
      "T044",
      "T045",
      "T046",
      "T050",
      "T051",
      "T052",
      "T053",
      "T054",
      "T055",
      "T056",
      "T150",
      "T151",
    ],
    [
      "tests/architecture/acceptance/at-005-extension-boundaries.spec.ts",
      "tests/architecture/feature-001-hard-boundaries.spec.ts",
      "tests/architecture/non-local-composition.spec.ts",
    ],
  ),
  ...expand(
    "requirement",
    ids("FR", 10, 15),
    [
      "T014",
      "T015",
      "T016",
      "T020",
      "T021",
      "T024",
      "T025",
      "T026",
      "T027",
      "T028",
      "T029",
      "T030",
      "T035",
      "T116",
      "T117",
      "T118",
      "T119",
      "T120",
      "T121",
      "T122",
      "T123",
      "T124",
      "T125",
      "T126",
    ],
    [
      "tests/integration/security/authorization-policy.spec.ts",
      "tests/integration/security/request-trust-boundary.spec.ts",
      "tests/integration/security/acceptance/at-010-scope-isolation.spec.ts",
    ],
  ),
  ...expand(
    "requirement",
    ids("FR", 16, 21),
    [
      "T047",
      "T049",
      "T050",
      "T072",
      "T073",
      "T074",
      "T081",
      "T082",
      "T083",
      "T084",
      "T085",
      "T089",
      "T090",
      "T091",
      "T092",
      "T093",
      "T094",
      "T095",
      "T096",
      "T097",
      "T098",
      "T099",
      "T100",
      "T101",
      "T102",
      "T103",
      "T110",
      "T111",
      "T112",
      "T113",
      "T114",
      "T115",
      "T152",
      "T153",
      "T154",
      "T155",
    ],
    [
      "tests/contract/asyncapi-event-roundtrip.spec.ts",
      "tests/contract/command-state-public-boundary.spec.ts",
      "tests/integration/feature-001-resilience.spec.ts",
      "tests/integration/security/secret-and-audit-scan.spec.ts",
    ],
  ),
  ...expand(
    "requirement",
    ids("FR", 22, 26),
    [
      "T040",
      "T043",
      "T057",
      "T058",
      "T059",
      "T060",
      "T061",
      "T062",
      "T063",
      "T064",
      "T065",
      "T066",
      "T067",
      "T068",
      "T069",
      "T070",
      "T075",
      "T076",
      "T077",
      "T078",
      "T079",
      "T080",
      "T095",
      "T152",
    ],
    [
      "tests/contract/all-connector-writes.spec.ts",
      "tests/contract/acceptance/at-006-typed-capabilities.spec.ts",
      "tests/contract/acceptance/at-013-connector-substitution.spec.ts",
    ],
  ),
  ...expand(
    "requirement",
    ids("FR", 27, 30),
    [
      "T062",
      "T076",
      "T077",
      "T078",
      "T079",
      "T127",
      "T128",
      "T129",
      "T130",
      "T131",
      "T132",
      "T133",
      "T134",
      "T135",
      "T136",
      "T137",
      "T138",
      "T139",
      "T140",
      "T141",
      "T142",
      "T143",
      "T144",
      "T145",
      "T154",
    ],
    [
      "tests/e2e/001-local-walking-skeleton.spec.ts",
      "tests/e2e/001-acceptance.spec.ts",
      "tests/integration/feature-001-resilience.spec.ts",
    ],
  ),
  ...expand(
    "requirement",
    ids("FR", 31, 32),
    [
      "T057",
      "T058",
      "T059",
      "T060",
      "T061",
      "T062",
      "T063",
      "T064",
      "T065",
      "T066",
      "T067",
      "T068",
      "T069",
      "T070",
      "T107",
      "T108",
      "T116",
    ],
    [
      "tests/integration/integration-configuration-lifecycle.spec.ts",
      "tests/architecture/non-local-composition.spec.ts",
    ],
  ),
  ...expand(
    "requirement",
    ids("FR", 33, 33),
    ["T060", "T083", "T085", "T091", "T095", "T097", "T098", "T114"],
    [
      "tests/integration/durable-effect-regression.spec.ts",
      "tests/e2e/001-durable-preview.spec.ts",
    ],
  ),
  ...expand(
    "requirement",
    ids("FR", 34, 35),
    [
      "T019",
      "T048",
      "T071",
      "T081",
      "T086",
      "T088",
      "T104",
      "T105",
      "T106",
      "T107",
      "T108",
      "T109",
      "T155",
    ],
    [
      "tests/integration/security/acceptance/at-015-approval-effect-gate.spec.ts",
      "tests/integration/security/acceptance/at-019-binding-publication.spec.ts",
      "tests/contract/command-state-public-boundary.spec.ts",
    ],
  ),
  ...expand(
    "success-criterion",
    ids("SC", 1, 1),
    [
      "T127",
      "T137",
      "T138",
      "T139",
      "T140",
      "T141",
      "T142",
      "T143",
      "T144",
      "T145",
      "T156",
      "T157",
      "T158",
      "T159",
      "T160",
      "T161",
      "T162",
      "T163",
    ],
    [
      "tests/e2e/acceptance/at-001-local-bootstrap.spec.ts",
      "tests/e2e/001-acceptance.spec.ts",
      "tools/verification/smoke-001-gate.mts",
    ],
  ),
  ...expand(
    "success-criterion",
    ids("SC", 2, 3),
    [
      "T039",
      "T040",
      "T041",
      "T042",
      "T043",
      "T044",
      "T045",
      "T046",
      "T047",
      "T048",
      "T049",
      "T050",
      "T051",
      "T052",
      "T053",
      "T054",
      "T055",
      "T056",
      "T150",
      "T151",
    ],
    [
      "tests/architecture/acceptance/at-005-extension-boundaries.spec.ts",
      "tests/architecture/core-without-extensions.spec.ts",
      "tests/architecture/non-local-composition.spec.ts",
    ],
  ),
  ...expand(
    "success-criterion",
    ids("SC", 4, 4),
    ["T040", "T059", "T075", "T078", "T152"],
    [
      "tests/contract/acceptance/at-013-connector-substitution.spec.ts",
      "tests/contract/all-connector-writes.spec.ts",
    ],
  ),
  ...expand(
    "success-criterion",
    ids("SC", 5, 5),
    [
      "T083",
      "T092",
      "T093",
      "T094",
      "T095",
      "T096",
      "T097",
      "T098",
      "T099",
      "T113",
      "T114",
      "T154",
    ],
    [
      "tests/integration/acceptance/at-008-command-recovery.spec.ts",
      "tests/integration/durable-effect-regression.spec.ts",
      "tests/integration/feature-001-resilience.spec.ts",
    ],
  ),
  ...expand(
    "success-criterion",
    ids("SC", 6, 6),
    [
      "T014",
      "T015",
      "T016",
      "T028",
      "T029",
      "T030",
      "T116",
      "T117",
      "T118",
      "T119",
      "T120",
      "T121",
      "T122",
      "T123",
      "T124",
      "T125",
      "T126",
    ],
    [
      "tests/integration/security/acceptance/at-010-scope-isolation.spec.ts",
      "tests/integration/scope-isolation-surfaces.spec.ts",
      "tests/e2e/001-isolation.spec.ts",
    ],
  ),
  ...expand(
    "success-criterion",
    ids("SC", 7, 7),
    ["T074", "T085", "T103", "T152", "T153"],
    [
      "tests/contract/all-connector-writes.spec.ts",
      "tests/integration/security/acceptance/at-011-audit-completeness.spec.ts",
      "tests/integration/security/secret-and-audit-scan.spec.ts",
    ],
  ),
  {
    id: "AT-001",
    kind: "acceptance",
    tasks: ["T127"],
    tests: ["tests/e2e/acceptance/at-001-local-bootstrap.spec.ts"],
  },
  {
    id: "AT-002",
    kind: "acceptance",
    tasks: ["T128"],
    tests: ["tests/e2e/acceptance/at-002-model-fallback.spec.ts"],
  },
  {
    id: "AT-003",
    kind: "acceptance",
    tasks: ["T129"],
    tests: ["tests/integration/security/acceptance/at-003-local-security.spec.ts"],
  },
  {
    id: "AT-004",
    kind: "acceptance",
    tasks: ["T036"],
    tests: ["tests/integration/acceptance/at-004-extension-registration.spec.ts"],
  },
  {
    id: "AT-005",
    kind: "acceptance",
    tasks: ["T039"],
    tests: ["tests/architecture/acceptance/at-005-extension-boundaries.spec.ts"],
  },
  {
    id: "AT-006",
    kind: "acceptance",
    tasks: ["T040"],
    tests: ["tests/contract/acceptance/at-006-typed-capabilities.spec.ts"],
  },
  {
    id: "AT-007",
    kind: "acceptance",
    tasks: ["T058"],
    tests: ["tests/integration/acceptance/at-007-capability-availability.spec.ts"],
  },
  {
    id: "AT-008",
    kind: "acceptance",
    tasks: ["T083"],
    tests: ["tests/integration/acceptance/at-008-command-recovery.spec.ts"],
  },
  {
    id: "AT-009",
    kind: "acceptance",
    tasks: ["T084"],
    tests: ["tests/integration/security/acceptance/at-009-webhook-security.spec.ts"],
  },
  {
    id: "AT-010",
    kind: "acceptance",
    tasks: ["T116"],
    tests: ["tests/integration/security/acceptance/at-010-scope-isolation.spec.ts"],
  },
  {
    id: "AT-011",
    kind: "acceptance",
    tasks: ["T085"],
    tests: ["tests/integration/security/acceptance/at-011-audit-completeness.spec.ts"],
  },
  {
    id: "AT-012",
    kind: "acceptance",
    tasks: ["T062"],
    tests: ["tests/contract/acceptance/at-012-mock-hub.spec.ts"],
  },
  {
    id: "AT-013",
    kind: "acceptance",
    tasks: ["T059"],
    tests: ["tests/contract/acceptance/at-013-connector-substitution.spec.ts"],
  },
  {
    id: "AT-014",
    kind: "acceptance",
    tasks: ["T060"],
    tests: ["tests/integration/acceptance/at-014-configuration-versioning.spec.ts"],
  },
  {
    id: "AT-015",
    kind: "acceptance",
    tasks: ["T086"],
    tests: ["tests/integration/security/acceptance/at-015-approval-effect-gate.spec.ts"],
  },
  {
    id: "AT-016",
    kind: "acceptance",
    tasks: ["T037", "T087"],
    tests: ["tests/integration/acceptance/at-016-resilience.spec.ts"],
  },
  {
    id: "AT-017",
    kind: "acceptance",
    tasks: ["T081"],
    tests: [
      "tests/contract/acceptance/at-017-command-state-matrix.spec.ts",
      "tests/contract/command-state-public-boundary.spec.ts",
    ],
  },
  {
    id: "AT-018",
    kind: "acceptance",
    tasks: ["T061"],
    tests: ["tests/contract/acceptance/at-018-strategy-intersection.spec.ts"],
  },
  {
    id: "AT-019",
    kind: "acceptance",
    tasks: ["T088"],
    tests: ["tests/integration/security/acceptance/at-019-binding-publication.spec.ts"],
  },
];

const spec = readFileSync(specPath, "utf8");
const taskDocument = readFileSync(tasksPath, "utf8");
const declaredIds = new Set(
  [...spec.matchAll(/\*\*((?:FR|SC)-\d{3}):?\*\*/gu)].map((match) => match[1]!),
);
const expectedIds = new Set([
  ...ids("FR", 1, 35),
  ...ids("SC", 1, 7),
  ...Array.from({ length: 19 }, (_, index) => `AT-${String(index + 1).padStart(3, "0")}`),
]);
const taskStates = new Map(
  [...taskDocument.matchAll(/^- \[([ xX])\] (T\d{3})\b/gmu)].map(
    (match) => [match[2]!, match[1]!.toLowerCase() === "x"] as const,
  ),
);
const traceById = new Map(traces.map((trace) => [trace.id, trace]));
const missingDeclared = [...expectedIds].filter((id) =>
  id.startsWith("AT-") ? !traceById.has(id) : !declaredIds.has(id),
);
const missingMappings = [...expectedIds].filter((id) => !traceById.has(id));
const extraMappings = [...traceById.keys()].filter((id) => !expectedIds.has(id));

const entries = traces.map((trace) => {
  const missingTasks = trace.tasks.filter((task) => !taskStates.has(task));
  const pendingTasks = trace.tasks.filter((task) => taskStates.get(task) === false);
  const missingTests = trace.tests.filter((test) => !existsSync(resolve(workspace, test)));
  const status =
    missingTasks.length > 0 || missingTests.length > 0
      ? "FAIL"
      : pendingTasks.length > 0
        ? "PENDING"
        : "PASS";
  return { ...trace, status, pendingTasks, missingTasks, missingTests };
});
const structuralFailure =
  missingDeclared.length > 0 ||
  missingMappings.length > 0 ||
  extraMappings.length > 0 ||
  entries.some(({ status }) => status === "FAIL");
const pending = entries.some(({ status }) => status === "PENDING");
const status = structuralFailure ? "FAIL" : pending ? "PENDING" : "PASS";
const report = {
  schemaVersion: 1,
  feature: "001-extension-kernel-local-skeleton",
  generatedAt: new Date().toISOString(),
  status,
  summary: {
    requirements: entries.filter(({ kind }) => kind === "requirement").length,
    successCriteria: entries.filter(({ kind }) => kind === "success-criterion").length,
    acceptanceTests: entries.filter(({ kind }) => kind === "acceptance").length,
    pass: entries.filter((entry) => entry.status === "PASS").length,
    pending: entries.filter((entry) => entry.status === "PENDING").length,
    fail: entries.filter((entry) => entry.status === "FAIL").length,
  },
  structural: { missingDeclared, missingMappings, extraMappings },
  entries,
};
mkdirSync(resolve(reportPath, ".."), { recursive: true });
writeFileSync(reportPath, stringifyPortableJson(report, workspace), "utf8");
console.table(report.summary);
console.log(`[trace:001] ${status}; report: ${reportPath}`);
if (status === "FAIL" || (status === "PENDING" && !allowPending)) process.exitCode = 1;
