import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { stringifyPortableJson } from "./portable-json.mts";

const workspace = resolve(import.meta.dirname, "../..");
const specPath = resolve(workspace, "specs/002-qa-manual-walking-skeleton/spec.md");
const tasksPath = resolve(workspace, "specs/002-qa-manual-walking-skeleton/tasks.md");
const reportPath = resolve(workspace, "artifacts/verification/feature-002-trace.json");
const allowPending = process.argv.slice(2).includes("--allow-pending");
const unexpected = process.argv.slice(2).filter((value) => value !== "--allow-pending");
if (unexpected.length > 0) throw new Error(`Unknown trace:002 arguments: ${unexpected.join(" ")}`);

type TraceKind = "user-story" | "requirement" | "success-criterion" | "acceptance";
interface TraceDefinition {
  readonly id: string;
  readonly kind: TraceKind;
  readonly tasks: readonly string[];
  readonly tests: readonly string[];
}
const id = (prefix: string, value: number) => `${prefix}-${String(value).padStart(3, "0")}`;
const range = (prefix: string, from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, index) => id(prefix, from + index));
const taskRange = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, index) => `T${String(from + index).padStart(3, "0")}`);
const expand = (
  kind: TraceKind,
  ids: readonly string[],
  tasks: readonly string[],
  tests: readonly string[],
): TraceDefinition[] => ids.map((value) => ({ id: value, kind, tasks, tests }));

