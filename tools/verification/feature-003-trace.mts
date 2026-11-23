import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { sha256File } from "./feature-003-evidence-lib.mts";
import { stringifyPortableJson } from "./portable-json.mts";

const workspace = resolve(import.meta.dirname, "../..");
const specPath = resolve(workspace, "specs/003-jira-operational-authority/spec.md");
const tasksPath = resolve(workspace, "specs/003-jira-operational-authority/tasks.md");
const reportPath = resolve(workspace, "reports/003-jira-operational-authority/traceability.json");
const args = process.argv.slice(2);
const scenarioIndex = args.indexOf("--scenario");
const scenario = scenarioIndex >= 0 ? args[scenarioIndex + 1] : undefined;
const unexpected = args.filter(
  (value, index) => value !== "--scenario" && index !== scenarioIndex + 1,
);
if (scenarioIndex >= 0 && !scenario) throw new Error("--scenario requires a value");
if (unexpected.length > 0) throw new Error(`Unknown trace:003 arguments: ${unexpected.join(" ")}`);

type TraceKind = "requirement" | "success-criterion";
type TraceStatus = "PASS" | "FAIL";
interface TraceMapping {
  readonly id: string;
  readonly kind: TraceKind;
  readonly tasks: readonly string[];
}

const spec = readFileSync(specPath, "utf8");
const tasks = readFileSync(tasksPath, "utf8");
const taskStatus = new Map(
  [...tasks.matchAll(/^- \[([ xX])\] (T\d{3})\b/gmu)].map((match) => [
    match[2]!,
    match[1]!.toLowerCase() === "x",
  ]),
);

function numericId(prefix: string, value: number): string {
  return `${prefix}-${String(value).padStart(3, "0")}`;
}

function expandIdRange(first: string, last?: string): readonly string[] {
  if (!last) return [first];
  const [prefix, startText] = first.split("-");
  const endText = last.split("-")[1]!;
  const start = Number(startText);
  const end = Number(endText);
  return Array.from({ length: end - start + 1 }, (_, index) => numericId(prefix!, start + index));
}

function expandTasks(value: string): readonly string[] {
  const expanded: string[] = [];
  for (const match of value.matchAll(/T(\d{3})(?:[–-]T(\d{3}))?/gu)) {
    const start = Number(match[1]);
    const end = Number(match[2] ?? match[1]);
    for (let current = start; current <= end; current += 1)
      expanded.push(`T${String(current).padStart(3, "0")}`);
  }
  return [...new Set(expanded)];
}

const mappings: TraceMapping[] = [];
for (const match of tasks.matchAll(
  /^\| ((?:FR|SC)-\d{3})(?:…((?:FR|SC)-\d{3}))? \| ([^|]+) \|$/gmu,
)) {
  const ids = expandIdRange(match[1]!, match[2]);
  const mappedTasks = expandTasks(match[3]!);
  for (const id of ids)
    mappings.push(
      Object.freeze({
        id,
        kind: id.startsWith("FR-") ? "requirement" : "success-criterion",
        tasks: mappedTasks,
      }),
    );
}

