import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { stringifyPortableJson } from "./portable-json.mts";

export interface Feature005GovernanceDocumentRequirement {
  path: string;
  sha256: string;
}

export interface Feature005GovernanceManifest {
  schemaVersion: 1;
  constitution: Feature005GovernanceDocumentRequirement & { version: "2.0.0" };
  specification: Feature005GovernanceDocumentRequirement;
  plan: Feature005GovernanceDocumentRequirement;
  standaloneContour: "qa-jira-gitlab-local";
  pilotReleaseContours: string[];
}

export interface Feature005GovernanceCheck {
  readonly id: "constitution" | "technical-result-authority" | "pilot-contours";
  readonly status: "PASS" | "FAIL";
  readonly code: string;
  readonly detail: string;
}

export interface Feature005GovernanceBinding {
  readonly status: "PASS" | "FAIL";
  readonly checks: readonly Feature005GovernanceCheck[];
}

const workspace = resolve(import.meta.dirname, "../..");
const outputPath = "reports/005-gitlab-automated-validation/governance.json";

export const FEATURE_005_GOVERNANCE_MANIFEST: Feature005GovernanceManifest = {
  schemaVersion: 1,
  constitution: {
    path: ".specify/memory/constitution.md",
    sha256: "sha256:d448f4586b3d798e9fd27a44471d9ad5ad1a6852db4b5255b6ee1d8c7ea7630f",
    version: "2.0.0",
  },
  specification: {
    path: "specs/005-gitlab-automated-validation/spec.md",
    sha256: "sha256:5769cb7b249db96a63953e73a574a4f6acdef66c20ee2cdc7260468e0c5401b9",
  },
  plan: {
    path: "specs/005-gitlab-automated-validation/plan.md",
    sha256: "sha256:fe3c2445a164db4577327e6e74d29682652f062d355b9cf980a550554dfe3725",
  },
  standaloneContour: "qa-jira-gitlab-local",
  pilotReleaseContours: ["qa-jira-gitlab-mattermost-development", "qa-jira-gitlab-mattermost-test"],
};

function pass(
  id: Feature005GovernanceCheck["id"],
  code: string,
  detail: string,
): Feature005GovernanceCheck {
  return Object.freeze({ id, status: "PASS", code, detail });
}

function fail(
  id: Feature005GovernanceCheck["id"],
  code: string,
  detail: string,
): Feature005GovernanceCheck {
  return Object.freeze({ id, status: "FAIL", code, detail });
}

function digest(bytes: string): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function safePath(root: string, path: string): string {
  const target = resolve(root, path);
  if (target !== root && !target.startsWith(`${root}/`))
    throw new Error(`Path escapes workspace: ${path}`);
  return target;
}

