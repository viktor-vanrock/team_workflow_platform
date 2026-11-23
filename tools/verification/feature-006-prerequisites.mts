import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { captureFeature003HandoffSnapshot } from "./feature-003-evidence-lib.mts";
import { captureFeature004HandoffSnapshot } from "./feature-004-evidence-lib.mts";
import { captureFeature005HandoffSnapshot } from "./feature-005-evidence-lib.mts";
import { stringifyPortableJson } from "./portable-json.mts";

type JsonRecord = Record<string, unknown>;
type Status = "PASS" | "FAIL";

export interface Feature006UpstreamReportRequirement {
  id: string;
  path: string;
  sha256: string;
  schemaVersion: number;
  feature: string;
  gate: string;
}

export interface Feature006TreeRequirement {
  paths: readonly string[];
  sha256: string;
}

export interface Feature006PrerequisiteManifest {
  schemaVersion: 1;
  maximumReportAgeMs: number;
  upstreamReports: Feature006UpstreamReportRequirement[];
  compatibilitySnapshot: Feature006TreeRequirement;
  migrationSnapshot: Feature006TreeRequirement;
}

export interface Feature006PrerequisiteCheck {
  readonly id: string;
  readonly status: Status;
  readonly code: string;
  readonly detail: string;
}

export interface Feature006PrerequisiteBinding {
  readonly status: Status;
  readonly upstreamReports: readonly Feature006PrerequisiteCheck[];
  readonly compatibilitySnapshot: Feature006PrerequisiteCheck;
  readonly migrationSnapshot: Feature006PrerequisiteCheck;
}

export type Feature006SourceBindingProbe = (
  id: string,
  report: Readonly<JsonRecord>,
) => readonly string[];

const workspace = resolve(import.meta.dirname, "../..");
const outputPath = "reports/006-queue-triage-capacity-sla/prerequisites.json";

const compatibilityPaths = Object.freeze([
  "packages/competency-qa/src/application/automation-review-readiness.ts",
  "packages/competency-qa/src/domain/readiness.ts",
  "packages/competency-qa/src/domain/test-session.ts",
  "packages/competency-qa/src/manifest-v1.2.ts",
  "packages/platform-core/src/work-management/intake-candidate.ts",
  "packages/platform-core/src/work-management/intake-draft-revision.ts",
  "specs/004-mattermost-hermes-intake/contracts/schemas/triage-assessment.v1.schema.json",
  "specs/005-gitlab-automated-validation/contracts/examples/gitlab-pilot-metadata.local.v1.json",
]);

const migrationPaths = Object.freeze([
  "packages/competency-qa/src/persistence/migrations/2000-qa-context-policy-requests.ts",
  "packages/competency-qa/src/persistence/migrations/2005-qa-readiness-required-plans.ts",
  "packages/competency-qa/src/persistence/migrations/2010-qa-session-planning.ts",
  "packages/competency-qa/src/persistence/migrations/2015-qa-manual-execution.ts",
  "packages/competency-qa/src/persistence/migrations/2020-qa-evidence-review.ts",
  "packages/competency-qa/src/persistence/migrations/2025-qa-findings-defect-publication.ts",
  "packages/competency-qa/src/persistence/migrations/2030-qa-verdict-completion.ts",
  "packages/competency-qa/src/persistence/migrations/2040-hermes-proposals.ts",
  "packages/competency-qa/src/persistence/migrations/2050-qa-automation-foundation.ts",
  "packages/competency-qa/src/persistence/migrations/2055-qa-automation-execution.ts",
  "packages/competency-qa/src/persistence/migrations/2060-qa-automation-review-quarantine.ts",
  "packages/platform-persistence-typeorm/src/migrations/core/0001-platform-primitives.ts",
  "packages/platform-persistence-typeorm/src/migrations/core/0010-identity-workspace.ts",
  "packages/platform-persistence-typeorm/src/migrations/core/0020-projects-entitlements.ts",
  "packages/platform-persistence-typeorm/src/migrations/core/0030-extension-registry.ts",
  "packages/platform-persistence-typeorm/src/migrations/core/0040-integration-configuration.ts",
  "packages/platform-persistence-typeorm/src/migrations/core/0050-work-and-artifacts.ts",
  "packages/platform-persistence-typeorm/src/migrations/core/0060-approvals-idempotency.ts",
  "packages/platform-persistence-typeorm/src/migrations/core/0070-connector-delivery.ts",
  "packages/platform-persistence-typeorm/src/migrations/core/0080-audit.ts",
  "packages/platform-persistence-typeorm/src/migrations/core/0090-operational-authority.ts",
  "packages/platform-persistence-typeorm/src/migrations/core/0095-external-identity-import-reconciliation.ts",
  "packages/platform-persistence-typeorm/src/migrations/core/0100-action-candidate-draft.ts",
  "packages/platform-persistence-typeorm/src/migrations/core/0105-interaction-intents.ts",
  "packages/platform-persistence-typeorm/src/migrations/core/0110-agent-runtime.ts",
  "packages/platform-persistence-typeorm/src/migrations/core/0120-notification-intents.ts",
]);

