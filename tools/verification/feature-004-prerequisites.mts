import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { stringifyPortableJson } from "./portable-json.mts";

export interface Feature004DigestRequirement {
  readonly id: string;
  readonly path: string;
  readonly sha256: string;
}

export interface Feature004ReportRequirement {
  readonly path: string;
  readonly sha256: string;
  readonly feature: string;
  readonly gate: string;
  readonly schemaVersion?: number;
}

export interface Feature004PrerequisiteManifest {
  readonly schemaVersion: 1;
  readonly feature003Report: Feature004ReportRequirement;
  readonly consumedContracts: readonly Feature004DigestRequirement[];
}

export interface Feature004PrerequisiteCheck {
  readonly id: string;
  readonly status: "PASS" | "FAIL";
  readonly code: string;
  readonly detail: string;
}

export interface Feature004PrerequisiteBinding {
  readonly status: "PASS" | "FAIL";
  readonly report: Feature004PrerequisiteCheck;
  readonly consumedContracts: readonly Feature004PrerequisiteCheck[];
  readonly optionalNonProdEvidence?: Readonly<{
    readonly metadata: string;
    readonly conformance: string;
    readonly livePassRequiredForLocalRelease: boolean;
  }>;
}

type JsonRecord = Readonly<Record<string, unknown>>;

const workspace = resolve(import.meta.dirname, "../..");
const outputPath = "reports/004-mattermost-hermes-intake/prerequisites.json";

export const FEATURE_004_PREREQUISITE_MANIFEST: Feature004PrerequisiteManifest = Object.freeze({
  schemaVersion: 1,
  feature003Report: Object.freeze({
    path: "reports/003-jira-operational-authority/final-gate.json",
    sha256: "sha256:ff8a941316b60cb46226064e4508bc1aecaf4b31e0a1ea95573063c150c7a008",
    feature: "003-jira-operational-authority",
    gate: "feature-003-final",
    schemaVersion: 2,
  }),
  consumedContracts: Object.freeze([
    {
      id: "schema-registry",
      path: "packages/platform-contracts/src/generated/schema-documents.ts",
      sha256: "sha256:9f18f2f8394ff9c6812984da863fbb0693ad6dfad9f23bdb1d9509f85b2df1cc",
    },
    {
      id: "operational-work-item",
      path: "packages/runtime-composition/src/qa/operational-work-item.contract.ts",
      sha256: "sha256:72a9b922fd88ac32960f57f859eb8daa50131bbd5a0d9c97f33d250c06565db3",
    },
    {
      id: "qa-manifest",
      path: "packages/competency-qa/src/manifest.ts",
      sha256: "sha256:e397d5567de2c5c7455f826afb8596282e94609a8e69f0196c61d4c51f9c77b7",
    },
    {
      id: "jira-manifest",
      path: "packages/connector-jira/src/manifest.ts",
      sha256: "sha256:09cb8e157466709175bea4242af4cba95b6b50c0eb2c5eb9544f53fd31bbed2f",
    },
    {
      id: "confirmation-hook",
      path: "packages/platform-contracts/src/extensions/confirmation-hook.ts",
      sha256: "sha256:ca619f348e2af7d99005868abdbb998e76474d174dd047796cf3c8133d09f044",
    },
    {
      id: "confirm-operational-effect",
      path: "packages/platform-core/src/work-management/confirm-operational-effect.ts",
      sha256: "sha256:58507b29e1369f400636921302d1e51fdd181c18a991e21375c477ae4f5ec146",
    },
    {
      id: "confirmation-unit-of-work",
      path: "packages/platform-persistence-typeorm/src/confirmation-unit-of-work.ts",
      sha256: "sha256:2dcc87a5c27c9619e61a173d8ad751cadc0dcc23da8fe11f1916d9541cb345e7",
    },
    {
      id: "core-migration-registry",
      path: "packages/platform-persistence-typeorm/src/migration-registry.ts",
      sha256: "sha256:dabec6d59a01e3ebf21d14cb923a5b241f6a1953a8662330a142b25a4f093fff",
    },
    {
      id: "core-0095",
      path: "packages/platform-persistence-typeorm/src/migrations/core/0095-external-identity-import-reconciliation.ts",
      sha256: "sha256:1285df088dee9df5399beef04947a733761de263ebd7bdf37bf8de0ec6a81e1a",
    },
    // The QA registry is an append-only extension point for 004; pin the last immutable 003 migration instead.
    {
      id: "qa-2030",
      path: "packages/competency-qa/src/persistence/migrations/2030-qa-verdict-completion.ts",
      sha256: "sha256:940625a8292b8c5dc26cdaef5eb5a4a6eb4e5adc89d0569a7cddae668ee95eb4",
    },
    {
      id: "mock-hub-migration-runner",
      path: "apps/mock-hub/src/persistence/migration-runner.ts",
      sha256: "sha256:2c8f485489330a54f412ec6022c658c227f8d6e3666cc166cb320dca03d24f29",
    },
    {
      id: "mock-hub-jira-0042",
      path: "apps/mock-hub/src/persistence/migrations/0042-jira-effect-call-audit.ts",
      sha256: "sha256:6bcb46529b47818177d69084128876fdc3e0ccd7527cd63cde6d965a9a16d992",
    },
  ]),
});

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function pass(id: string, code: string, detail: string): Feature004PrerequisiteCheck {
  return Object.freeze({ id, status: "PASS", code, detail });
}