const declared = new Set([...spec.matchAll(/\b((?:FR|SC)-\d{3})\b/gu)].map((match) => match[1]!));
const mapped = new Set(mappings.map(({ id }) => id));
const evidenceByGroup: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "FR-001": [
    "tests/contract/003/pilot-metadata.spec.ts",
    "tests/integration/security/003/production-boundary.spec.ts",
    "tests/integration/security/003/connector-hardening.spec.ts",
  ],
  "FR-006": [
    "tests/contract/003/design-contracts.spec.ts",
    "tests/contract/003/jira-mapping-language.spec.ts",
    "tests/integration/003/jira-profile-lifecycle.spec.ts",
  ],
  "FR-013": [
    "tests/integration/003/operational-binding-chain.spec.ts",
    "tests/integration/003/us3-projection-ordering.spec.ts",
    "tests/e2e/003-jira-operational-authority.spec.ts",
  ],
  "FR-016": [
    "tests/integration/003/us1-create-idempotency.spec.ts",
    "tests/integration/003/us2-import-race.spec.ts",
    "tests/e2e/003-us1-central-request.spec.ts",
    "tests/e2e/003-us2-direct-import.spec.ts",
  ],
  "FR-021": [
    "tests/integration/security/003/webhook-ingress.spec.ts",
    "tests/integration/003/jira-reconciliation.spec.ts",
    "tests/integration/003/jira-rate-freshness.spec.ts",
  ],
  "FR-026": [
    "tests/integration/security/003/us3-command-approvals.spec.ts",
    "tests/integration/003/us3-stale-command.spec.ts",
    "tests/integration/003/jira-error-matrix.spec.ts",
    "tests/e2e/003-us4-approved-defect.spec.ts",
  ],
  "SC-001": [
    "tests/integration/003/us1-create-idempotency.spec.ts",
    "tests/integration/003/us2-import-race.spec.ts",
  ],
  "SC-002": [
    "tests/integration/003/us3-projection-ordering.spec.ts",
    "tests/integration/security/003/us2-webhook-lifecycle.spec.ts",
  ],
  "SC-003": [
    "tests/integration/003/us3-stale-command.spec.ts",
    "tests/integration/003/us3-command-concurrency.spec.ts",
  ],
  "SC-004": [
    "tests/integration/003/us3-webhook-projection.spec.ts",
    "tests/integration/003/jira-rate-freshness.spec.ts",
  ],
  "SC-005": [
    "tests/integration/003/us4-defect-recovery.spec.ts",
    "tests/e2e/003-us4-approved-defect.spec.ts",
  ],
  "SC-006": [
    "tests/integration/security/003/jira-auth-egress.spec.ts",
    "tests/integration/security/003/connector-hardening.spec.ts",
    "tools/verification/feature-003-nonprod.mts",
  ],
  "SC-007": [
    "tests/integration/security/003/audit-lineage.spec.ts",
    "tests/e2e/003-jira-operational-authority.spec.ts",
  ],
});

function evidenceFor(id: string): readonly string[] {
  if (id.startsWith("SC-")) return evidenceByGroup[id] ?? [];
  const value = Number(id.slice(3));
  const anchor =
    value <= 5
      ? "FR-001"
      : value <= 12
        ? "FR-006"
        : value <= 15
          ? "FR-013"
          : value <= 20
            ? "FR-016"
            : value <= 25
              ? "FR-021"
              : "FR-026";
  return evidenceByGroup[anchor] ?? [];
}

const selfReferentialGateTasks = new Set(["T150", "T151"]);
const entries = mappings.map((mapping) => {
  const missingTasks = mapping.tasks.filter((task) => !taskStatus.has(task));
  const pendingTasks = mapping.tasks.filter(
    (task) => taskStatus.get(task) === false && !selfReferentialGateTasks.has(task),
  );
  const evidence = evidenceFor(mapping.id);
  const missingEvidence = evidence.filter((path) => !existsSync(resolve(workspace, path)));
  const status: TraceStatus =
    missingTasks.length > 0 ||
    pendingTasks.length > 0 ||
    evidence.length === 0 ||
    missingEvidence.length > 0
      ? "FAIL"
      : "PASS";
  return Object.freeze({
    ...mapping,
    evidence,
    status,
    missingTasks,
    pendingTasks,
    deferredGateTasks: mapping.tasks.filter((task) => selfReferentialGateTasks.has(task)),
    missingEvidence,
  });
});

const sourceOfTruth = Object.freeze(
  [
    {
      data: "QA Request operational fields",
      owner: "Jira",
      storage: "projection+freshness",
      source: "packages/platform-core/src/work-management/operational-projection.ts",
    },
    {
      data: "Requester identity",
      owner: "Jira+verified principal",
      storage: "identity binding",
      source: "packages/platform-core/src/identity-access/external-principal-binding.ts",
    },
    {
      data: "Sessions/findings/verdict",
      owner: "QA Pack",
      storage: "canonical",
      source: "packages/competency-qa/src",
    },
    {
      data: "Source links",
      owner: "Jira/GitLab",
      storage: "binding/reference",
      source: "packages/connector-jira/src",
    },
    {
      data: "Jira comments/links",
      owner: "Jira",
      storage: "reference/index",
      source: "packages/connector-jira-persistence-typeorm/src",
    },
    {
      data: "Profiles/mappings/policies",
      owner: "Platform",
      storage: "canonical+versioned",
      source:
        "specs/003-jira-operational-authority/contracts/schemas/jira/qa-request-profile.v1.schema.json",
    },
    {
      data: "Audit/idempotency/approvals",
      owner: "Platform",
      storage: "canonical",
      source: "packages/platform-core/src/approval/external-command-approval.ts",
    },
  ].map((entry) => ({
    ...entry,
    status: existsSync(resolve(workspace, entry.source)) ? "PASS" : "FAIL",
  })),
);

