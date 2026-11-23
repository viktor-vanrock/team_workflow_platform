import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { stringifyPortableJson } from "./portable-json.mts";

export interface PrerequisiteReportRequirement {
  readonly id: string;
  readonly path: string;
  readonly sha256: string;
  readonly feature: string;
  readonly gate?: string;
}

export interface PrerequisiteManifest {
  readonly schemaVersion: 1;
  readonly reports: readonly PrerequisiteReportRequirement[];
}

export interface PrerequisiteCheck {
  readonly id: string;
  readonly status: "PASS" | "FAIL";
  readonly code: string;
  readonly detail: string;
}

export interface PrerequisiteVerification {
  readonly status: "PASS" | "FAIL";
  readonly checks: readonly PrerequisiteCheck[];
}

export interface Feature003NodeVersionInput {
  readonly active: string;
  readonly configured: string;
  readonly engine: string;
}

interface JsonRecord {
  readonly [key: string]: unknown;
}

const workspace = resolve(import.meta.dirname, "../..");
const prerequisiteDocument = "specs/003-jira-operational-authority/implementation-prerequisites.md";
const reportPath = "reports/003-jira-operational-authority/prerequisites.json";
const manifestStart = "<!-- feature-003-prerequisite-manifest:start -->";
const manifestEnd = "<!-- feature-003-prerequisite-manifest:end -->";

export const FEATURE_003_NODE_VERSION = "24.20.0";

function fail(id: string, code: string, detail: string): PrerequisiteCheck {
  return Object.freeze({ id, status: "FAIL", code, detail });
}

function pass(id: string, code: string, detail: string): PrerequisiteCheck {
  return Object.freeze({ id, status: "PASS", code, detail });
}

export function verifyFeature003NodeVersion(input: Feature003NodeVersionInput): PrerequisiteCheck {
  const versions = Object.freeze({
    active: input.active.replace(/^v/u, "").trim(),
    configured: input.configured.trim(),
    engine: input.engine.trim(),
  });
  const detail = `active=${versions.active}; .node-version=${versions.configured}; package engine=${versions.engine}; expected=${FEATURE_003_NODE_VERSION}`;
  return Object.values(versions).every((version) => version === FEATURE_003_NODE_VERSION)
    ? pass("node-runtime", "NODE_VERSION_ACCEPTED", detail)
    : fail("node-runtime", "NODE_VERSION_MISMATCH", detail);
}

function digest(bytes: string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function safePath(root: string, relativePath: string): string {
  const target = resolve(root, relativePath);
  if (target !== root && !target.startsWith(`${root}/`))
    throw new Error(`Path escapes workspace: ${relativePath}`);
  return target;
}

function json(bytes: string): JsonRecord | undefined {
  try {
    const value = JSON.parse(bytes) as unknown;
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as JsonRecord)
      : undefined;
  } catch {
    return undefined;
  }
}

export function parsePrerequisiteManifest(markdown: string): PrerequisiteManifest {
  const start = markdown.indexOf(manifestStart);
  const end = markdown.indexOf(manifestEnd);
  if (start < 0 || end <= start) throw new Error("PREREQUISITE_MANIFEST_MARKERS_MISSING");
  const section = markdown.slice(start + manifestStart.length, end);
  const match = /```json\s*([\s\S]*?)\s*```/u.exec(section);
  if (!match?.[1]) throw new Error("PREREQUISITE_MANIFEST_JSON_MISSING");
  const value = JSON.parse(match[1]) as Partial<PrerequisiteManifest>;
  if (value.schemaVersion !== 1 || !Array.isArray(value.reports) || value.reports.length === 0)
    throw new Error("PREREQUISITE_MANIFEST_INVALID");
  const paths = new Set<string>();
  const ids = new Set<string>();
  for (const report of value.reports) {
    if (!report.id || !report.path || !report.feature || !/^[a-f0-9]{64}$/u.test(report.sha256))
      throw new Error("PREREQUISITE_REPORT_REQUIREMENT_INVALID");
    if (ids.has(report.id) || paths.has(report.path))
      throw new Error("PREREQUISITE_REPORT_REQUIREMENT_DUPLICATE");
    ids.add(report.id);
    paths.add(report.path);
  }
  return Object.freeze({ schemaVersion: 1, reports: Object.freeze([...value.reports]) });
}

