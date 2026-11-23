import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { stringifyPortableJson } from "./portable-json.mts";

export interface Feature005DigestRequirement {
  id: string;
  path: string;
  sha256: string;
}

export interface Feature005ReportRequirement {
  path: string;
  sha256: string;
  schemaVersion: number;
  feature: "003-jira-operational-authority";
  gate: "feature-003-final";
}

export interface Feature005PrerequisiteManifest {
  schemaVersion: 1;
  maximumReportAgeMs: number;
  feature003Report: Feature005ReportRequirement;
  consumedContracts: Feature005DigestRequirement[];
  feature002ManualContracts: Feature005DigestRequirement[];
  feature002AutomatedNegativeFixture: Omit<Feature005DigestRequirement, "id">;
  feature004Evidence: {
    path: string;
    requiredForStandalone: boolean;
  };
}

export interface Feature005PrerequisiteCheck {
  readonly id: string;
  readonly status: "PASS" | "FAIL";
  readonly code: string;
  readonly detail: string;
}

export interface Feature005PrerequisiteBinding {
  readonly status: "PASS" | "FAIL";
  readonly feature003Report: Feature005PrerequisiteCheck;
  readonly consumedContracts: readonly Feature005PrerequisiteCheck[];
  readonly feature002ManualContracts: readonly Feature005PrerequisiteCheck[];
  readonly feature002AutomatedNegativeFixture: Feature005PrerequisiteCheck;
  readonly feature004Evidence: Feature005PrerequisiteCheck;
}

const workspace = resolve(import.meta.dirname, "../..");
const outputPath = "reports/005-gitlab-automated-validation/prerequisites.json";