export const FEATURE_006_PREREQUISITE_MANIFEST: Feature006PrerequisiteManifest = {
  schemaVersion: 1,
  maximumReportAgeMs: 604_800_000,
  upstreamReports: [
    {
      id: "feature-003",
      path: "reports/003-jira-operational-authority/final-gate.json",
      sha256: "sha256:ff8a941316b60cb46226064e4508bc1aecaf4b31e0a1ea95573063c150c7a008",
      schemaVersion: 2,
      feature: "003-jira-operational-authority",
      gate: "feature-003-final",
    },
    {
      id: "feature-004",
      path: "reports/004-mattermost-hermes-intake/final-gate.json",
      sha256: "sha256:a596ed0705528d6f4f35dadad01ce05ba29228c87ef63e23fd8904497f5aeebc",
      schemaVersion: 1,
      feature: "004-mattermost-hermes-intake",
      gate: "feature-004-final",
    },
    {
      id: "feature-005",
      path: "reports/005-gitlab-automated-validation/final-gate.json",
      sha256: "sha256:fd95b5c76f5a7e93424edbfc0f00344d3e365170cf76a38ef1f601f1822ea723",
      schemaVersion: 1,
      feature: "005-gitlab-automated-validation",
      gate: "feature-005-final",
    },
  ],
  compatibilitySnapshot: {
    paths: compatibilityPaths,
    sha256: "sha256:494cd2e266587ad7b9fd03f20384ee5199d054314e995d7942198adfba2f3bfe",
  },
  migrationSnapshot: {
    paths: migrationPaths,
    sha256: "sha256:4babab553e6f560e140d22aaf714de656f341b5eec5f3f58861fc0531675870a",
  },
};

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function pass(id: string, code: string, detail: string): Feature006PrerequisiteCheck {
  return Object.freeze({ id, status: "PASS", code, detail });
}

function fail(id: string, code: string, detail: string): Feature006PrerequisiteCheck {
  return Object.freeze({ id, status: "FAIL", code, detail });
}

function digest(value: string | Buffer): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function safePath(root: string, path: string): string {
  const target = resolve(root, path);
  if (target !== root && !target.startsWith(`${root}/`))
    throw new Error(`Path escapes workspace: ${path}`);
  return target;
}

