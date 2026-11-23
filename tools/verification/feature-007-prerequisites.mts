import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { stringifyPortableJson } from "./portable-json.mts";

type JsonRecord = Record<string, unknown>;
type Status = "PASS" | "FAIL";

export interface Feature007UpstreamReportRequirement {
  readonly id: string;
  readonly path: string;
  readonly sha256: string;
  readonly schemaVersion: number;
  readonly feature: string;
  readonly gate: string;
}

export interface Feature007TreeRequirement {
  readonly paths: readonly string[];
  readonly sha256: string;
}

export interface Feature007CompatibilityRequirement extends Feature007TreeRequirement {
  readonly requiredTokens: readonly string[];
}

export interface Feature007PrerequisiteManifest {
  readonly schemaVersion: 1;
  readonly maximumReportAgeMs: number;
  readonly upstreamReport: Feature007UpstreamReportRequirement;
  readonly compatibilitySnapshot: Feature007CompatibilityRequirement;
  readonly migrationSnapshot: Feature007TreeRequirement;
}

export interface Feature007PrerequisiteCheck {
  readonly id: string;
  readonly status: Status;
  readonly code: string;
  readonly detail: string;
}

export interface Feature007PrerequisiteBinding {
  readonly status: Status;
  readonly upstreamReport: Feature007PrerequisiteCheck;
  readonly compatibilitySnapshot: Feature007PrerequisiteCheck;
  readonly migrationSnapshot: Feature007PrerequisiteCheck;
}

export type Feature007SourceBindingProbe = (report: Readonly<JsonRecord>) => readonly string[];

const workspace = resolve(import.meta.dirname, "../..");
const outputPath = "reports/007-project-onboarding-evidence-security/prerequisites.json";

const compatibilityPaths = Object.freeze([
  "specs/001-extension-kernel-local-skeleton/contracts/schemas/integration/project-integration-binding-version.v1.schema.json",
  "specs/002-qa-manual-walking-skeleton/contracts/schemas/qa/qa-project-context.v1.schema.json",
  "specs/002-qa-manual-walking-skeleton/contracts/schemas/qa/target-snapshot.v1.schema.json",
  "specs/002-qa-manual-walking-skeleton/contracts/schemas/qa/evidence-manifest.v1.schema.json",
]);

const migrationPaths = Object.freeze([
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
  "packages/platform-persistence-typeorm/src/migrations/core/0130-queue-policy-calendar.ts",
  "packages/platform-persistence-typeorm/src/migrations/core/0135-queue-projection-sla.ts",
  "packages/platform-persistence-typeorm/src/migrations/core/0140-queue-controls-capacity.ts",
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
  "packages/competency-qa/src/persistence/migrations/2070-qa-queue-facts.ts",
]);

export const FEATURE_007_PREREQUISITE_MANIFEST: Feature007PrerequisiteManifest = Object.freeze({
  schemaVersion: 1,
  maximumReportAgeMs: 604_800_000,
  upstreamReport: {
    id: "feature-006",
    path: "reports/006-queue-triage-capacity-sla/final-gate.json",
    sha256: "sha256:55d7159fc56ecd81db5184194e84f7d8cea6c005b096d7341a012025262409ea",
    schemaVersion: 1,
    feature: "006-queue-triage-capacity-sla",
    gate: "feature-006-final",
  },
  compatibilitySnapshot: {
    paths: compatibilityPaths,
    sha256: "sha256:9fb4a71f3d0b1593548a3e1d74124cc35b52038083b7178d069f54e5de6f76fe",
    requiredTokens: [
      "Project Integration Binding Version",
      "configurationRefs",
      "resourceRefs",
      "Immutable QA Target Snapshot",
      "Canonical QA Evidence Manifest Content",
    ],
  },
  migrationSnapshot: {
    paths: migrationPaths,
    sha256: "sha256:c3a5b4083ef447700748c5c2b48595252b4d599095cb8731c19bd15b72e40f77",
  },
});

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function pass(id: string, code: string, detail: string): Feature007PrerequisiteCheck {
  return Object.freeze({ id, status: "PASS", code, detail });
}

