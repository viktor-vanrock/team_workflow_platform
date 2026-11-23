import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { stringifyPortableJson } from "./portable-json.mts";

type Status = "PASS" | "FAIL";

interface DigestRequirement {
  readonly path: string;
  readonly sha256: string;
}

export interface Feature007GovernanceManifest {
  readonly schemaVersion: 1;
  readonly constitution: DigestRequirement & { readonly version: string };
  readonly specification: DigestRequirement;
  readonly plan: DigestRequirement;
  readonly acceptedContour: string;
  readonly production: string;
  readonly corporateRuntimeOwner: string;
}

export interface Feature007GovernanceCheck {
  readonly id: string;
  readonly status: Status;
  readonly code: string;
  readonly detail: string;
}

export interface Feature007GovernanceBinding {
  readonly status: Status;
  readonly checks: readonly Feature007GovernanceCheck[];
  readonly gatedInputs: readonly {
    readonly id: string;
    readonly status: "BLOCKED_INPUT" | "SKIPPED_GATED";
    readonly owner: "FEATURE_008";
  }[];
}

const workspace = resolve(import.meta.dirname, "../..");
const outputPath = "reports/007-project-onboarding-evidence-security/governance.json";

export const FEATURE_007_GOVERNANCE_MANIFEST: Feature007GovernanceManifest = Object.freeze({
  schemaVersion: 1,
  constitution: {
    path: ".specify/memory/constitution.md",
    sha256: "sha256:d448f4586b3d798e9fd27a44471d9ad5ad1a6852db4b5255b6ee1d8c7ea7630f",
    version: "2.0.0",
  },
  specification: {
    path: "specs/007-project-onboarding-evidence-security/spec.md",
    sha256: "sha256:12231f328fddada9e7e5e41d45a70d2473eebbff0048eef145882968129a062f",
  },
  plan: {
    path: "specs/007-project-onboarding-evidence-security/plan.md",
    sha256: "sha256:b9f4124ca2282a039800d442e4b835ec62de9c42b03e751fa5efd4c2468bd329",
  },
  acceptedContour: "qa-jira-gitlab-mattermost-local",
  production: "DENIED",
  corporateRuntimeOwner: "FEATURE_008",
});

function pass(id: string, code: string, detail: string): Feature007GovernanceCheck {
  return Object.freeze({ id, status: "PASS", code, detail });
}

function fail(id: string, code: string, detail: string): Feature007GovernanceCheck {
  return Object.freeze({ id, status: "FAIL", code, detail });
}

function digest(value: string | Buffer): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function safeRead(
  root: string,
  requirement: DigestRequirement,
): { readonly text?: string; readonly error?: string } {
  const target = resolve(root, requirement.path);
  if (target !== root && !target.startsWith(`${root}/`))
    return { error: `path escapes workspace: ${requirement.path}` };
  if (!existsSync(target)) return { error: `missing: ${requirement.path}` };
  const text = readFileSync(target, "utf8");
  const actual = digest(text);
  return actual === requirement.sha256
    ? { text }
    : { error: `digest=${actual}; expected=${requirement.sha256}` };
}

function includesAll(text: string, tokens: readonly string[]): boolean {
  return tokens.every((token) => text.toLocaleLowerCase().includes(token.toLocaleLowerCase()));
}