export const FEATURE_005_PREREQUISITE_MANIFEST: Feature005PrerequisiteManifest = {
  schemaVersion: 1,
  maximumReportAgeMs: 604_800_000,
  feature003Report: {
    path: "reports/003-jira-operational-authority/final-gate.json",
    sha256: "sha256:ff8a941316b60cb46226064e4508bc1aecaf4b31e0a1ea95573063c150c7a008",
    schemaVersion: 2,
    feature: "003-jira-operational-authority",
    gate: "feature-003-final",
  },
  consumedContracts: [
    {
      id: "core-connector-command",
      path: "packages/platform-core/src/commanding/connector-command.ts",
      sha256: "sha256:d366a19caf9f6c98ce695d869698cfeb6fdc614cd9d4499005f176dc444cd850",
    },
    {
      id: "core-idempotency",
      path: "packages/platform-core/src/commanding/idempotency.ts",
      sha256: "sha256:695d834ae6afa11f96a8b6a4d66337f32c11d7c56d26a10214179573fdbf4ce8",
    },
    {
      id: "jira-manifest",
      path: "packages/connector-jira/src/manifest.ts",
      sha256: "sha256:09cb8e157466709175bea4242af4cba95b6b50c0eb2c5eb9544f53fd31bbed2f",
    },
    {
      id: "qa-2040",
      path: "packages/competency-qa/src/persistence/migrations/2040-hermes-proposals.ts",
      sha256: "sha256:9dc9a52ca90e80e2698d27fef1c9560369cc2c5fd3b43a6f5a7e1ace1dfbbc04",
    },
  ],
  feature002ManualContracts: [
    {
      id: "manual-test-session-v1",
      path: "specs/002-qa-manual-walking-skeleton/contracts/schemas/qa/test-session.v1.schema.json",
      sha256: "sha256:e4730fb5ad9c658c5f31ea4eb29a12806f046578e03234c5988301b3c43212a3",
    },
    {
      id: "manual-attempt-v1",
      path: "specs/002-qa-manual-walking-skeleton/contracts/schemas/qa/manual-attempt.v1.schema.json",
      sha256: "sha256:d13634bd78b3c12ecbfe4dd8f496993742b4c31aa53a31e4738f3ca2e1def409",
    },
    {
      id: "manual-plan-item-v1",
      path: "specs/002-qa-manual-walking-skeleton/contracts/schemas/qa/plan-item.v1.schema.json",
      sha256: "sha256:27c731023b0d4834293f15ec195aa9cd65cbfd4aa9cff3248d850021935acdfb",
    },
  ],
  feature002AutomatedNegativeFixture: {
    path: "specs/002-qa-manual-walking-skeleton/contracts/examples/negative/automated-session.invalid.json",
    sha256: "sha256:a258faf283b6d275990a4b182067790bdc6aeb255c273b3b5ab4fbe33f5f233a",
  },
  feature004Evidence: {
    path: "reports/004-mattermost-hermes-intake/final-gate.json",
    requiredForStandalone: false,
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function pass(id: string, code: string, detail: string): Feature005PrerequisiteCheck {
  return Object.freeze({ id, status: "PASS", code, detail });
}

function fail(id: string, code: string, detail: string): Feature005PrerequisiteCheck {
  return Object.freeze({ id, status: "FAIL", code, detail });
}

function digest(bytes: string | Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function safePath(root: string, path: string): string {
  const target = resolve(root, path);
  if (target !== root && !target.startsWith(`${root}/`))
    throw new Error(`Path escapes workspace: ${path}`);
  return target;
}

function feature003ReportCheck(
  root: string,
  requirement: Feature005ReportRequirement,
  maximumAgeMs: number,
  nowMs: number,
): Feature005PrerequisiteCheck {
  let path: string;
  try {
    path = safePath(root, requirement.path);
  } catch (error) {
    return fail(
      "feature-003-final",
      "FEATURE_003_REPORT_PATH_INVALID",
      error instanceof Error ? error.message : String(error),
    );
  }
  if (!existsSync(path))
    return fail(
      "feature-003-final",
      "FEATURE_003_REPORT_MISSING",
      `${requirement.path} is missing`,
    );
  const bytes = readFileSync(path, "utf8");
  const actualDigest = digest(bytes);
  if (actualDigest !== requirement.sha256)
    return fail(
      "feature-003-final",
      "FEATURE_003_REPORT_DIGEST_MISMATCH",
      `${requirement.path} sha256=${actualDigest}; expected=${requirement.sha256}`,
    );
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes) as unknown;
  } catch {
    return fail(
      "feature-003-final",
      "FEATURE_003_REPORT_INVALID_JSON",
      `${requirement.path} is not valid JSON`,
    );
  }
  if (!isRecord(parsed))
    return fail(
      "feature-003-final",
      "FEATURE_003_REPORT_INVALID_JSON",
      `${requirement.path} is not a JSON object`,
    );
  const stages = Array.isArray(parsed.stages) ? parsed.stages : [];
  const handoff = isRecord(parsed.handoff) ? parsed.handoff : undefined;
  const incompatible: string[] = [];
  if (parsed.schemaVersion !== requirement.schemaVersion)
    incompatible.push(`schemaVersion=${String(parsed.schemaVersion)}`);
  if (parsed.feature !== requirement.feature)
    incompatible.push(`feature=${String(parsed.feature)}`);
  if (parsed.gate !== requirement.gate) incompatible.push(`gate=${String(parsed.gate)}`);
  if (parsed.status !== "PASS") incompatible.push(`status=${String(parsed.status)}`);
  if (stages.length === 0 || stages.some((stage) => !isRecord(stage) || stage.status !== "PASS"))
    incompatible.push("process gates are missing or non-PASS");
  if (
    handoff?.status !== "BOUND" ||
    handoff.generatedAfterAllProcessGates !== true ||
    handoff.verificationCommand !== "pnpm verify:003:evidence"
  )
    incompatible.push("handoff attestation is missing or incompatible");
  if (incompatible.length > 0)
    return fail("feature-003-final", "FEATURE_003_REPORT_INCOMPATIBLE", incompatible.join("; "));
  const finishedAt = Date.parse(String(parsed.finishedAt ?? parsed.processGateCompletedAt ?? ""));
  if (!Number.isFinite(finishedAt) || finishedAt > nowMs || nowMs - finishedAt > maximumAgeMs) {
    return fail(
      "feature-003-final",
      "FEATURE_003_REPORT_STALE",
      `finishedAt=${String(parsed.finishedAt ?? parsed.processGateCompletedAt)}; maximumAgeMs=${maximumAgeMs}`,
    );
  }
  return pass(
    "feature-003-final",
    "FEATURE_003_REPORT_ACCEPTED",
    `${requirement.path} ${actualDigest}`,
  );
}

function digestCheck(
  root: string,
  requirement: Feature005DigestRequirement,
): Feature005PrerequisiteCheck {
  let path: string;
  try {
    path = safePath(root, requirement.path);
  } catch (error) {
    return fail(
      requirement.id,
      "CONSUMED_CONTRACT_PATH_INVALID",
      error instanceof Error ? error.message : String(error),
    );
  }
  if (!existsSync(path))
    return fail(requirement.id, "CONSUMED_CONTRACT_MISSING", `${requirement.path} is missing`);
  const actual = digest(readFileSync(path));
  return actual === requirement.sha256
    ? pass(requirement.id, "CONSUMED_CONTRACT_ACCEPTED", `${requirement.path} ${actual}`)
    : fail(
        requirement.id,
        "CONSUMED_CONTRACT_DIGEST_MISMATCH",
        `${requirement.path} sha256=${actual}; expected=${requirement.sha256}`,
      );
}

function manualContractCheck(
  root: string,
  requirement: Feature005DigestRequirement,
): Feature005PrerequisiteCheck {
  let path: string;
  try {
    path = safePath(root, requirement.path);
  } catch (error) {
    return fail(
      requirement.id,
      "FEATURE_002_MANUAL_CONTRACT_PATH_INVALID",
      error instanceof Error ? error.message : String(error),
    );
  }
  if (!existsSync(path))
    return fail(
      requirement.id,
      "FEATURE_002_MANUAL_CONTRACT_MISSING",
      `${requirement.path} is missing`,
    );
  const bytes = readFileSync(path, "utf8");
  const actual = digest(bytes);
  if (actual !== requirement.sha256)
    return fail(
      requirement.id,
      "FEATURE_002_MANUAL_CONTRACT_DIGEST_MISMATCH",
      `${requirement.path} sha256=${actual}; expected=${requirement.sha256}`,
    );
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes) as unknown;
  } catch {
    return fail(requirement.id, "FEATURE_002_MANUAL_CONTRACT_INVALID_JSON", requirement.path);
  }
  const encoded = JSON.stringify(parsed);
  if (encoded.includes("AUTOMATED"))
    return fail(
      requirement.id,
      "FEATURE_002_MANUAL_CONTRACT_WIDENED",
      `${requirement.path} contains AUTOMATED`,
    );
  if (
    isRecord(parsed) &&
    isRecord(parsed.properties) &&
    isRecord(parsed.properties.mode) &&
    parsed.properties.mode.const !== "MANUAL"
  ) {
    return fail(
      requirement.id,
      "FEATURE_002_MANUAL_CONTRACT_WIDENED",
      `${requirement.path} no longer pins mode=MANUAL`,
    );
  }
  return pass(
    requirement.id,
    "FEATURE_002_MANUAL_CONTRACT_ACCEPTED",
    `${requirement.path} ${actual}`,
  );
}