const traces: TraceDefinition[] = [
  ...expand("user-story", ["US-001"], taskRange(40, 62), [
    "tests/integration/acceptance/002-at-002-confirmed-intake.spec.ts",
  ]),
  ...expand("user-story", ["US-002"], taskRange(63, 94), [
    "packages/competency-qa/src/application/readiness-evaluator.spec.ts",
    "tests/integration/002-required-session-plan-session-coverage.spec.ts",
  ]),
  ...expand("user-story", ["US-003"], taskRange(95, 124), [
    "tests/integration/acceptance/002-at-005-manual-review.spec.ts",
    "tests/contract/acceptance/002-at-006-evidence-manifest.spec.ts",
    "tests/integration/security/acceptance/002-at-007-evidence-access.spec.ts",
  ]),
  ...expand("user-story", ["US-004"], taskRange(125, 141), [
    "tests/integration/acceptance/002-at-008-finding-classification.spec.ts",
    "tests/integration/security/acceptance/002-at-009-defect-approval.spec.ts",
  ]),
  ...expand("user-story", ["US-005"], taskRange(142, 160), [
    "tests/integration/security/acceptance/002-at-010-verdict-risk-review.spec.ts",
    "tests/integration/acceptance/002-at-011-dod.spec.ts",
  ]),
  ...expand(
    "requirement",
    range("FR", 1, 2),
    [...taskRange(6, 14), "T021", "T039", "T165", "T166", "T175"],
    [
      "tests/contract/acceptance/002-at-001-qa-pack-contract.spec.ts",
      "tests/architecture/002-hard-boundaries.spec.ts",
    ],
  ),
  ...expand(
    "requirement",
    range("FR", 3, 5),
    [...taskRange(40, 62), "T161", "T164", "T175"],
    [
      "tests/integration/acceptance/002-at-002-confirmed-intake.spec.ts",
      "tests/integration/acceptance/002-at-015-resilience.spec.ts",
    ],
  ),
  ...expand(
    "requirement",
    range("FR", 6, 9),
    [...taskRange(63, 79), "T142", "T175"],
    [
      "packages/competency-qa/src/application/readiness-evaluator.spec.ts",
      "tests/integration/security/002-readiness-authorization.spec.ts",
    ],
  ),
  ...expand(
    "requirement",
    range("FR", 10, 13),
    ["T074", ...taskRange(80, 94), "T175"],
    [
      "tests/integration/002-session-lineage.spec.ts",
      "tests/integration/002-session-snapshot-immutability.spec.ts",
    ],
  ),
  ...expand(
    "requirement",
    range("FR", 14, 15),
    [...taskRange(95, 124), "T175"],
    [
      "tests/integration/002-manual-execution-concurrency.spec.ts",
      "tests/integration/acceptance/002-at-005-manual-review.spec.ts",
    ],
  ),
  ...expand(
    "requirement",
    range("FR", 16, 20),
    [
      "T009",
      ...taskRange(97, 124),
      "T146",
      "T147",
      "T154",
      "T156",
      "T160",
      "T161",
      ...taskRange(171, 175),
    ],
    [
      "tests/contract/acceptance/002-at-006-evidence-manifest.spec.ts",
      "tests/integration/security/acceptance/002-at-007-evidence-access.spec.ts",
      "tests/integration/security/002-secret-redaction-scan.spec.ts",
    ],
  ),
  ...expand(
    "requirement",
    range("FR", 21, 24),
    ["T100", ...taskRange(125, 141), "T164", "T175"],
    [
      "tests/integration/acceptance/002-at-008-finding-classification.spec.ts",
      "tests/integration/security/acceptance/002-at-009-defect-approval.spec.ts",
    ],
  ),
  ...expand(
    "requirement",
    range("FR", 25, 28),
    ["T054", "T055", "T060", "T068", "T129", "T140", ...taskRange(142, 160), "T166", "T175"],
    [
      "tests/integration/security/acceptance/002-at-010-verdict-risk-review.spec.ts",
      "tests/integration/acceptance/002-at-011-dod.spec.ts",
      "tests/integration/002-manual-vertical-flow.spec.ts",
    ],
  ),
  ...expand(
    "success-criterion",
    ["SC-001"],
    [...taskRange(40, 62), "T163", "T164", "T174"],
    [
      "tests/integration/acceptance/002-at-002-confirmed-intake.spec.ts",
      "tests/integration/acceptance/002-at-015-resilience.spec.ts",
    ],
  ),
  ...expand(
    "success-criterion",
    ["SC-002"],
    [...taskRange(80, 124), ...taskRange(142, 160), "T163"],
    [
      "tests/integration/002-manual-session-vertical-flow.spec.ts",
      "tests/e2e/acceptance/002-at-014-manual-walking-skeleton.spec.ts",
    ],
  ),
  ...expand(
    "success-criterion",
    ["SC-003"],
    [...taskRange(125, 160), "T163", "T174"],
    [
      "tests/integration/002-manual-vertical-flow.spec.ts",
      "tests/e2e/acceptance/002-at-014-manual-walking-skeleton.spec.ts",
    ],
  ),
  ...expand(
    "success-criterion",
    ["SC-004"],
    [...taskRange(97, 124), "T163"],
    [
      "tests/contract/acceptance/002-at-006-evidence-manifest.spec.ts",
      "tests/integration/002-evidence-integrity.spec.ts",
    ],
  ),
  ...expand(
    "success-criterion",
    ["SC-005"],
    ["T016", "T017", "T044", "T098", "T127", "T161", "T171"],
    ["tests/integration/security/acceptance/002-at-012-cross-project-isolation.spec.ts"],
  ),
  ...expand(
    "success-criterion",
    ["SC-006"],
    ["T066", "T131", "T132", "T162", "T163", "T164", "T168", "T174"],
    [
      "tests/e2e/acceptance/002-at-013-model-degraded-mode.spec.ts",
      "tests/integration/acceptance/002-at-015-resilience.spec.ts",
    ],
  ),
  {
    id: "AT-001",
    kind: "acceptance",
    tasks: ["T013", "T014"],
    tests: ["tests/contract/acceptance/002-at-001-qa-pack-contract.spec.ts"],
  },
  {
    id: "AT-002",
    kind: "acceptance",
    tasks: ["T040"],
    tests: ["tests/integration/acceptance/002-at-002-confirmed-intake.spec.ts"],
  },
  {
    id: "AT-003",
    kind: "acceptance",
    tasks: ["T063", "T064", "T065"],
    tests: [
      "packages/competency-qa/src/application/readiness-evaluator.spec.ts",
      "tests/integration/security/002-readiness-authorization.spec.ts",
      "tests/integration/acceptance/002-readiness-operational-sync.spec.ts",
    ],
  },
  {
    id: "AT-004",
    kind: "acceptance",
    tasks: ["T080", "T081", "T082", "T083", "T084"],
    tests: [
      "packages/competency-qa/src/domain/test-session.spec.ts",
      "tests/integration/002-session-lineage.spec.ts",
      "tests/integration/security/002-session-start-guards.spec.ts",
    ],
  },
  {
    id: "AT-005",
    kind: "acceptance",
    tasks: ["T095", "T096"],
    tests: ["tests/integration/acceptance/002-at-005-manual-review.spec.ts"],
  },
  {
    id: "AT-006",
    kind: "acceptance",
    tasks: ["T097", "T099", "T146"],
    tests: ["tests/contract/acceptance/002-at-006-evidence-manifest.spec.ts"],
  },
  {
    id: "AT-007",
    kind: "acceptance",
    tasks: ["T098", "T161", "T171"],
    tests: [
      "tests/integration/security/acceptance/002-at-007-evidence-access.spec.ts",
      "tests/integration/security/002-secret-redaction-scan.spec.ts",
    ],
  },
  {
    id: "AT-008",
    kind: "acceptance",
    tasks: ["T125", "T126"],
    tests: ["tests/integration/acceptance/002-at-008-finding-classification.spec.ts"],
  },
  {
    id: "AT-009",
    kind: "acceptance",
    tasks: ["T127", "T128"],
    tests: ["tests/integration/security/acceptance/002-at-009-defect-approval.spec.ts"],
  },
  {
    id: "AT-010",
    kind: "acceptance",
    tasks: ["T142", "T143"],
    tests: ["tests/integration/security/acceptance/002-at-010-verdict-risk-review.spec.ts"],
  },
  {
    id: "AT-011",
    kind: "acceptance",
    tasks: ["T143", "T144", "T145"],
    tests: ["tests/integration/acceptance/002-at-011-dod.spec.ts"],
  },
  {
    id: "AT-012",
    kind: "acceptance",
    tasks: ["T161"],
    tests: ["tests/integration/security/acceptance/002-at-012-cross-project-isolation.spec.ts"],
  },
  {
    id: "AT-013",
    kind: "acceptance",
    tasks: ["T162"],
    tests: ["tests/e2e/acceptance/002-at-013-model-degraded-mode.spec.ts"],
  },
  {
    id: "AT-014",
    kind: "acceptance",
    tasks: ["T163"],
    tests: ["tests/e2e/acceptance/002-at-014-manual-walking-skeleton.spec.ts"],
  },
  {
    id: "AT-015",
    kind: "acceptance",
    tasks: ["T164"],
    tests: ["tests/integration/acceptance/002-at-015-resilience.spec.ts"],
  },
];