export function verifyFeature007GovernanceBinding(
  root: string,
  manifest: Feature007GovernanceManifest,
): Feature007GovernanceBinding {
  const constitutionRead = safeRead(root, manifest.constitution);
  const specificationRead = safeRead(root, manifest.specification);
  const planRead = safeRead(root, manifest.plan);
  const constitution = constitutionRead.text ?? "";
  const specification = specificationRead.text ?? "";
  const plan = planRead.text ?? "";
  const combined = `${constitution}\n${specification}\n${plan}`;

  const constitutionValid =
    !constitutionRead.error &&
    manifest.constitution.version === "2.0.0" &&
    constitution.includes("**Версия:** 2.0.0") &&
    constitution.includes("Jira является первым и каноническим источником") &&
    constitution.includes(
      "Workspace membership ∩ Project Entitlement ∩ Role permission ∩ Data Classification",
    ) &&
    /QA Verdict/iu.test(constitution) &&
    constitution.includes("не выполняет production actions");

  const invalidOwnership =
    /core owns qa environment semantics|connectors mutate project lifecycle|hermes approves administrative actions/iu.test(
      plan,
    );
  const ownershipValid =
    !planRead.error &&
    includesAll(plan, ["Platform Core", "QA Competency Pack", "Connectors", "Hermes"]) &&
    /Platform Core[^\n]*(?:Stable Project registry|Project identity|registry\/security\/configuration)/iu.test(
      plan,
    ) &&
    /QA Competency Pack[^\n]*(?:environments|test resources|test-data)/iu.test(plan) &&
    /Connectors[^\n]*(?:provider protocol|Capability probes)/iu.test(plan) &&
    /Hermes[^\n]*(?:cannot|Project selection|Optional explanation)/iu.test(plan) &&
    !invalidOwnership;

  const jiraValid =
    !constitutionRead.error &&
    !specificationRead.error &&
    !planRead.error &&
    /Jira[^\n]*(?:первым и каноническим источником|operational authority)/iu.test(combined) &&
    !/replaces Jira operational authority|заменяет[^\n]*Jira/iu.test(combined);

  const scopeBeforeAggregationValid =
    !planRead.error &&
    /(?:Authorization filters|authorization[^\n]*filter)[^\n]*before[^\n]*(?:lookup|aggregation)/iu.test(
      plan,
    ) &&
    !/after aggregation|после aggregation/iu.test(plan);

  const exactApprovalHumanEvidenceValid =
    !constitutionRead.error &&
    !specificationRead.error &&
    !planRead.error &&
    /exact one-time[^\n]*approval/iu.test(specification) &&
    /(?:отличного от инициатора|different from the initiator)/iu.test(specification) &&
    /(?:QA Verdict[^\n]*(?:человек|HUMAN|human)|(?:человек|HUMAN|human)[^\n]*QA Verdict)/iu.test(
      combined,
    ) &&
    /Hermes[^\n]*(?:cannot|не)[^\n]*(?:initiate|инициировать)/iu.test(combined) &&
    !/self-approve|Hermes consumes|Model creates QA Verdict/iu.test(combined);

  const secretBoundaryValid =
    !specificationRead.error &&
    !planRead.error &&
    /Credentials[^\n]*(?:не входят|не хранятся)|no secret values/iu.test(combined) &&
    !/Credentials are stored|tokens are stored|парол[ьи][^\n]*хранят/iu.test(combined);

  const localBoundaryValid =
    !planRead.error &&
    manifest.acceptedContour === "qa-jira-gitlab-mattermost-local" &&
    manifest.production === "DENIED" &&
    manifest.corporateRuntimeOwner === "FEATURE_008" &&
    plan.includes("qa-jira-gitlab-mattermost-local") &&
    plan.includes("BLOCKED_INPUT") &&
    plan.includes("SKIPPED_GATED") &&
    /Feature 008/iu.test(plan) &&
    /production[^\n]*(?:denied|запрещ|reject|no Feature 007)/iu.test(combined) &&
    !/production contour|external egress allowed|corporate values use local defaults/iu.test(
      combined,
    );

  const checks = Object.freeze([
    constitutionValid
      ? pass("constitution", "CONSTITUTION_2_0_ACCEPTED", manifest.constitution.path)
      : fail(
          "constitution",
          "CONSTITUTION_2_0_INVALID",
          constitutionRead.error ?? manifest.constitution.path,
        ),
    ownershipValid
      ? pass(
          "ownership",
          "OWNERSHIP_BOUNDARIES_ACCEPTED",
          "Core/QA/Connector/Hermes authority is separated",
        )
      : fail(
          "ownership",
          "OWNERSHIP_BOUNDARIES_INVALID",
          planRead.error ?? "ownership invariant missing or contradictory",
        ),
    jiraValid
      ? pass(
          "jira-authority",
          "JIRA_OPERATIONAL_AUTHORITY_ACCEPTED",
          "Jira remains the external operational authority",
        )
      : fail(
          "jira-authority",
          "JIRA_OPERATIONAL_AUTHORITY_INVALID",
          specificationRead.error ?? planRead.error ?? "Jira authority invariant missing",
        ),
    scopeBeforeAggregationValid
      ? pass(
          "project-scope",
          "PROJECT_SCOPE_BEFORE_AGGREGATION_ACCEPTED",
          "authorization precedes lookup and aggregation",
        )
      : fail(
          "project-scope",
          "PROJECT_SCOPE_BEFORE_AGGREGATION_INVALID",
          planRead.error ?? "pre-aggregation Project scope invariant missing",
        ),
    exactApprovalHumanEvidenceValid
      ? pass(
          "approval-evidence",
          "EXACT_APPROVAL_HUMAN_EVIDENCE_ACCEPTED",
          "separation of duties and human verdict are mandatory",
        )
      : fail(
          "approval-evidence",
          "EXACT_APPROVAL_HUMAN_EVIDENCE_INVALID",
          specificationRead.error ?? "approval or human evidence invariant missing",
        ),
    secretBoundaryValid
      ? pass(
          "secret-storage",
          "SECRET_STORAGE_BOUNDARY_ACCEPTED",
          "business state stores opaque refs only",
        )
      : fail(
          "secret-storage",
          "SECRET_STORAGE_BOUNDARY_INVALID",
          specificationRead.error ?? planRead.error ?? "secret boundary missing",
        ),
    localBoundaryValid
      ? pass(
          "local-production",
          "LOCAL_INPUT_PRODUCTION_BOUNDARY_ACCEPTED",
          `${manifest.acceptedContour}; corporate=${manifest.corporateRuntimeOwner}`,
        )
      : fail(
          "local-production",
          "LOCAL_INPUT_PRODUCTION_BOUNDARY_INVALID",
          planRead.error ??
            `${manifest.acceptedContour}/${manifest.production}/${manifest.corporateRuntimeOwner}`,
        ),
  ]);

  const gatedInputs = Object.freeze([
    Object.freeze({
      id: "corporate-identifiers-and-mappings",
      status: "BLOCKED_INPUT" as const,
      owner: "FEATURE_008" as const,
    }),
    Object.freeze({
      id: "corporate-connectivity-and-credentials",
      status: "SKIPPED_GATED" as const,
      owner: "FEATURE_008" as const,
    }),
  ]);
  return Object.freeze({
    status: checks.every(({ status }) => status === "PASS") ? "PASS" : "FAIL",
    checks,
    gatedInputs,
  });
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
  const binding = verifyFeature007GovernanceBinding(workspace, FEATURE_007_GOVERNANCE_MANIFEST);
  writeAtomic(
    outputPath,
    Object.freeze({
      schemaVersion: 1,
      feature: "007-project-onboarding-evidence-security",
      gate: "governance",
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      contour: FEATURE_007_GOVERNANCE_MANIFEST.acceptedContour,
      production: FEATURE_007_GOVERNANCE_MANIFEST.production,
      ...binding,
    }),
  );
  console.log(
    `[governance:007] ${binding.status}; checks=${binding.checks.map(({ id, status }) => `${id}:${status}`).join(",")}`,
  );
  for (const check of binding.checks)
    if (check.status === "FAIL") console.error(`- ${check.id}: ${check.code}: ${check.detail}`);
  if (binding.status !== "PASS") process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) run();