function treeDigest(
  root: string,
  paths: readonly string[],
): { readonly sha256?: `sha256:${string}`; readonly missing: readonly string[] } {
  const missing: string[] = [];
  const hash = createHash("sha256");
  for (const path of [...paths].sort()) {
    let target: string;
    try {
      target = safePath(root, path);
    } catch {
      missing.push(path);
      continue;
    }
    if (!existsSync(target)) {
      missing.push(path);
      continue;
    }
    hash.update(`${path}\0${digest(readFileSync(target))}\n`);
  }
  return missing.length > 0 ? { missing } : { sha256: `sha256:${hash.digest("hex")}`, missing };
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function defaultSourceBindingProbe(root: string): Feature006SourceBindingProbe {
  return (id, report) => {
    const handoff = isRecord(report.handoff) ? report.handoff : {};
    if (id === "feature-003") {
      const current = captureFeature003HandoffSnapshot(root);
      return same(handoff.taskSnapshot, current.taskSnapshot) &&
        same(handoff.runtimeSnapshot, current.runtimeSnapshot)
        ? []
        : ["FEATURE_003_TASK_OR_RUNTIME_SNAPSHOT_MISMATCH"];
    }
    if (id === "feature-004") {
      const current = captureFeature004HandoffSnapshot(root);
      return same(handoff.taskSnapshot, current.taskSnapshot) &&
        same(handoff.sourceSnapshot, current.sourceSnapshot) &&
        same(handoff.contractSnapshot, current.contractSnapshot) &&
        same(handoff.runtimeSnapshot, current.runtimeSnapshot)
        ? []
        : ["FEATURE_004_SOURCE_CONTRACT_OR_RUNTIME_SNAPSHOT_MISMATCH"];
    }
    if (id === "feature-005") {
      const current = captureFeature005HandoffSnapshot(root);
      return same(handoff.taskSnapshot, current.taskSnapshot) &&
        same(handoff.sourceSnapshot, current.sourceSnapshot) &&
        same(handoff.contractSnapshot, current.contractSnapshot) &&
        same(handoff.runtimeSnapshot, current.runtimeSnapshot)
        ? []
        : ["FEATURE_005_SOURCE_CONTRACT_OR_RUNTIME_SNAPSHOT_MISMATCH"];
    }
    return ["UPSTREAM_FEATURE_UNKNOWN"];
  };
}

function upstreamCheck(
  root: string,
  requirement: Feature006UpstreamReportRequirement,
  maximumReportAgeMs: number,
  nowMs: number,
  probe: Feature006SourceBindingProbe,
): Feature006PrerequisiteCheck {
  let target: string;
  try {
    target = safePath(root, requirement.path);
  } catch (error) {
    return fail(
      requirement.id,
      "UPSTREAM_REPORT_PATH_INVALID",
      error instanceof Error ? error.message : String(error),
    );
  }
  if (!existsSync(target)) return fail(requirement.id, "UPSTREAM_REPORT_MISSING", requirement.path);
  const bytes = readFileSync(target, "utf8");
  const actualDigest = digest(bytes);
  if (actualDigest !== requirement.sha256)
    return fail(
      requirement.id,
      "UPSTREAM_REPORT_DIGEST_MISMATCH",
      `${actualDigest}; expected=${requirement.sha256}`,
    );
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes) as unknown;
  } catch {
    return fail(requirement.id, "UPSTREAM_REPORT_INVALID_JSON", requirement.path);
  }
  if (!isRecord(parsed))
    return fail(requirement.id, "UPSTREAM_REPORT_INVALID_JSON", requirement.path);
  const handoff = isRecord(parsed.handoff) ? parsed.handoff : undefined;
  const taskSnapshot = handoff && isRecord(handoff.taskSnapshot) ? handoff.taskSnapshot : undefined;
  const incompatible =
    parsed.schemaVersion !== requirement.schemaVersion ||
    parsed.feature !== requirement.feature ||
    parsed.gate !== requirement.gate ||
    parsed.status !== "PASS" ||
    handoff?.status !== "BOUND" ||
    handoff.generatedAfterAllProcessGates !== true ||
    !taskSnapshot ||
    !Array.isArray(taskSnapshot.pendingTaskIds) ||
    taskSnapshot.pendingTaskIds.length > 0;
  if (incompatible) return fail(requirement.id, "UPSTREAM_REPORT_INCOMPATIBLE", requirement.path);
  const finishedAt = Date.parse(String(parsed.finishedAt ?? parsed.processGateCompletedAt ?? ""));
  if (
    !Number.isFinite(finishedAt) ||
    finishedAt > nowMs ||
    nowMs - finishedAt > maximumReportAgeMs
  ) {
    return fail(requirement.id, "UPSTREAM_REPORT_STALE", `finishedAt=${String(parsed.finishedAt)}`);
  }
  const failures = probe(requirement.id, parsed);
  if (failures.length > 0)
    return fail(requirement.id, "UPSTREAM_SOURCE_BINDING_MISMATCH", failures.join("; "));
  return pass(requirement.id, "UPSTREAM_REPORT_ACCEPTED", `${requirement.path} ${actualDigest}`);
}