function readExact(
  root: string,
  requirement: Feature005GovernanceDocumentRequirement,
): Readonly<{ bytes?: string; error?: string }> {
  let path: string;
  try {
    path = safePath(root, requirement.path);
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  if (!existsSync(path)) return { error: `${requirement.path} is missing` };
  const bytes = readFileSync(path, "utf8");
  const actual = digest(bytes);
  return actual === requirement.sha256
    ? { bytes }
    : { error: `${requirement.path} sha256=${actual}; expected=${requirement.sha256}` };
}

export function verifyFeature005GovernanceBinding(
  root: string,
  manifest: Feature005GovernanceManifest = FEATURE_005_GOVERNANCE_MANIFEST,
): Feature005GovernanceBinding {
  const constitution = readExact(root, manifest.constitution);
  const specification = readExact(root, manifest.specification);
  const plan = readExact(root, manifest.plan);
  const checks: Feature005GovernanceCheck[] = [];

  if (constitution.error)
    checks.push(fail("constitution", "GOVERNANCE_DOCUMENT_INVALID", constitution.error));
  else {
    const bytes = constitution.bytes ?? "";
    const compatible =
      bytes.includes(`**Версия:** ${manifest.constitution.version}`) &&
      /\*\*Статус:\*\*\s*Ratified\b/u.test(bytes) &&
      /Technical attempt outcome/iu.test(bytes) &&
      /Только авторизованный человек[^\n]*(?:verdict|вердикт)/iu.test(bytes) &&
      /Production boundary|Production actions|production actions|производствен|production/iu.test(
        bytes,
      );
    checks.push(
      compatible
        ? pass(
            "constitution",
            "CONSTITUTION_2_0_AUTHORITY_ACCEPTED",
            `${manifest.constitution.path} ${manifest.constitution.sha256}`,
          )
        : fail(
            "constitution",
            "CONSTITUTION_2_0_AUTHORITY_INVALID",
            "Constitution must be Ratified 2.0.0 and reserve adjudicative authority for a HUMAN",
          ),
    );
  }

  if (specification.error)
    checks.push(
      fail("technical-result-authority", "GOVERNANCE_DOCUMENT_INVALID", specification.error),
    );
  else {
    const bytes = specification.bytes ?? "";
    const forbidden =
      /automatically signs?[^\n]*(?:QA\s+verdict|вердикт)|автоматически[^\n]*(?:подпис|становится)[^\n]*(?:verdict|вердикт)/iu.test(
        bytes,
      );
    const compatible =
      !forbidden &&
      /Technical PASS|technical result|техническ/iu.test(bytes) &&
      /REVIEW_REQUIRED/iu.test(bytes) &&
      /automatic QA\/release verdict|автоматическ[^\n]*(?:QA|release)[^\n]*(?:verdict|вердикт)|не подписывается/iu.test(
        bytes,
      );
    checks.push(
      compatible
        ? pass(
            "technical-result-authority",
            "TECHNICAL_RESULT_AUTHORITY_ACCEPTED",
            `${manifest.specification.path} ${manifest.specification.sha256}`,
          )
        : fail(
            "technical-result-authority",
            "TECHNICAL_RESULT_AUTHORITY_INVALID",
            "Technical result must stop at REVIEW_REQUIRED and cannot sign a human verdict",
          ),
    );
  }

  if (plan.error) checks.push(fail("pilot-contours", "GOVERNANCE_DOCUMENT_INVALID", plan.error));
  else {
    const bytes = plan.bytes ?? "";
    const standaloneRequiresMattermost = new RegExp(
      `${manifest.standaloneContour}[^.\\n]{0,80}(?:\\brequires\\b|требует|обязателен)[^.\\n]{0,40}Mattermost`,
      "iu",
    ).test(bytes);
    const exactReleaseContours =
      manifest.pilotReleaseContours.length === 2 &&
      manifest.pilotReleaseContours.every(
        (contour) =>
          contour.includes("gitlab-mattermost-") &&
          (contour.endsWith("development") || contour.endsWith("test")),
      );
    const compatible =
      !standaloneRequiresMattermost &&
      /Mattermost[^\n]*(?:optional|опционал)|(?:standalone|отдельн)[^\n]*(?:(?:does not require)[^\n]*Mattermost|Mattermost[^\n]*(?:optional|не зависит))/iu.test(
        bytes,
      ) &&
      /pilot release|pilot-release|пилот/iu.test(bytes) &&
      /production[^\n]*(?:DENIED|denied|deny|запрещ|impossible)|(?:DENIED|запрещ)[^\n]*production/iu.test(
        bytes,
      ) &&
      exactReleaseContours;
    let code = "PILOT_CONTOUR_AUTHORITY_INVALID";
    if (standaloneRequiresMattermost) code = "STANDALONE_MATTERMOST_DEPENDENCY_FORBIDDEN";
    checks.push(
      compatible
        ? pass(
            "pilot-contours",
            "PILOT_CONTOUR_AUTHORITY_ACCEPTED",
            `${manifest.standaloneContour}; ${manifest.pilotReleaseContours.join(", ")}`,
          )
        : fail(
            "pilot-contours",
            code,
            "Standalone conformance excludes Mattermost; pilot release requires combined DEVELOPMENT/TEST contours and keeps production denied",
          ),
    );
  }

  return Object.freeze({
    status: checks.every(({ status }) => status === "PASS") ? "PASS" : "FAIL",
    checks: Object.freeze(checks),
  });
}

function run(): void {
  const startedAt = new Date();
  const result = verifyFeature005GovernanceBinding(workspace);
  const report = {
    schemaVersion: 1,
    feature: "005-gitlab-automated-validation",
    gate: "feature-005-governance",
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    manifest: FEATURE_005_GOVERNANCE_MANIFEST,
    deploymentAuthority: Object.freeze({
      standalone: "LOCAL_CONFORMANCE_ONLY",
      pilotRelease: "SEPARATE_GATE_REQUIRED",
      production: "DENIED",
      technicalResultMaySignVerdict: false,
    }),
    ...result,
  };
  const target = safePath(workspace, outputPath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, stringifyPortableJson(report, workspace), "utf8");
  console.table(result.checks);
  console.log(`[governance:005] ${result.status}; production=DENIED; report: ${target}`);
  if (result.status !== "PASS") process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) run();
