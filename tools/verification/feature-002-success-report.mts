import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { stringifyPortableJson } from "./portable-json.mts";

const workspace = resolve(import.meta.dirname, "../..");
const artifacts = resolve(workspace, "artifacts/verification");
const jsonPath = resolve(artifacts, "feature-002-success-criteria.json");
const markdownPath = resolve(artifacts, "feature-002-success-criteria.md");
const plan = readFileSync(
  resolve(workspace, "specs/002-qa-manual-walking-skeleton/plan.md"),
  "utf8",
);
const evidence = Object.freeze([
  { id: "trace", path: "artifacts/verification/feature-002-trace.json", command: "pnpm trace:002" },
  { id: "smoke", path: "artifacts/verification/feature-002-smoke.json", command: "pnpm smoke:002" },
  {
    id: "regression",
    path: "artifacts/verification/feature-002-regression-gate.json",
    command: "node tools/verification/feature-002-regression-gate.mts",
  },
]);
const entries = evidence.map((entry) => {
  const absolute = resolve(workspace, entry.path);
  if (!existsSync(absolute)) return { ...entry, status: "MISSING" as const };
  const report = JSON.parse(readFileSync(absolute, "utf8")) as Readonly<{ status?: string }>;
  return { ...entry, status: report.status ?? "INVALID" };
});
const constitutionalExceptions =
  /Constitution exceptions:\*\* нет\./u.test(plan) && /violations\/exceptions = 0/u.test(plan)
    ? 0
    : 1;
const status =
  entries.every((entry) => entry.status === "PASS") && constitutionalExceptions === 0
    ? "PASS"
    : "PENDING";
const report = {
  schemaVersion: 1,
  feature: "002-qa-manual-walking-skeleton",
  generatedAt: new Date().toISOString(),
  status,
  constitutionalExceptions,
  exactCommands: [
    "pnpm install --frozen-lockfile",
    "pnpm lint",
    "pnpm typecheck",
    "pnpm build",
    "pnpm test:e2e:002",
    "pnpm smoke:002",
    "pnpm trace:002",
    "pnpm verify:002",
  ],
  evidence: entries,
};
const markdown = `# Feature 002 success-criteria evidence\n\nStatus: **${status}**\n\nConstitutional exceptions: **${constitutionalExceptions}**\n\n| Evidence | Status | Exact command | Artifact |\n|---|---:|---|---|\n${entries.map((entry) => `| ${entry.id} | ${entry.status} | \`${entry.command}\` | \`${entry.path}\` |`).join("\n")}\n\n## Final commands\n\n${report.exactCommands.map((command) => `- \`${command}\``).join("\n")}\n`;
mkdirSync(artifacts, { recursive: true });
writeFileSync(jsonPath, stringifyPortableJson(report, workspace), "utf8");
writeFileSync(markdownPath, markdown, "utf8");
console.log(
  `[success:002] ${status}; constitutionalExceptions=${constitutionalExceptions}; report: ${markdownPath}`,
);
if (status !== "PASS" && !process.argv.includes("--allow-pending")) process.exitCode = 1;