export function verifyPrerequisiteReports(
  root: string,
  requirements: readonly PrerequisiteReportRequirement[],
): PrerequisiteVerification {
  const checks = requirements.map((requirement): PrerequisiteCheck => {
    let path: string;
    try {
      path = safePath(root, requirement.path);
    } catch (error) {
      return fail(
        requirement.id,
        "REPORT_PATH_INVALID",
        error instanceof Error ? error.message : String(error),
      );
    }
    if (!existsSync(path))
      return fail(requirement.id, "REPORT_MISSING", `${requirement.path} is missing`);
    const bytes = readFileSync(path, "utf8");
    const actualDigest = digest(bytes);
    if (actualDigest !== requirement.sha256)
      return fail(
        requirement.id,
        "REPORT_DIGEST_MISMATCH",
        `${requirement.path} sha256=${actualDigest}; expected ${requirement.sha256}`,
      );
    const document = json(bytes);
    if (!document)
      return fail(
        requirement.id,
        "REPORT_INVALID_JSON",
        `${requirement.path} is not a JSON object`,
      );
    const incompatible: string[] = [];
    if (document.schemaVersion !== 1)
      incompatible.push(`schemaVersion=${String(document.schemaVersion)}`);
    if (document.feature !== requirement.feature)
      incompatible.push(`feature=${String(document.feature)}`);
    if (requirement.gate !== undefined && document.gate !== requirement.gate)
      incompatible.push(`gate=${String(document.gate)}`);
    if (document.status !== "PASS") incompatible.push(`status=${String(document.status)}`);
    const stages = document.stages;
    if (
      Array.isArray(stages) &&
      stages.some(
        (stage) =>
          stage !== null && typeof stage === "object" && (stage as JsonRecord).status !== "PASS",
      )
    )
      incompatible.push("stages contain non-PASS evidence");
    if (incompatible.length > 0)
      return fail(requirement.id, "REPORT_INCOMPATIBLE", incompatible.join("; "));
    return pass(requirement.id, "REPORT_ACCEPTED", `${requirement.path} sha256=${actualDigest}`);
  });
  return Object.freeze({
    status: checks.every(({ status }) => status === "PASS") ? "PASS" : "FAIL",
    checks: Object.freeze(checks),
  });
}

function source(root: string, path: string): string | undefined {
  const target = safePath(root, path);
  return existsSync(target) ? readFileSync(target, "utf8") : undefined;
}

function packageVersion(root: string, path: string, expectedName: string): PrerequisiteCheck {
  const bytes = source(root, path);
  if (!bytes)
    return fail(`package:${expectedName}`, "IMPLEMENTATION_MISSING", `${path} is missing`);
  const value = json(bytes);
  if (value?.name !== expectedName || value.version !== "1.0.0")
    return fail(
      `package:${expectedName}`,
      "IMPLEMENTATION_INCOMPATIBLE",
      `${path} must declare ${expectedName}@1.0.0`,
    );
  return pass(`package:${expectedName}`, "IMPLEMENTATION_ACCEPTED", `${expectedName}@1.0.0`);
}

