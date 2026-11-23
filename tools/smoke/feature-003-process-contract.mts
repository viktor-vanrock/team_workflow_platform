import { documentedJiraScenarioNames } from "../local/jira-scenario-catalog.mts";

export const requiredFeature003SuccessCriteria = Object.freeze([
  "SC-001",
  "SC-002",
  "SC-003",
  "SC-004",
  "SC-005",
  "SC-006",
  "SC-007",
] as const);

export type Feature003SuccessCriterion = (typeof requiredFeature003SuccessCriteria)[number];
export type Feature003EvidenceSource =
  "MOCK_HUB" | "POSTGRESQL" | "PROCESS_HTTP" | "SECURITY_TEST_EVIDENCE";

export interface Feature003ProcessStage {
  readonly id: string;
  readonly args: readonly string[];
  readonly projectPrefix?: string;
  readonly timeoutMs: number;
  readonly evidenceSources: readonly Feature003EvidenceSource[];
  readonly successCriteria: readonly Feature003SuccessCriterion[];
  readonly documentedScenarios: readonly string[];
}

export const feature003ProcessStages: readonly Feature003ProcessStage[] = Object.freeze([
  Object.freeze({
    id: "documented-scenarios",
    args: Object.freeze(["tools/smoke/feature-003-scenario-process.mts"]),
    projectPrefix: "awp-local-003-scenarios-",
    timeoutMs: 600_000,
    evidenceSources: Object.freeze(["MOCK_HUB"] as const),
    successCriteria: Object.freeze([]),
    documentedScenarios: documentedJiraScenarioNames,
  }),
  Object.freeze({
    id: "us1-durable-effects",
    args: Object.freeze(["tools/smoke/feature-003-us1-process.mts"]),
    projectPrefix: "awp-local-003-us1-",
    timeoutMs: 600_000,
    evidenceSources: Object.freeze(["POSTGRESQL", "MOCK_HUB", "PROCESS_HTTP"] as const),
    successCriteria: Object.freeze(["SC-001", "SC-002", "SC-004", "SC-007"] as const),
    documentedScenarios: Object.freeze([]),
  }),
  Object.freeze({
    id: "us2-direct-import",
    args: Object.freeze(["tools/smoke/feature-003-us2-process.mts"]),
    projectPrefix: "awp-local-003-us2-",
    timeoutMs: 600_000,
    evidenceSources: Object.freeze(["POSTGRESQL", "MOCK_HUB", "PROCESS_HTTP"] as const),
    successCriteria: Object.freeze(["SC-001", "SC-002", "SC-004", "SC-006"] as const),
    documentedScenarios: Object.freeze([]),
  }),
  Object.freeze({
    id: "us3-action-conflict",
    args: Object.freeze(["tools/smoke/feature-003-us3-process.mts"]),
    projectPrefix: "awp-local-003-us3-",
    timeoutMs: 600_000,
    evidenceSources: Object.freeze(["POSTGRESQL", "MOCK_HUB", "PROCESS_HTTP"] as const),
    successCriteria: Object.freeze(["SC-002", "SC-003", "SC-004", "SC-007"] as const),
    documentedScenarios: Object.freeze([]),
  }),
  Object.freeze({
    id: "us4-defect-publication",
    args: Object.freeze(["tools/smoke/feature-003-us4-process.mts"]),
    projectPrefix: "awp-local-003-us4-",
    timeoutMs: 600_000,
    evidenceSources: Object.freeze(["POSTGRESQL", "MOCK_HUB", "PROCESS_HTTP"] as const),
    successCriteria: Object.freeze(["SC-001", "SC-005", "SC-007"] as const),
    documentedScenarios: Object.freeze([]),
  }),
  Object.freeze({
    id: "security-audit-evidence",
    args: Object.freeze([
      "node_modules/vitest/vitest.mjs",
      "run",
      "tests/integration/security/003/jira-auth-egress.spec.ts",
      "tests/integration/security/003/connector-hardening.spec.ts",
      "tests/integration/security/003/isolation-hardening.spec.ts",
      "tests/integration/security/003/audit-lineage.spec.ts",
      "--maxWorkers=1",
    ]),
    timeoutMs: 180_000,
    evidenceSources: Object.freeze(["SECURITY_TEST_EVIDENCE"] as const),
    successCriteria: Object.freeze(["SC-006", "SC-007"] as const),
    documentedScenarios: Object.freeze([]),
  }),
]);

export interface Feature003StageStatus {
  readonly id: string;
  readonly status: "PASS" | "FAIL" | "SKIP";
}

export interface Feature003ExecutionCoverage {
  readonly executedSuccessCriteria: readonly Feature003SuccessCriterion[];
  readonly unexecutedSuccessCriteria: readonly Feature003SuccessCriterion[];
  readonly unexecutedStages: readonly string[];
}

export function summarizeFeature003ExecutionCoverage(
  results: readonly Feature003StageStatus[],
): Feature003ExecutionCoverage {
  const resultById = new Map(results.map((result) => [result.id, result.status]));
  const unexecutedStages = feature003ProcessStages
    .filter(({ id }) => resultById.get(id) !== "PASS")
    .map(({ id }) => id);
  const passedCriteria = new Set(
    feature003ProcessStages
      .filter(({ id }) => resultById.get(id) === "PASS")
      .flatMap(({ successCriteria }) => successCriteria),
  );
  const executedSuccessCriteria = requiredFeature003SuccessCriteria.filter((criterion) =>
    passedCriteria.has(criterion),
  );
  const unexecutedSuccessCriteria = requiredFeature003SuccessCriteria.filter(
    (criterion) => !passedCriteria.has(criterion),
  );
  return Object.freeze({ executedSuccessCriteria, unexecutedSuccessCriteria, unexecutedStages });
}

export function assertFeature003ExecutionCoverage(
  results: readonly Feature003StageStatus[],
): Feature003ExecutionCoverage {
  const coverage = summarizeFeature003ExecutionCoverage(results);
  if (coverage.unexecutedStages.length > 0) {
    throw new Error(`FEATURE_003_UNEXECUTED_STAGES:${coverage.unexecutedStages.join(",")}`);
  }
  if (coverage.unexecutedSuccessCriteria.length > 0) {
    throw new Error(
      `FEATURE_003_UNEXECUTED_SUCCESS_CRITERIA:${coverage.unexecutedSuccessCriteria.join(",")}`,
    );
  }
  return coverage;
}
