import { documentedMattermostScenarioNames } from "../local/mattermost-scenario-catalog.mts";

export const requiredFeature004SuccessCriteria = Object.freeze([
  "SC-001",
  "SC-002",
  "SC-003",
  "SC-004",
  "SC-005",
  "SC-006",
  "SC-007",
] as const);
export type Feature004SuccessCriterion = (typeof requiredFeature004SuccessCriteria)[number];
export const feature004ProcessStages = Object.freeze([
  {
    id: "documented-scenarios",
    args: ["tools/smoke/feature-004-scenario-process.mts"],
    projectPrefix: "awp-local-004-scenarios-",
    timeoutMs: 900_000,
    evidenceSources: ["MOCK_HUB", "PROCESS_HTTP"],
    successCriteria: ["SC-004", "SC-006"],
    documentedScenarios: documentedMattermostScenarioNames,
  },
  {
    id: "us1-guided-intake",
    args: ["tools/smoke/feature-004-us1-process.mts"],
    projectPrefix: "awp-local-004-us1-",
    timeoutMs: 900_000,
    evidenceSources: ["POSTGRESQL", "PROCESS_HTTP"],
    successCriteria: ["SC-001", "SC-002", "SC-007"],
    documentedScenarios: [],
  },
  {
    id: "us2-candidates",
    args: ["tools/smoke/feature-004-us2-process.mts"],
    projectPrefix: "awp-local-004-us2-",
    timeoutMs: 900_000,
    evidenceSources: ["POSTGRESQL", "PROCESS_HTTP"],
    successCriteria: ["SC-001", "SC-003", "SC-007"],
    documentedScenarios: [],
  },
  {
    id: "us3-hermes",
    args: ["tools/smoke/feature-004-us3-process.mts"],
    projectPrefix: "awp-local-004-us3-",
    timeoutMs: 900_000,
    evidenceSources: ["POSTGRESQL", "SECURITY_TEST_EVIDENCE"],
    successCriteria: ["SC-002", "SC-005", "SC-006"],
    documentedScenarios: [],
  },
  {
    id: "us4-notifications",
    args: ["tools/smoke/feature-004-us4-process.mts"],
    projectPrefix: "awp-local-004-us4-",
    timeoutMs: 900_000,
    evidenceSources: ["POSTGRESQL", "MOCK_HUB", "PROCESS_HTTP"],
    successCriteria: ["SC-004", "SC-006", "SC-007"],
    documentedScenarios: [],
  },
  {
    id: "browser",
    args: ["tools/smoke/feature-004-browser-process.mts"],
    projectPrefix: "awp-local-004-browser-",
    timeoutMs: 900_000,
    evidenceSources: ["PROCESS_HTTP"],
    successCriteria: ["SC-001", "SC-003", "SC-005"],
    documentedScenarios: [],
  },
] as const);
export function summarizeFeature004ExecutionCoverage(
  results: readonly Readonly<{ id: string; status: string }>[],
) {
  const passed = new Set(results.filter(({ status }) => status === "PASS").map(({ id }) => id));
  const executed = new Set(
    feature004ProcessStages
      .filter(({ id }) => passed.has(id))
      .flatMap(({ successCriteria }) => successCriteria),
  );
  return Object.freeze({
    executedSuccessCriteria: requiredFeature004SuccessCriteria.filter((value) =>
      executed.has(value),
    ),
    unexecutedSuccessCriteria: requiredFeature004SuccessCriteria.filter(
      (value) => !executed.has(value),
    ),
    unexecutedStages: feature004ProcessStages
      .filter(({ id }) => !passed.has(id))
      .map(({ id }) => id),
  });
}