function sourceContract(
  root: string,
  id: string,
  paths: readonly string[],
  required: readonly string[],
  forbidden: readonly RegExp[] = [],
): PrerequisiteCheck {
  const bodies: string[] = [];
  const missing: string[] = [];
  for (const path of paths) {
    const body = source(root, path);
    if (body === undefined) missing.push(path);
    else bodies.push(body);
  }
  if (missing.length > 0)
    return fail(id, "IMPLEMENTATION_MISSING", `missing: ${missing.join(", ")}`);
  const combined = bodies.join("\n");
  const absent = required.filter((token) => !combined.includes(token));
  const violations = forbidden
    .filter((pattern) => pattern.test(combined))
    .map((pattern) => String(pattern));
  if (absent.length > 0 || violations.length > 0) {
    return fail(
      id,
      "IMPLEMENTATION_INCOMPATIBLE",
      [
        absent.length > 0 ? `missing tokens: ${absent.join(", ")}` : "",
        violations.length > 0 ? `forbidden patterns: ${violations.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("; "),
    );
  }
  return pass(
    id,
    "IMPLEMENTATION_ACCEPTED",
    `${paths.join(", ")} expose the required implemented surface`,
  );
}

export function verifyLivePrerequisites(root: string): PrerequisiteVerification {
  const packageJson = json(source(root, "package.json") ?? "");
  const engines = packageJson?.engines;
  const nodeEngine =
    engines !== null && typeof engines === "object" && !Array.isArray(engines)
      ? String((engines as JsonRecord).node ?? "MISSING")
      : "MISSING";
  const checks: PrerequisiteCheck[] = [
    verifyFeature003NodeVersion({
      active: process.versions.node,
      configured: source(root, ".node-version")?.trim() ?? "MISSING",
      engine: nodeEngine,
    }),
    packageVersion(root, "packages/platform-core/package.json", "@awp/platform-core"),
    packageVersion(root, "packages/platform-contracts/package.json", "@awp/platform-contracts"),
    packageVersion(root, "packages/competency-qa/package.json", "@awp/competency-qa"),
    sourceContract(
      root,
      "operational-work-item-v1",
      [
        "packages/runtime-composition/src/qa/operational-work-item.contract.ts",
        "packages/competency-qa/src/manifest.ts",
      ],
      [
        "operational-work-item",
        "1.0.0",
        "request.create",
        "request.transition",
        "defect.create",
        "QA_REQUEST_AUTHORITY",
        "DEFECT_DESTINATION",
      ],
    ),
    sourceContract(
      root,
      "command-primary-role-round-trip",
      ["packages/platform-persistence-typeorm/src/command.repository.ts"],
      [
        "logicalRole: command.capability.logicalRole",
        "metadata.logicalRole",
        "COMMAND_LOGICAL_ROLE_MISSING",
      ],
      [/logicalRole\s*:\s*["']PRIMARY["']/u, /logicalRole[^\n]*\?\?\s*["']PRIMARY["']/u],
    ),
    sourceContract(
      root,
      "primary-configuration-round-trip",
      [
        "packages/platform-core/src/commanding/connector-command.ts",
        "packages/platform-persistence-typeorm/src/command.repository.ts",
      ],
      ["bindingRef", "profileRef", "expectedExternalState", "initialAuthorizationBasisHash"],
    ),
    sourceContract(
      root,
      "generic-confirmation-unit-of-work",
      [
        "packages/platform-contracts/src/extensions/confirmation-hook.ts",
        "packages/platform-core/src/work-management/confirm-operational-effect.ts",
        "packages/platform-persistence-typeorm/src/confirmation-unit-of-work.ts",
      ],
      [
        "OperationalConfirmationHook",
        "ConfirmOperationalEffect",
        "TypeOrmConfirmationUnitOfWork",
        "PackConfirmationDelta",
        "SERIALIZABLE",
      ],
      [/if\s*\([^)]*qa\./iu],
    ),
    sourceContract(
      root,
      "exact-external-command-approval",
      [
        "packages/platform-core/src/approval/approval.ts",
        "packages/platform-core/src/approval/external-command-approval.ts",
      ],
      [
        "createExactApproval",
        "subjectHash",
        "profileRefs",
        "effectIdempotencyKey",
        "expectedState",
      ],
    ),
    sourceContract(
      root,
      "qa-confirmation-contributions",
      [
        "packages/competency-qa/src/application/on-qa-request-confirmed.ts",
        "packages/competency-qa/src/application/on-defect-confirmed.ts",
        "packages/competency-qa/src/application/on-completion-confirmed.ts",
        "packages/runtime-composition/src/qa/confirmation-hooks.ts",
      ],
      [
        "createQaRequestConfirmationHook",
        "createQaTypeOrmDefectConfirmationHook",
        "createQaTypeOrmCompletionConfirmationHook",
      ],
    ),
    sourceContract(
      root,
      "runnable-api-worker",
      [
        "apps/api/package.json",
        "apps/api/project.json",
        "apps/api/src/main.ts",
        "apps/worker/package.json",
        "apps/worker/project.json",
        "apps/worker/src/main.ts",
      ],
      ['"start"', "typecheck", "build", "bootstrapApi", "bootstrapWorker", "NestFactory.create"],
    ),
    sourceContract(
      root,
      "runnable-local-composition",
      [
        "infra/compose/docker-compose.local.yml",
        "packages/runtime-composition/package.json",
        "packages/runtime-composition/src/qa/composition.ts",
      ],
      ["postgres", "mock-hub", "@awp/connector-mock", "qa-local"],
    ),
  ];
  const prerequisite = source(root, prerequisiteDocument);
  checks.push(
    prerequisite?.includes("explicitly **not** a Feature 003 entry prerequisite")
      ? pass(
          "feature-002-import-hook",
          "EXPLICIT_NON_REQUIREMENT",
          "Feature 003 owns the additive generic operational-import hook",
        )
      : fail(
          "feature-002-import-hook",
          "NON_REQUIREMENT_UNDOCUMENTED",
          "The Feature 002 import-hook non-requirement is not explicit",
        ),
  );
  return Object.freeze({
    status: checks.every(({ status }) => status === "PASS") ? "PASS" : "FAIL",
    checks: Object.freeze(checks),
  });
}

export function verifyFeature003Prerequisites(root = workspace): Readonly<{
  status: "PASS" | "FAIL";
  reports: PrerequisiteVerification;
  implementation: PrerequisiteVerification;
}> {
  const document = source(root, prerequisiteDocument);
  if (!document) {
    const missing = Object.freeze({
      status: "FAIL" as const,
      checks: Object.freeze([
        fail(
          "prerequisite-manifest",
          "IMPLEMENTATION_MISSING",
          `${prerequisiteDocument} is missing`,
        ),
      ]),
    });
    return Object.freeze({
      status: "FAIL",
      reports: missing,
      implementation: verifyLivePrerequisites(root),
    });
  }
  let reports: PrerequisiteVerification;
  try {
    const manifest = parsePrerequisiteManifest(document);
    reports = verifyPrerequisiteReports(root, manifest.reports);
  } catch (error) {
    reports = Object.freeze({
      status: "FAIL",
      checks: Object.freeze([
        fail(
          "prerequisite-manifest",
          "MANIFEST_INVALID",
          error instanceof Error ? error.message : String(error),
        ),
      ]),
    });
  }
  const implementation = verifyLivePrerequisites(root);
  return Object.freeze({
    status: reports.status === "PASS" && implementation.status === "PASS" ? "PASS" : "FAIL",
    reports,
    implementation,
  });
}

function run(): void {
  const startedAt = new Date();
  const result = verifyFeature003Prerequisites(workspace);
  const report = {
    schemaVersion: 1,
    feature: "003-jira-operational-authority",
    gate: "feature-003-prerequisites",
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    ...result,
  };
  const output = safePath(workspace, reportPath);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, stringifyPortableJson(report, workspace), "utf8");
  console.table([...result.reports.checks, ...result.implementation.checks]);
  console.log(`[prerequisites:003] ${result.status}; report: ${output}`);
  if (result.status !== "PASS") process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) run();
