import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { stringifyPortableJson } from "./portable-json.mts";

const workspace = resolve(import.meta.dirname, "../..");
const feature001ReportPath = resolve(workspace, "artifacts/verification/feature-001-gate.json");
const smoke001ReportPath = resolve(workspace, "artifacts/verification/smoke-001-gate.json");
const reportPath = resolve(workspace, "artifacts/verification/feature-002-prerequisites.json");
const expectedAcceptance = Array.from(
  { length: 19 },
  (_, index) => `AT-${String(index + 1).padStart(3, "0")}`,
);

interface CheckResult {
  readonly id: string;
  readonly status: "PASS" | "FAIL";
  readonly detail: string;
}

interface JsonRecord {
  readonly [key: string]: unknown;
}

interface ContractRequirement {
  readonly id: "Command" | "Approval" | "Artifact" | "Event" | "Confirmation";
  readonly packagePath: string;
  readonly publicIndexPath: string;
  readonly publicExport: string;
  readonly schemaPath?: string;
  readonly schemaId?: string;
}

const contractRequirements: readonly ContractRequirement[] = [
  {
    id: "Command",
    packagePath: "packages/platform-contracts/package.json",
    publicIndexPath: "packages/platform-core/src/index.ts",
    publicExport: "./commanding/command-gateway.ts",
    schemaPath:
      "specs/001-extension-kernel-local-skeleton/contracts/schemas/commands/external-command-envelope.v1.schema.json",
    schemaId: "urn:awp:contracts:commands:external-command-envelope:v1",
  },
  {
    id: "Approval",
    packagePath: "packages/platform-contracts/package.json",
    publicIndexPath: "packages/platform-core/src/index.ts",
    publicExport: "./approval/approval.ts",
    schemaPath:
      "specs/001-extension-kernel-local-skeleton/contracts/schemas/commands/approval-subject.v1.schema.json",
    schemaId: "urn:awp:contracts:commands:approval-subject:v1",
  },
  {
    id: "Artifact",
    packagePath: "packages/platform-core/package.json",
    publicIndexPath: "packages/platform-core/src/index.ts",
    publicExport: "./artifacts/artifact-service.ts",
  },
  {
    id: "Event",
    packagePath: "packages/platform-contracts/package.json",
    publicIndexPath: "packages/platform-core/src/index.ts",
    publicExport: "./events/event-envelope.ts",
    schemaPath:
      "specs/001-extension-kernel-local-skeleton/contracts/schemas/events/event-envelope.v1.schema.json",
    schemaId: "urn:awp:contracts:events:event-envelope:v1",
  },
  {
    id: "Confirmation",
    packagePath: "packages/platform-contracts/package.json",
    publicIndexPath: "packages/platform-contracts/src/index.ts",
    publicExport: "./extensions/confirmation-hook.ts",
  },
];

const startedAt = new Date();
const checks: CheckResult[] = [];

function readJson(path: string): JsonRecord {
  if (!existsSync(path)) throw new Error(`Required prerequisite evidence is missing: ${path}`);
  return JSON.parse(readFileSync(path, "utf8")) as JsonRecord;
}

function requireCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function versionMajor(value: string): number {
  const match = /^(?:v)?(\d+)(?:\.|$)/u.exec(value);
  return match ? Number(match[1]) : Number.NaN;
}

function runCheck(id: string, action: () => string): void {
  try {
    checks.push({ id, status: "PASS", detail: action() });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    checks.push({ id, status: "FAIL", detail });
    throw error;
  }
}

function verifyFeature001FinalReport(): string {
  const report = readJson(feature001ReportPath);
  requireCondition(report.schemaVersion === 1, "Feature 001 final report schemaVersion must be 1");
  requireCondition(
    report.feature === "001-extension-kernel-local-skeleton",
    "Feature 001 final report has the wrong feature id",
  );
  requireCondition(
    report.gate === "feature-001-final",
    "Feature 001 final report has the wrong gate id",
  );
  requireCondition(report.status === "PASS", "Feature 001 final gate is not PASS");

  const stages = report.stages as readonly JsonRecord[] | undefined;
  requireCondition(
    Array.isArray(stages) && stages.length > 0,
    "Feature 001 final report has no stages",
  );
  requireCondition(
    stages.every((stage) => stage.status === "PASS"),
    "Feature 001 final report contains a failed stage",
  );

  const acceptance = report.acceptance as readonly JsonRecord[] | undefined;
  requireCondition(Array.isArray(acceptance), "Feature 001 final report has no acceptance matrix");
  const observed = acceptance.map((entry) => String(entry.id)).sort();
  requireCondition(
    JSON.stringify(observed) === JSON.stringify([...expectedAcceptance].sort()),
    "Feature 001 acceptance matrix is incomplete or contains unexpected entries",
  );
  requireCondition(
    acceptance.every(
      (entry) => entry.status === "PASS" && Array.isArray(entry.tests) && entry.tests.length > 0,
    ),
    "Feature 001 acceptance matrix contains non-PASS or unproven entries",
  );
  return `${acceptance.length}/${expectedAcceptance.length} acceptance entries PASS; ${stages.length} final stages PASS`;
}