function negativeFixtureCheck(
  root: string,
  requirement: Omit<Feature005DigestRequirement, "id">,
): Feature005PrerequisiteCheck {
  const id = "feature-002-automated-negative";
  let path: string;
  try {
    path = safePath(root, requirement.path);
  } catch (error) {
    return fail(
      id,
      "FEATURE_002_AUTOMATED_NEGATIVE_PATH_INVALID",
      error instanceof Error ? error.message : String(error),
    );
  }
  if (!existsSync(path))
    return fail(id, "FEATURE_002_AUTOMATED_NEGATIVE_MISSING", `${requirement.path} is missing`);
  const bytes = readFileSync(path, "utf8");
  const actual = digest(bytes);
  if (actual !== requirement.sha256)
    return fail(
      id,
      "FEATURE_002_AUTOMATED_NEGATIVE_DIGEST_MISMATCH",
      `${requirement.path} sha256=${actual}; expected=${requirement.sha256}`,
    );
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes) as unknown;
  } catch {
    return fail(id, "FEATURE_002_AUTOMATED_NEGATIVE_INVALID_JSON", requirement.path);
  }
  if (!JSON.stringify(parsed).includes("AUTOMATED"))
    return fail(
      id,
      "FEATURE_002_AUTOMATED_NEGATIVE_INCOMPATIBLE",
      `${requirement.path} no longer exercises AUTOMATED mode`,
    );
  return pass(id, "FEATURE_002_AUTOMATED_NEGATIVE_ACCEPTED", `${requirement.path} ${actual}`);
}

