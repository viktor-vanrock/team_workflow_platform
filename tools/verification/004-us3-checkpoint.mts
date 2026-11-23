import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const workspace = resolve(import.meta.dirname, "../..");
const testFiles = [
  "tests/contract/004/us3-hermes-skills.spec.ts",
  "tests/integration/004/us3-agent-run.spec.ts",
  "tests/unit/004/triage-assessment.spec.ts",
  "tests/integration/004/us3-triage-staleness.spec.ts",
  "tests/integration/004/us3-session-plan.spec.ts",
  "tests/unit/004/model-fallback.spec.ts",
  "tests/integration/004/us3-model-fallback.spec.ts",
  "tests/integration/security/004/us3-tool-gateway.spec.ts",
  "tests/unit/004/prompt-manifest.spec.ts",
  "tests/integration/security/004/us3-prompt-boundary.spec.ts",
  "tests/e2e/004-us3-hermes-proposals.spec.ts",
] as const;
const checks = [
  [
    "US3_CONTRACT_INTEGRATION_E2E",
    ["node_modules/vitest/vitest.mjs", "run", ...testFiles, "--maxWorkers=1"],
  ],
  [
    "QA_TYPECHECK",
    [
      "node_modules/typescript/bin/tsc",
      "-p",
      "packages/competency-qa/tsconfig.json",
      "--noEmit",
      "--pretty",
      "false",
    ],
  ],
  [
    "PERSISTENCE_TYPECHECK",
    [
      "node_modules/typescript/bin/tsc",
      "-p",
      "packages/platform-persistence-typeorm/tsconfig.json",
      "--noEmit",
      "--pretty",
      "false",
    ],
  ],
  [
    "RUNTIME_TYPECHECK",
    [
      "node_modules/typescript/bin/tsc",
      "-p",
      "packages/runtime-composition/tsconfig.json",
      "--noEmit",
      "--pretty",
      "false",
    ],
  ],
  [
    "API_TYPECHECK",
    [
      "node_modules/typescript/bin/tsc",
      "-p",
      "apps/api/tsconfig.json",
      "--noEmit",
      "--pretty",
      "false",
    ],
  ],
  [
    "WEB_TYPECHECK",
    [
      "node_modules/typescript/bin/tsc",
      "-p",
      "apps/web/tsconfig.json",
      "--noEmit",
      "--pretty",
      "false",
    ],
  ],
] as const;
const results: Array<Record<string, unknown>> = [];
for (const [key, args] of checks) {
  const started = Date.now();
  const result = spawnSync(process.execPath, [...args], {
    cwd: workspace,
    env: { ...process.env, CI: "true" },
    encoding: "utf8",
  });
  if (result.status !== 0) {
    process.stderr.write(result.stdout);
    process.stderr.write(result.stderr);
  }
  results.push({
    key,
    status: result.status === 0 ? "PASS" : "FAIL",
    exitCode: result.status,
    durationMs: Date.now() - started,
    outputHash: `sha256:${createHash("sha256").update(`${result.stdout}\n${result.stderr}`).digest("hex")}`,
  });
}
const status = results.every((item) => item.status === "PASS") ? "PASS" : "FAIL";
const report = {
  feature: "004-mattermost-hermes-intake",
  checkpoint: "US3",
  status,
  generatedAt: new Date().toISOString(),
  taskSourceHash: `sha256:${createHash("sha256")
    .update(readFileSync(resolve(workspace, "specs/004-mattermost-hermes-intake/tasks.md")))
    .digest("hex")}`,
  assertions: {
    catalogSkills: 9,
    proposalSkills: 6,
    grantExpansion: 0,
    forbiddenEffects: 0,
    fallbackStatus: "FALLBACK_COMPLETED",
    driftState: "STALE",
  },
  results,
};
const directory = resolve(workspace, "reports/004-mattermost-hermes-intake");
mkdirSync(directory, { recursive: true });
writeFileSync(resolve(directory, "us3.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (status !== "PASS") process.exitCode = 1;
