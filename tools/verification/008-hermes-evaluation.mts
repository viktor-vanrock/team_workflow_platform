import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { tsImport } from "tsx/esm/api";

import { FEATURE_008, hashBytes, ROOT_008, write008Json } from "./feature-008-prerequisites.mts";
import {
  currentFingerprints008,
  evidenceRef008,
  type GateReport008,
  writeGateReport008,
} from "./feature-008-reports.mts";

if (process.argv.slice(2).some((value) => value !== "--"))
  throw new Error("UNKNOWN_HERMES_EVALUATION_ARGUMENT");
const fingerprints = currentFingerprints008(),
  startedAt = new Date().toISOString();
const { HermesCorpusEvaluator } = (await tsImport(
  "../../packages/runtime-composition/src/hermes/evaluation.ts",
  import.meta.url,
)) as typeof import("../../packages/runtime-composition/src/hermes/evaluation.ts");
const { readHermesCorpus008, hermesCandidate008, createHermesDevelopmentPort008 } = (await tsImport(
  "../../tests/support/008-hermes-evaluation.ts",
  import.meta.url,
)) as typeof import("../../tests/support/008-hermes-evaluation.ts");
const corpus = readHermesCorpus008(),
  seed = hermesCandidate008(corpus);
const sourceFiles = [
  "packages/competency-qa/src/skills/qa-triage.ts",
  "packages/competency-qa/src/application/intake-completeness.ts",
  "packages/competency-qa/src/skills/qa-result-review-prep.ts",
];
const sourceBindings = (files: readonly string[]) =>
  files.map((path) => ({ path, sha256: hashBytes(readFileSync(resolve(ROOT_008, path))) }));
const model = sourceBindings(["tests/support/008-hermes-evaluation.ts"]),
  prompt = sourceBindings([
    "packages/runtime-composition/src/hermes/prompt-manifest-builder.ts",
    "packages/runtime-composition/src/hermes/evaluation-context.ts",
  ]),
  skills = sourceBindings(sourceFiles);
const candidate = {
  ...seed,
  modelRef: {
    ...seed.modelRef,
    contentHash: hashBytes(Buffer.from(JSON.stringify(model))) as `sha256:${string}`,
  },
  promptRef: {
    ...seed.promptRef,
    contentHash: hashBytes(Buffer.from(JSON.stringify(prompt))) as `sha256:${string}`,
  },
  skillRef: {
    ...seed.skillRef,
    contentHash: hashBytes(Buffer.from(JSON.stringify(skills))) as `sha256:${string}`,
  },
};
const evaluation = await new HermesCorpusEvaluator(
  createHermesDevelopmentPort008(corpus, candidate),
).evaluate(corpus, candidate);
const runId = `hermes-${evaluation.runId}`,
  path = `reports/${FEATURE_008}/evidence/${runId}/evaluation.json`;
write008Json(path, {
  mode: "DEVELOPMENT_MOCKS",
  corporateModelQuality: "NOT_EVALUATED",
  model,
  prompt,
  skills,
  evaluation,
});
const unchanged = JSON.stringify(currentFingerprints008()) === JSON.stringify(fingerprints);
const scope = { workspaceId: "fixture-workspace-alpha", projectIds: ["fixture-project-web"] };
const report: GateReport008 = {
  schemaVersion: 1,
  feature: FEATURE_008,
  runId,
  gate: "hermes",
  status: evaluation.status === "PASS" && unchanged ? "PASS" : "FAIL",
  deploymentProfile: "local",
  scope,
  startedAt,
  finishedAt: new Date().toISOString(),
  fingerprints,
  executorIdentity: "local-cli",
  prerequisites: [],
  checks: [
    {
      id: "hermes-corpus",
      status: evaluation.status,
      evidence: [evidenceRef008(ROOT_008, path)],
      reasonCodes: evaluation.status === "PASS" ? [] : ["HERMES_CORPUS_FAILED"],
    },
    {
      id: "unchanged-source",
      status: unchanged ? "PASS" : "FAIL",
      evidence: [evidenceRef008(ROOT_008, path)],
      reasonCodes: unchanged ? [] : ["SOURCE_CHANGED"],
    },
  ],
  reasonCodes: evaluation.status === "PASS" && unchanged ? [] : ["HERMES_EVALUATION_FAILED"],
};
const ref = writeGateReport008(ROOT_008, report, {
  now: Date.now(),
  maximumAgeMs: 3600_000,
  scope,
  fingerprints,
  allowedExecutors: ["local-cli"],
});
write008Json(`reports/${FEATURE_008}/hermes.json`, {
  status: report.status,
  report: ref,
  mode: "DEVELOPMENT_MOCKS",
  corporateModelQuality: "NOT_EVALUATED",
  cases: evaluation.results.length,
  passRate: evaluation.passRate,
  unauthorizedOperations: evaluation.unauthorizedOperations,
  leakageCount: evaluation.leakageCount,
  fallbackCount: evaluation.fallbackCount,
});
console.log(
  `[verify:008:hermes] ${report.status}; cases=${evaluation.results.length}; report=${ref.path}`,
);
if (report.status !== "PASS") process.exitCode = 1;
