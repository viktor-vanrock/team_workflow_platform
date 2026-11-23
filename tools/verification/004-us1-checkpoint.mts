import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const workspace = resolve(import.meta.dirname, "../..");
const node = process.execPath;
const checks = [
  [
    "US1_CONTRACT_INTEGRATION_E2E",
    [
      "node_modules/vitest/vitest.mjs",
      "run",
      "tests/contract/004/us1-bootstrap-project-selection.spec.ts",
      "tests/contract/004/us1-intake-skills.spec.ts",
      "tests/integration/security/004/us1-bootstrap-authorization.spec.ts",
      "tests/integration/004/us1-project-selection-draft.spec.ts",
      "tests/integration/004/us1-draft-revision-cas.spec.ts",
      "tests/integration/004/us1-callback-concurrency.spec.ts",
      "tests/integration/004/us1-confirmation-idempotency.spec.ts",
      "tests/e2e/004-us1-guided-intake.spec.ts",
      "--maxWorkers=1",
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
  ["BROWSER_PROCESS_PLAN", ["tools/smoke/feature-004-browser-process.mts", "--plan"]],
] as const;
const results = [] as Array<Record<string, unknown>>;
for (const [key, args] of checks) {
  const started = Date.now();
  const result = spawnSync(node, [...args], {
    cwd: workspace,
    env: { ...process.env, CI: "true" },
    encoding: "utf8",
  });
  results.push({
    key,
    status: result.status === 0 ? "PASS" : "FAIL",
    exitCode: result.status,
    durationMs: Date.now() - started,
    outputHash: `sha256:${createHash("sha256").update(`${result.stdout}\n${result.stderr}`).digest("hex")}`,
  });
  if (result.status !== 0) {
    process.stderr.write(result.stdout);
    process.stderr.write(result.stderr);
  }
}
const status = results.every((item) => item.status === "PASS") ? "PASS" : "FAIL";
const report = {
  feature: "004-mattermost-hermes-intake",
  checkpoint: "US1",
  status,
  generatedAt: new Date().toISOString(),
  taskSourceHash: `sha256:${createHash("sha256")
    .update(readFileSync(resolve(workspace, "specs/004-mattermost-hermes-intake/tasks.md")))
    .digest("hex")}`,
  results,
};
const directory = resolve(workspace, "reports/004-mattermost-hermes-intake");
mkdirSync(directory, { recursive: true });
writeFileSync(resolve(directory, "us1.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (status !== "PASS") process.exitCode = 1;