function fail(id: string, code: string, detail: string): Feature007PrerequisiteCheck {
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

function defaultSourceBindingProbe(root: string): Feature007SourceBindingProbe {
  return (report) => {
    const failures: string[] = [];
    const evidence = isRecord(report.evidence) ? report.evidence : undefined;
    if (
      !evidence ||
      typeof evidence.path !== "string" ||
      typeof evidence.sha256 !== "string" ||
      evidence.status !== "PASS"
    ) {
      return ["FEATURE_006_EVIDENCE_REFERENCE_INVALID"];
    }
    let target: string;
    try {
      target = safePath(root, evidence.path);
    } catch {
      return ["FEATURE_006_EVIDENCE_PATH_INVALID"];
    }
    if (!existsSync(target)) return ["FEATURE_006_EVIDENCE_MISSING"];
    const bytes = readFileSync(target, "utf8");
    if (digest(bytes) !== evidence.sha256) failures.push("FEATURE_006_EVIDENCE_DIGEST_MISMATCH");
    let parsed: unknown;
    try {
      parsed = JSON.parse(bytes) as unknown;
    } catch {
      return [...failures, "FEATURE_006_EVIDENCE_INVALID_JSON"];
    }
    if (!isRecord(parsed)) return [...failures, "FEATURE_006_EVIDENCE_INVALID_JSON"];
    if (parsed.status !== "PASS" || parsed.feature !== "006-queue-triage-capacity-sla")
      failures.push("FEATURE_006_EVIDENCE_NOT_PASS");
    const snapshots = isRecord(parsed.snapshots) ? parsed.snapshots : undefined;
    const tasks = snapshots && isRecord(snapshots.tasks) ? snapshots.tasks : undefined;
    if (!tasks || !Array.isArray(tasks.pendingTaskIds) || tasks.pendingTaskIds.length > 0)
      failures.push("TASKS_PENDING");
    for (const name of ["source", "contracts", "migrations", "runtime"] as const) {
      const snapshot = snapshots && isRecord(snapshots[name]) ? snapshots[name] : undefined;
      if (
        !snapshot ||
        typeof snapshot.sha256 !== "string" ||
        !Array.isArray(snapshot.paths) ||
        !Array.isArray(snapshot.missing) ||
        snapshot.missing.length > 0
      )
        failures.push(`${name.toUpperCase()}_SNAPSHOT_INVALID`);
    }
    return failures;
  };
}

function upstreamCheck(
  root: string,
  requirement: Feature007UpstreamReportRequirement,
  maximumReportAgeMs: number,
  nowMs: number,
  probe: Feature007SourceBindingProbe,
): Feature007PrerequisiteCheck {
  let target: string;
  try {
    target = safePath(root, requirement.path);
  } catch (error) {
    return fail(
      requirement.id,
      "FEATURE_006_REPORT_PATH_INVALID",
      error instanceof Error ? error.message : String(error),
    );
  }
  if (!existsSync(target))
    return fail(requirement.id, "FEATURE_006_REPORT_MISSING", requirement.path);
  const bytes = readFileSync(target, "utf8");
  const actualDigest = digest(bytes);
  if (actualDigest !== requirement.sha256)
    return fail(
      requirement.id,
      "FEATURE_006_REPORT_DIGEST_MISMATCH",
      `${actualDigest}; expected=${requirement.sha256}`,
    );
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes) as unknown;
  } catch {
    return fail(requirement.id, "FEATURE_006_REPORT_INVALID_JSON", requirement.path);
  }
  if (!isRecord(parsed))
    return fail(requirement.id, "FEATURE_006_REPORT_INVALID_JSON", requirement.path);
  const pendingTaskIds = parsed.pendingTaskIds;
  const incompatible =
    parsed.schemaVersion !== requirement.schemaVersion ||
    parsed.feature !== requirement.feature ||
    parsed.gate !== requirement.gate ||
    parsed.status !== "PASS" ||
    parsed.contour !== "qa-jira-gitlab-mattermost-local" ||
    parsed.production !== "DENIED" ||
    (pendingTaskIds !== undefined && (!Array.isArray(pendingTaskIds) || pendingTaskIds.length > 0));
  if (incompatible)
    return fail(requirement.id, "FEATURE_006_REPORT_INCOMPATIBLE", requirement.path);
  const finishedAt = Date.parse(String(parsed.finishedAt ?? ""));
  if (
    !Number.isFinite(finishedAt) ||
    finishedAt > nowMs ||
    nowMs - finishedAt > maximumReportAgeMs
  ) {
    return fail(
      requirement.id,
      "FEATURE_006_REPORT_STALE",
      `finishedAt=${String(parsed.finishedAt)}`,
    );
  }
  const failures = probe(parsed);
  if (failures.length > 0)
    return fail(requirement.id, "FEATURE_006_SOURCE_BINDING_MISMATCH", failures.join("; "));
  return pass(requirement.id, "FEATURE_006_REPORT_ACCEPTED", `${requirement.path} ${actualDigest}`);
}