function compatibilityCheck(
  root: string,
  requirement: Feature006TreeRequirement,
): Feature006PrerequisiteCheck {
  const current = treeDigest(root, requirement.paths);
  if (current.missing.length > 0)
    return fail(
      "feature-002-005-compatibility",
      "FEATURE_002_005_COMPATIBILITY_MISSING",
      current.missing.join(","),
    );
  if (current.sha256 !== requirement.sha256)
    return fail(
      "feature-002-005-compatibility",
      "FEATURE_002_005_COMPATIBILITY_DIGEST_MISMATCH",
      `${String(current.sha256)}; expected=${requirement.sha256}`,
    );
  const text = requirement.paths
    .map((path) => readFileSync(safePath(root, path), "utf8"))
    .join("\n");
  const requiredTokens = [
    "CANDIDATE",
    "DRAFT",
    "TriageAssessment",
    "MANUAL",
    "REVIEW_REQUIRED",
    "qa.validation",
    "1.2.0",
  ];
  const missing = requiredTokens.filter((token) => !text.includes(token));
  return missing.length === 0
    ? pass(
        "feature-002-005-compatibility",
        "FEATURE_002_005_COMPATIBILITY_ACCEPTED",
        `${requirement.paths.length} immutable inputs`,
      )
    : fail(
        "feature-002-005-compatibility",
        "FEATURE_002_005_COMPATIBILITY_INVALID",
        `missing=${missing.join(",")}`,
      );
}

function migrationCheck(
  root: string,
  requirement: Feature006TreeRequirement,
): Feature006PrerequisiteCheck {
  const current = treeDigest(root, requirement.paths);
  if (current.missing.length > 0)
    return fail("published-migrations", "PUBLISHED_MIGRATIONS_MISSING", current.missing.join(","));
  return current.sha256 === requirement.sha256
    ? pass(
        "published-migrations",
        "PUBLISHED_MIGRATIONS_ACCEPTED",
        `${requirement.paths.length} Core/QA migration inputs`,
      )
    : fail(
        "published-migrations",
        "PUBLISHED_MIGRATIONS_DIGEST_MISMATCH",
        `${String(current.sha256)}; expected=${requirement.sha256}`,
      );
}

export function verifyFeature006PrerequisiteBinding(
  root: string,
  manifest: Feature006PrerequisiteManifest,
  nowMs = Date.now(),
  sourceBindingProbe: Feature006SourceBindingProbe = defaultSourceBindingProbe(root),
): Feature006PrerequisiteBinding {
  const upstreamReports = manifest.upstreamReports.map((requirement) =>
    upstreamCheck(root, requirement, manifest.maximumReportAgeMs, nowMs, sourceBindingProbe),
  );
  const compatibilitySnapshot = compatibilityCheck(root, manifest.compatibilitySnapshot);
  const migrationSnapshot = migrationCheck(root, manifest.migrationSnapshot);
  const status = [...upstreamReports, compatibilitySnapshot, migrationSnapshot].every(
    (check) => check.status === "PASS",
  )
    ? "PASS"
    : "FAIL";
  return Object.freeze({ status, upstreamReports, compatibilitySnapshot, migrationSnapshot });
}

function writeAtomic(path: string, value: Readonly<Record<string, unknown>>): void {
  const target = resolve(workspace, path);
  mkdirSync(dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  writeFileSync(temporary, stringifyPortableJson(value, workspace), "utf8");
  renameSync(temporary, target);
}

function run(): void {
  const startedAt = new Date();
  const binding = verifyFeature006PrerequisiteBinding(workspace, FEATURE_006_PREREQUISITE_MANIFEST);
  const report = Object.freeze({
    schemaVersion: 1,
    feature: "006-queue-triage-capacity-sla",
    gate: "prerequisites",
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    ...binding,
  });
  writeAtomic(outputPath, report);
  console.log(
    `[prerequisites:006] ${binding.status}; upstream=${binding.upstreamReports.map(({ id, status }) => `${id}:${status}`).join(",")}; compatibility=${binding.compatibilitySnapshot.status}; migrations=${binding.migrationSnapshot.status}`,
  );
  for (const check of [
    ...binding.upstreamReports,
    binding.compatibilitySnapshot,
    binding.migrationSnapshot,
  ]) {
    if (check.status === "FAIL") console.error(`- ${check.id}: ${check.code}: ${check.detail}`);
  }
  if (binding.status !== "PASS") process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) run();