const contracts = Object.freeze(
  [
    "specs/003-jira-operational-authority/contracts/openapi/jira-operational-authority-api.v1.yaml",
    "specs/003-jira-operational-authority/contracts/asyncapi/jira-operational-events.v1.yaml",
    "specs/003-jira-operational-authority/contracts/schemas/jira/pilot-metadata-package.v1.schema.json",
    "specs/003-jira-operational-authority/contracts/schemas/operational-authority/projection.v1.schema.json",
    "specs/003-jira-operational-authority/contracts/schemas/operational-work-item/action-input.v1.1.schema.json",
  ].map((path) => ({ path, status: existsSync(resolve(workspace, path)) ? "PASS" : "FAIL" })),
);

const evidenceReports = Object.freeze(
  [
    "prerequisites.json",
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
  ].map((name) => {
    const path = resolve(workspace, "reports/003-jira-operational-authority", name);
    if (!existsSync(path)) return { name, status: "FAIL", evidenceStatus: "MISSING" };
    const value = JSON.parse(readFileSync(path, "utf8")) as Readonly<Record<string, unknown>>;
    const evidenceStatus = String(value.status);
    return {
      name,
      status: evidenceStatus === "PASS" || evidenceStatus === "SKIPPED_GATED" ? "PASS" : "FAIL",
      evidenceStatus,
      sha256: sha256File(path),
    };
  }),
);

let scenarioStatus: "PASS" | "FAIL" | "NOT_REQUESTED" = "NOT_REQUESTED";
if (scenario) {
  const scenarios = readFileSync(resolve(workspace, "tools/local/jira-scenario.mts"), "utf8");
  scenarioStatus = scenarios.includes(`"${scenario}"`) ? "PASS" : "FAIL";
}
const orphanedDeclaredIds = [...declared].filter((id) => !mapped.has(id)).sort();
const orphanedMappings = [...mapped].filter((id) => !declared.has(id)).sort();
const status: TraceStatus =
  orphanedDeclaredIds.length > 0 ||
  orphanedMappings.length > 0 ||
  entries.some((entry) => entry.status === "FAIL") ||
  sourceOfTruth.some((entry) => entry.status === "FAIL") ||
  contracts.some((entry) => entry.status === "FAIL") ||
  evidenceReports.some((entry) => entry.status === "FAIL") ||
  scenarioStatus === "FAIL"
    ? "FAIL"
    : "PASS";
const report = {
  schemaVersion: 1,
  feature: "003-jira-operational-authority",
  gate: "traceability",
  generatedAt: new Date().toISOString(),
  status,
  scenario: scenario ? { name: scenario, status: scenarioStatus } : null,
  taskSource: {
    path: "specs/003-jira-operational-authority/tasks.md",
    sha256: sha256File(tasksPath),
    declaredTasks: taskStatus.size,
    completedTasks: [...taskStatus.values()].filter(Boolean).length,
    pendingTasks: [...taskStatus.values()].filter((complete) => !complete).length,
  },
  summary: {
    declared: declared.size,
    mapped: mapped.size,
    passed: entries.filter((entry) => entry.status === "PASS").length,
    failed: entries.filter((entry) => entry.status === "FAIL").length,
    orphanedDeclaredIds,
    orphanedMappings,
  },
  entries,
  sourceOfTruth,
  contracts,
  evidenceReports,
};
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, stringifyPortableJson(report, workspace), "utf8");
console.log(
  `[trace:003] declared=${report.summary.declared}; mapped=${report.summary.mapped}; passed=${report.summary.passed}; failed=${report.summary.failed}`,
);
console.log(
  `[trace:003] ${status}; FR=${entries.filter(({ kind, status: entryStatus }) => kind === "requirement" && entryStatus === "PASS").length}/29; SC=${entries.filter(({ kind, status: entryStatus }) => kind === "success-criterion" && entryStatus === "PASS").length}/7; report: ${reportPath}`,
);
if (status === "FAIL") process.exitCode = 1;