function verifySmoke001Report(): string {
  const report = readJson(smoke001ReportPath);
  requireCondition(report.schemaVersion === 1, "smoke:001 report schemaVersion must be 1");
  requireCondition(
    report.feature === "001-extension-kernel-local-skeleton",
    "smoke:001 report has the wrong feature id",
  );
  requireCondition(report.gate === "smoke-001", "smoke:001 report has the wrong gate id");
  requireCondition(report.status === "PASS", "smoke:001 is not PASS");
  requireCondition(report.cleanBootstrap === true, "smoke:001 did not prove a clean bootstrap");
  const stages = report.stages as readonly JsonRecord[] | undefined;
  requireCondition(Array.isArray(stages) && stages.length > 0, "smoke:001 report has no stages");
  requireCondition(
    stages.every((stage) => stage.status === "PASS"),
    "smoke:001 report contains a failed stage",
  );
  return `cleanBootstrap=true; ${stages.length} smoke stages PASS`;
}

function verifyToolchain(): string {
  const rootPackage = readJson(resolve(workspace, "package.json"));
  const pinnedNode = readFileSync(resolve(workspace, ".node-version"), "utf8").trim();
  const pnpm = execFileSync("pnpm", ["--version"], {
    cwd: workspace,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  requireCondition(
    versionMajor(process.versions.node) === 24,
    `Node ${process.versions.node} is incompatible; expected 24.x`,
  );
  requireCondition(
    versionMajor(pinnedNode) === 24,
    `.node-version ${pinnedNode} is incompatible; expected 24.x`,
  );
  requireCondition(pnpm === "11.21.0", `pnpm ${pnpm} is incompatible; expected 11.21.0`);
  requireCondition(
    rootPackage.packageManager === "pnpm@11.21.0",
    `packageManager=${String(rootPackage.packageManager)}; expected pnpm@11.21.0`,
  );
  return `Node ${process.versions.node} (pin ${pinnedNode}); pnpm ${pnpm}`;
}

function verifyContract(requirement: ContractRequirement): string {
  const packageJson = readJson(resolve(workspace, requirement.packagePath));
  const packageVersion = String(packageJson.version ?? "");
  requireCondition(
    versionMajor(packageVersion) === 1,
    `${requirement.id} owner ${String(packageJson.name)}@${packageVersion} is not compatible with 1.x`,
  );

  const publicIndex = readFileSync(resolve(workspace, requirement.publicIndexPath), "utf8");
  requireCondition(
    publicIndex.includes(requirement.publicExport),
    `${requirement.id} public export ${requirement.publicExport} is missing from ${requirement.publicIndexPath}`,
  );

  if (requirement.schemaPath && requirement.schemaId) {
    const schema = readJson(resolve(workspace, requirement.schemaPath));
    requireCondition(
      schema.$id === requirement.schemaId,
      `${requirement.id} immutable schema id drifted: ${String(schema.$id)}`,
    );
    const schemaVersion = (schema.properties as JsonRecord | undefined)?.schemaVersion as
      JsonRecord | undefined;
    requireCondition(
      schemaVersion?.const === 1 || requirement.id === "Event",
      `${requirement.id} schemaVersion must be v1`,
    );
  }
  return `${String(packageJson.name)}@${packageVersion}; public ${requirement.schemaId ?? "TypeScript"} v1 surface present`;
}

let failure: unknown;
try {
  runCheck("feature-001-final-report", verifyFeature001FinalReport);
  runCheck("smoke-001-clean-report", verifySmoke001Report);
  runCheck("toolchain-node-24-pnpm-11", verifyToolchain);
  for (const requirement of contractRequirements) {
    runCheck(`public-contract-${requirement.id.toLowerCase()}-v1`, () =>
      verifyContract(requirement),
    );
  }
} catch (error) {
  failure = error;
}

const status = failure ? "FAIL" : "PASS";
const report = {
  schemaVersion: 1,
  feature: "002-qa-manual-walking-skeleton",
  gate: "feature-002-prerequisites",
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  status,
  evidence: {
    feature001Final: feature001ReportPath,
    smoke001: smoke001ReportPath,
  },
  checks,
};

mkdirSync(resolve(reportPath, ".."), { recursive: true });
writeFileSync(reportPath, stringifyPortableJson(report, workspace), "utf8");
console.table(checks);
console.log(
  `[prerequisites:002] ${status}; ${checks.filter(({ status: checkStatus }) => checkStatus === "PASS").length}/${checks.length} checks PASS; report: ${reportPath}`,
);

if (failure) {
  console.error(failure instanceof Error ? failure.message : String(failure));
  process.exitCode = 1;
}
