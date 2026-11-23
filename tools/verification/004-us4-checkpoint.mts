import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const workspace = resolve(import.meta.dirname, "../..");
const tests = [
  "tests/contract/004/us4-qa-notify.spec.ts",
  "tests/contract/004/us4-notification-delivery.spec.ts",
  "tests/integration/004/us4-outbox-independence.spec.ts",
  "tests/integration/004/us4-notification-recovery.spec.ts",
  "tests/integration/004/us4-connection-health.spec.ts",
  "tests/integration/security/004/us4-no-blind-resend.spec.ts",
  "tests/integration/security/004/us4-capsule-purge.spec.ts",
  "tests/e2e/004-us4-notification-outage.spec.ts",
] as const;
const checks = [
  [
    "US4_CONTRACT_INTEGRATION_E2E",
    ["node_modules/vitest/vitest.mjs", "run", ...tests, "--maxWorkers=1"],
  ],
  [
    "CONNECTOR_TYPECHECK",
    [
      "node_modules/typescript/bin/tsc",
      "-p",
      "packages/connector-mattermost/tsconfig.json",
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
    "WORKER_TYPECHECK",
    [
      "node_modules/typescript/bin/tsc",
      "-p",
      "apps/worker/tsconfig.json",
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
  const started = Date.now(),
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
    durationMs: Date.now() - started,
    outputHash: `sha256:${createHash("sha256").update(`${run.stdout}\n${run.stderr}`).digest("hex")}`,
  });
}
const status = results.every(({ status }) => status === "PASS") ? "PASS" : "FAIL";
const report = {
  feature: "004-mattermost-hermes-intake",
  checkpoint: "US4",
  status,
  generatedAt: new Date().toISOString(),
  taskSourceHash: `sha256:${createHash("sha256")
    .update(readFileSync(resolve(workspace, "specs/004-mattermost-hermes-intake/tasks.md")))
    .digest("hex")}`,
  assertions: {
    sourceStateMutation: 0,
    maximumPostCountAfterMarker: 1,
    reconciliationOutcomes: ["DELIVERED", "AMBIGUOUS"],
    terminalLookupCodes: ["ZERO_MATCHES", "MULTIPLE_MATCHES", "LOOKUP_UNSUPPORTED"],
    capture: "SUPPRESSED",
    explicitHealthyProbe: true,
  },
  results,
};
const directory = resolve(workspace, "reports/004-mattermost-hermes-intake");
mkdirSync(directory, { recursive: true });
writeFileSync(resolve(directory, "us4.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (status !== "PASS") process.exitCode = 1;