const spec = readFileSync(specPath, "utf8");
const tasks = readFileSync(tasksPath, "utf8");
const declared = new Set([
  ...[...spec.matchAll(/(?:^### |\*\*)((?:US|FR|SC)-\d{3})/gmu)].map((match) => match[1]!),
  ...range("AT", 1, 15),
]);
const mapped = new Set(traces.map(({ id: value }) => value));
const taskStatus = new Map(
  [...tasks.matchAll(/^- \[([ xX])\] (T\d{3})\b/gmu)].map((match) => [
    match[2]!,
    match[1]!.toLowerCase() === "x",
  ]),
);
const entries = traces.map((trace) => {
  const missingTasks = trace.tasks.filter((task) => !taskStatus.has(task));
  const pendingTasks = trace.tasks.filter((task) => taskStatus.get(task) === false);
  const missingTests = trace.tests.filter((test) => !existsSync(resolve(workspace, test)));
  const status =
    missingTasks.length > 0 || missingTests.length > 0
      ? "FAIL"
      : pendingTasks.length > 0
        ? "PENDING"
        : "PASS";
  return { ...trace, status, missingTasks, pendingTasks, missingTests };
});
const orphanedDeclaredIds = [...declared].filter((value) => !mapped.has(value)).sort();
const orphanedMappings = [...mapped].filter((value) => !declared.has(value)).sort();
const status =
  orphanedDeclaredIds.length > 0 ||
  orphanedMappings.length > 0 ||
  entries.some((entry) => entry.status === "FAIL")
    ? "FAIL"
    : entries.some((entry) => entry.status === "PENDING")
      ? "PENDING"
      : "PASS";
const report = {
  schemaVersion: 1,
  feature: "002-qa-manual-walking-skeleton",
  generatedAt: new Date().toISOString(),
  status,
  summary: {
    declared: declared.size,
    mapped: mapped.size,
    passed: entries.filter((entry) => entry.status === "PASS").length,
    pending: entries.filter((entry) => entry.status === "PENDING").length,
    failed: entries.filter((entry) => entry.status === "FAIL").length,
    orphanedDeclaredIds,
    orphanedMappings,
  },
  entries,
};
mkdirSync(resolve(reportPath, ".."), { recursive: true });
writeFileSync(reportPath, stringifyPortableJson(report, workspace), "utf8");
console.table(report.summary);
console.log(`[trace:002] ${status}; report: ${reportPath}`);
if (status === "FAIL" || (status === "PENDING" && !allowPending)) process.exitCode = 1;
