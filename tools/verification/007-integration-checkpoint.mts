import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

import { stringifyPortableJson } from "./portable-json.mts";

const workspace = resolve(import.meta.dirname, "../..");
const reportPath = resolve(
  workspace,
  "reports/007-project-onboarding-evidence-security/integration.json",
);
const flags = new Set(process.argv.slice(2).filter((value) => value !== "--"));
const unknown = [...flags].filter((flag) => flag !== "--plan");
if (unknown.length > 0)
  throw new Error(`Unknown Feature 007 integration arguments: ${unknown.join(", ")}`);

const targets = Object.freeze([
  "tests/integration/007",
  "tests/integration/migrations/007-migration-registry.spec.ts",
  "tests/integration/migrations/007-onboarding-foundation.spec.ts",
]);

function filesBelow(fileOrDirectory: string): string[] {
  const absolute = resolve(workspace, fileOrDirectory);
  if (!statSync(absolute).isDirectory()) return [absolute];
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const child = resolve(absolute, entry.name);
    return entry.isDirectory() ? filesBelow(relative(workspace, child)) : [child];
  });
}

const evidenceFiles = targets
  .flatMap(filesBelow)
  .filter((file) => file.endsWith(".spec.ts"))
  .sort();
const args = Object.freeze([
  "node_modules/vitest/vitest.mjs",
  "run",
  ...evidenceFiles.map((file) => relative(workspace, file)),
  "--maxWorkers=1",
]);
const digest = (value: string | Buffer): `sha256:${string}` =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const sourceHasher = createHash("sha256");
for (const file of evidenceFiles)
  sourceHasher
    .update(relative(workspace, file))
    .update("\0")
    .update(readFileSync(file))
    .update("\0");
const sourceDigest = `sha256:${sourceHasher.digest("hex")}` as const;

if (flags.has("--plan")) {
  console.log(
    `[verify:007:integration:plan] ${[process.execPath, ...args].join(" ")}; suites=${evidenceFiles.length}`,
  );
  process.exit(0);
}

const startedAt = new Date();
const stageStartedAt = Date.now();
const result = spawnSync(process.execPath, [...args], {
  cwd: workspace,
  env: { ...process.env, CI: "true" },
  encoding: "utf8",
});
if (result.error) throw result.error;
const status = result.status === 0 ? "PASS" : "FAIL";
if (status === "FAIL") {
  process.stderr.write(result.stdout);
  process.stderr.write(result.stderr);
}
const report = Object.freeze({
  schemaVersion: 1,
  feature: "007-project-onboarding-evidence-security",
  checkpoint: "INTEGRATION",
  status,
  contour: "qa-jira-gitlab-mattermost-local",
  production: "DENIED",
  externalNetwork: "DENIED",
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  summary: Object.freeze({ suites: evidenceFiles.length, targets }),
  stage: Object.freeze({
    id: "feature-007-story-integration",
    status,
    command: process.execPath,
    args,
    exitCode: result.status ?? 1,
    durationMs: Date.now() - stageStartedAt,
    outputHash: digest(`${result.stdout}\n${result.stderr}`),
  }),
  sourceBinding: Object.freeze({
    sha256: sourceDigest,
    files: Object.freeze(evidenceFiles.map((file) => relative(workspace, file))),
  }),
});
mkdirSync(dirname(reportPath), { recursive: true });
const temporary = `${reportPath}.${process.pid}.tmp`;
writeFileSync(temporary, stringifyPortableJson(report, workspace), "utf8");
renameSync(temporary, reportPath);
console.log(
  `[verify:007:integration] ${status}; suites=${evidenceFiles.length}; report: ${reportPath}`,
);
if (status !== "PASS") process.exitCode = 1;