function fail(id: string, code: string, detail: string): Feature004PrerequisiteCheck {
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

function reportCheck(
  root: string,
  requirement: Feature004ReportRequirement,
): Readonly<{
  check: Feature004PrerequisiteCheck;
  document?: JsonRecord;
}> {
  let path: string;
  try {
    path = safePath(root, requirement.path);
  } catch (error) {
    return {
      check: fail(
        "feature-003-final",
        "FEATURE_003_REPORT_PATH_INVALID",
        error instanceof Error ? error.message : String(error),
      ),
    };
  }
  if (!existsSync(path))
    return {
      check: fail(
        "feature-003-final",
        "FEATURE_003_REPORT_MISSING",
        `${requirement.path} is missing`,
      ),
    };
  const bytes = readFileSync(path, "utf8");
  const actualDigest = digest(bytes);
  if (actualDigest !== requirement.sha256) {
    return {
      check: fail(
        "feature-003-final",
        "FEATURE_003_REPORT_DIGEST_MISMATCH",
        `${requirement.path} sha256=${actualDigest}; expected=${requirement.sha256}`,
      ),
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes) as unknown;
  } catch {
    return {
      check: fail(
        "feature-003-final",
        "FEATURE_003_REPORT_INVALID_JSON",
        `${requirement.path} is not valid JSON`,
      ),
    };
  }
  if (!isRecord(parsed))
    return {
      check: fail(
        "feature-003-final",
        "FEATURE_003_REPORT_INVALID_JSON",
        `${requirement.path} is not a JSON object`,
      ),
    };
  const incompatible: string[] = [];
  if (requirement.schemaVersion !== undefined && parsed.schemaVersion !== requirement.schemaVersion)
    incompatible.push(`schemaVersion=${String(parsed.schemaVersion)}`);
  if (parsed.feature !== requirement.feature)
    incompatible.push(`feature=${String(parsed.feature)}`);
  if (parsed.gate !== requirement.gate) incompatible.push(`gate=${String(parsed.gate)}`);
  if (parsed.status !== "PASS") incompatible.push(`status=${String(parsed.status)}`);
  const stages = Array.isArray(parsed.stages) ? parsed.stages : [];
  if (stages.length === 0 || stages.some((stage) => !isRecord(stage) || stage.status !== "PASS"))
    incompatible.push("process gates are missing or non-PASS");
  const handoff = isRecord(parsed.handoff) ? parsed.handoff : undefined;
  if (
    handoff?.status !== "BOUND" ||
    handoff.generatedAfterAllProcessGates !== true ||
    handoff.verificationCommand !== "pnpm verify:003:evidence"
  ) {
    incompatible.push("handoff attestation is missing or incompatible");
  }
  if (incompatible.length > 0) {
    return {
      check: fail("feature-003-final", "FEATURE_003_REPORT_INCOMPATIBLE", incompatible.join("; ")),
      document: parsed,
    };
  }
  return {
    check: pass(
      "feature-003-final",
      "FEATURE_003_REPORT_ACCEPTED",
      `${requirement.path} ${actualDigest}`,
    ),
    document: parsed,
  };
}

function contractCheck(
  root: string,
  requirement: Feature004DigestRequirement,
): Feature004PrerequisiteCheck {
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
  const actualDigest = digest(readFileSync(path));
  return actualDigest === requirement.sha256
    ? pass(requirement.id, "CONSUMED_CONTRACT_ACCEPTED", `${requirement.path} ${actualDigest}`)
    : fail(
        requirement.id,
        "CONSUMED_CONTRACT_DIGEST_MISMATCH",
        `${requirement.path} sha256=${actualDigest}; expected=${requirement.sha256}`,
      );
}

export function verifyFeature004PrerequisiteBinding(
  root: string,
  manifest: Feature004PrerequisiteManifest = FEATURE_004_PREREQUISITE_MANIFEST,
): Feature004PrerequisiteBinding {
  const report = reportCheck(root, manifest.feature003Report);
  const consumedContracts = Object.freeze(
    manifest.consumedContracts.map((requirement) => contractCheck(root, requirement)),
  );
  const nonprod =
    report.document && isRecord(report.document.nonprod) ? report.document.nonprod : undefined;
  const optionalNonProdEvidence = nonprod
    ? Object.freeze({
        metadata: String(nonprod.metadata),
        conformance: String(nonprod.conformance),
        livePassRequiredForLocalRelease: nonprod.livePassRequiredForLocalRelease === true,
      })
    : undefined;
  const status =
    report.check.status === "PASS" && consumedContracts.every((check) => check.status === "PASS")
      ? "PASS"
      : "FAIL";
  return Object.freeze({
    status,
    report: report.check,
    consumedContracts,
    ...(optionalNonProdEvidence ? { optionalNonProdEvidence } : {}),
  });
}

function run(): void {
  const startedAt = new Date();
  const result = verifyFeature004PrerequisiteBinding(workspace);
  const report = {
    schemaVersion: 1,
    feature: "004-mattermost-hermes-intake",
    gate: "feature-004-prerequisites",
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    manifest: FEATURE_004_PREREQUISITE_MANIFEST,
    ...result,
  };
  const target = safePath(workspace, outputPath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, stringifyPortableJson(report, workspace), "utf8");
  console.table([result.report, ...result.consumedContracts]);
  console.log(
    `[prerequisites:004] ${result.status}; optionalJira=${result.optionalNonProdEvidence?.conformance ?? "UNAVAILABLE"}; report: ${target}`,
  );
  if (result.status !== "PASS") process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) run();