function compatibilityCheck(
  root: string,
  requirement: Feature007CompatibilityRequirement,
): Feature007PrerequisiteCheck {
  const current = treeDigest(root, requirement.paths);
  if (current.missing.length > 0)
    return fail(
      "feature-001-006-compatibility",
      "FEATURE_001_006_COMPATIBILITY_MISSING",
      current.missing.join(","),
    );
  if (current.sha256 !== requirement.sha256)
    return fail(
      "feature-001-006-compatibility",
      "FEATURE_001_006_COMPATIBILITY_DIGEST_MISMATCH",
      `${String(current.sha256)}; expected=${requirement.sha256}`,
    );
  const text = requirement.paths
    .map((path) => readFileSync(safePath(root, path), "utf8"))
    .join("\n");
  const missing = requirement.requiredTokens.filter((token) => !text.includes(token));
  return missing.length === 0
    ? pass(
        "feature-001-006-compatibility",
        "FEATURE_001_006_COMPATIBILITY_ACCEPTED",
        `${requirement.paths.length} immutable contracts`,
      )
    : fail(
        "feature-001-006-compatibility",
        "FEATURE_001_006_COMPATIBILITY_INVALID",
        `missing=${missing.join(",")}`,
      );
}

function migrationCheck(
  root: string,
  requirement: Feature007TreeRequirement,
): Feature007PrerequisiteCheck {
  const current = treeDigest(root, requirement.paths);
  if (current.missing.length > 0)
    return fail("published-migrations", "PUBLISHED_MIGRATIONS_MISSING", current.missing.join(","));
  return current.sha256 === requirement.sha256
    ? pass(
        "published-migrations",
        "PUBLISHED_MIGRATIONS_ACCEPTED",
        `${requirement.paths.length} immutable Core/QA migrations`,
      )
    : fail(
        "published-migrations",
        "PUBLISHED_MIGRATIONS_DIGEST_MISMATCH",
        `${String(current.sha256)}; expected=${requirement.sha256}`,
      );
}

export function verifyFeature007PrerequisiteBinding(
  root: string,
  manifest: Feature007PrerequisiteManifest,
  nowMs = Date.now(),
  sourceBindingProbe: Feature007SourceBindingProbe = defaultSourceBindingProbe(root),
): Feature007PrerequisiteBinding {
  const upstreamReport = upstreamCheck(
    root,
    manifest.upstreamReport,
    manifest.maximumReportAgeMs,
    nowMs,
    sourceBindingProbe,
  );
  const compatibilitySnapshot = compatibilityCheck(root, manifest.compatibilitySnapshot);
  const migrationSnapshot = migrationCheck(root, manifest.migrationSnapshot);
  const status = [upstreamReport, compatibilitySnapshot, migrationSnapshot].every(
    (check) => check.status === "PASS",
  )
    ? "PASS"
    : "FAIL";
  return Object.freeze({ status, upstreamReport, compatibilitySnapshot, migrationSnapshot });
}

function writeAtomic(path: string, value: Readonly<Record<string, unknown>>): void {
  const target = resolve(workspace, path);
  mkdirSync(dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  writeFileSync(temporary, stringifyPortableJson(value, workspace), {
    encoding: "utf8",
    mode: 0o600,
  });
  renameSync(temporary, target);
}

function run(): void {
  const startedAt = new Date();
  const binding = verifyFeature007PrerequisiteBinding(workspace, FEATURE_007_PREREQUISITE_MANIFEST);
  writeAtomic(
    outputPath,
    Object.freeze({
      schemaVersion: 1,
      feature: "007-project-onboarding-evidence-security",
      gate: "prerequisites",
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      ...binding,
    }),
  );
  console.log(
    `[prerequisites:007] ${binding.status}; upstream=${binding.upstreamReport.status}; compatibility=${binding.compatibilitySnapshot.status}; migrations=${binding.migrationSnapshot.status}`,
  );
  for (const check of [
    binding.upstreamReport,
    binding.compatibilitySnapshot,
    binding.migrationSnapshot,
  ]) {
    if (check.status === "FAIL") console.error(`- ${check.id}: ${check.code}: ${check.detail}`);
  }
  if (binding.status !== "PASS") process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) run();