function feature004Check(
  root: string,
  requirement: Feature005PrerequisiteManifest["feature004Evidence"],
): Feature005PrerequisiteCheck {
  if (!requirement.requiredForStandalone) {
    return pass(
      "feature-004-evidence",
      "FEATURE_004_NOT_REQUIRED_STANDALONE",
      `${requirement.path} is reserved for the separate pilot-release gate`,
    );
  }
  const path = safePath(root, requirement.path);
  if (!existsSync(path))
    return fail(
      "feature-004-evidence",
      "FEATURE_004_REPORT_MISSING",
      `${requirement.path} is missing`,
    );
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return isRecord(parsed) && parsed.status === "PASS"
      ? pass("feature-004-evidence", "FEATURE_004_REPORT_ACCEPTED", requirement.path)
      : fail("feature-004-evidence", "FEATURE_004_REPORT_INCOMPATIBLE", requirement.path);
  } catch {
    return fail("feature-004-evidence", "FEATURE_004_REPORT_INVALID_JSON", requirement.path);
  }
}

export function verifyFeature005PrerequisiteBinding(
  root: string,
  manifest: Feature005PrerequisiteManifest = FEATURE_005_PREREQUISITE_MANIFEST,
  nowMs = Date.now(),
): Feature005PrerequisiteBinding {
  const feature003Report = feature003ReportCheck(
    root,
    manifest.feature003Report,
    manifest.maximumReportAgeMs,
    nowMs,
  );
  const consumedContracts = Object.freeze(
    manifest.consumedContracts.map((requirement) => digestCheck(root, requirement)),
  );
  const feature002ManualContracts = Object.freeze(
    manifest.feature002ManualContracts.map((requirement) => manualContractCheck(root, requirement)),
  );
  const feature002AutomatedNegativeFixture = negativeFixtureCheck(
    root,
    manifest.feature002AutomatedNegativeFixture,
  );
  const feature004Evidence = feature004Check(root, manifest.feature004Evidence);
  const checks = [
    feature003Report,
    ...consumedContracts,
    ...feature002ManualContracts,
    feature002AutomatedNegativeFixture,
    feature004Evidence,
  ];
  return Object.freeze({
    status: checks.every(({ status }) => status === "PASS") ? "PASS" : "FAIL",
    feature003Report,
    consumedContracts,
    feature002ManualContracts,
    feature002AutomatedNegativeFixture,
    feature004Evidence,
  });
}

function run(): void {
  const startedAt = new Date();
  const result = verifyFeature005PrerequisiteBinding(workspace);
  const report = {
    schemaVersion: 1,
    feature: "005-gitlab-automated-validation",
    gate: "feature-005-prerequisites",
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    manifest: FEATURE_005_PREREQUISITE_MANIFEST,
    ...result,
  };
  const target = safePath(workspace, outputPath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, stringifyPortableJson(report, workspace), "utf8");
  console.table([
    result.feature003Report,
    ...result.consumedContracts,
    ...result.feature002ManualContracts,
    result.feature002AutomatedNegativeFixture,
    result.feature004Evidence,
  ]);
  console.log(
    `[prerequisites:005] ${result.status}; feature004=NOT_REQUIRED_STANDALONE; report: ${target}`,
  );
  if (result.status !== "PASS") process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) run();
