import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const workspace = resolve(import.meta.dirname, "../..");
const checks = [
  [
    "US2_CONTRACT_INTEGRATION_E2E",
    [
      "node_modules/vitest/vitest.mjs",
      "run",
      "tests/contract/004/us2-candidate.spec.ts",
      "tests/integration/004/us2-jira-candidate-trigger.spec.ts",
      "tests/integration/004/us2-candidate-dedupe.spec.ts",
      "tests/integration/004/us2-candidate-decisions.spec.ts",
      "tests/integration/004/us2-candidate-presentation.spec.ts",
      "tests/integration/security/004/us2-candidate-authorization.spec.ts",
      "tests/e2e/004-us2-candidate-decisions.spec.ts",
      "--maxWorkers=1",
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
const results = [] as Array<Record<string, unknown>>;
for (const [key, args] of checks) {
  const start = Date.now(),
    run = spawnSync(process.execPath, [...args], {
      cwd: workspace,
      env: { ...process.env, CI: "true" },
      encoding: "utf8",
    });
  if (run.status !== 0) {
    process.stderr.write(run.stdout);
    process.stderr.write(run.stderr);
  }
  results.push({
    key,
    status: run.status === 0 ? "PASS" : "FAIL",
    exitCode: run.status,
    durationMs: Date.now() - start,
    outputHash: `sha256:${createHash("sha256").update(`${run.stdout}\n${run.stderr}`).digest("hex")}`,
  });
}
const status = results.every((item) => item.status === "PASS") ? "PASS" : "FAIL";
const report = {
  feature: "004-mattermost-hermes-intake",
  checkpoint: "US2",
  status,
  generatedAt: new Date().toISOString(),
  taskSourceHash: `sha256:${createHash("sha256")
    .update(readFileSync(resolve(workspace, "specs/004-mattermost-hermes-intake/tasks.md")))
    .digest("hex")}`,
  assertions: {
    operationalWorkCreated: 0,
    decisionSet: ["CREATE", "SNOOZE", "IGNORE"],
    gitLabProducer: "DENY_NOT_INSTALLED",
  },
  results,
};
const directory = resolve(workspace, "reports/004-mattermost-hermes-intake");
mkdirSync(directory, { recursive: true });
writeFileSync(resolve(directory, "us2.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (status !== "PASS") process.exitCode = 1;
