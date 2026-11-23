import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { stringifyPortableJson } from "./portable-json.mts";

type Status = "PASS" | "FAIL";

interface DigestRequirement {
  path: string;
  sha256: string;
}

export interface Feature006GovernanceManifest {
  schemaVersion: 1;
  constitution: DigestRequirement & { version: string };
  specification: DigestRequirement;
  plan: DigestRequirement;
  acceptedContour: string;
  production: string;
}

export interface Feature006GovernanceCheck {
  readonly id: string;
  readonly status: Status;
  readonly code: string;
  readonly detail: string;
}

export interface Feature006GovernanceBinding {
  readonly status: Status;
  readonly checks: readonly Feature006GovernanceCheck[];
}

const workspace = resolve(import.meta.dirname, "../..");
const outputPath = "reports/006-queue-triage-capacity-sla/governance.json";

export const FEATURE_006_GOVERNANCE_MANIFEST: Feature006GovernanceManifest = {
  schemaVersion: 1,
  constitution: {
    path: ".specify/memory/constitution.md",
    sha256: "sha256:d448f4586b3d798e9fd27a44471d9ad5ad1a6852db4b5255b6ee1d8c7ea7630f",
    version: "2.0.0",
  },
  specification: {
    path: "specs/006-queue-triage-capacity-sla/spec.md",
    sha256: "sha256:4424e97b5a915832007b88e2d8b77756ffd98f0f055c87847aaf2f3d98c4e478",
  },
  plan: {
    path: "specs/006-queue-triage-capacity-sla/plan.md",
    sha256: "sha256:da8e9d4a9a9ff52ff005836fe5adebd9670ff70d6ac2722c346df7b0a76795eb",
  },
  acceptedContour: "qa-jira-gitlab-mattermost-local",
  production: "DENIED",
};

function pass(id: string, code: string, detail: string): Feature006GovernanceCheck {
  return Object.freeze({ id, status: "PASS", code, detail });
}

function fail(id: string, code: string, detail: string): Feature006GovernanceCheck {
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

export function verifyFeature006GovernanceBinding(
  root: string,
  manifest: Feature006GovernanceManifest,
): Feature006GovernanceBinding {
  const constitutionRead = safeRead(root, manifest.constitution);
  const specificationRead = safeRead(root, manifest.specification);
  const planRead = safeRead(root, manifest.plan);
  const constitution = constitutionRead.text ?? "";
  const specification = specificationRead.text ?? "";
  const plan = planRead.text ?? "";

  const constitutionValid =
    !constitutionRead.error &&
    manifest.constitution.version === "2.0.0" &&
    constitution.includes("**Версия:** 2.0.0") &&
    constitution.includes("Jira является первым и каноническим источником") &&
    constitution.includes(
      "Workspace membership ∩ Project Entitlement ∩ Role permission ∩ Data Classification",
    ) &&
    constitution.includes("рассматривается как proposal") &&
    constitution.includes("не выполняет production actions");

  const jiraValid =
    !specificationRead.error &&
    !planRead.error &&
    specification.includes("Jira priority остаётся accepted operational value") &&
    specification.includes("SLA clock стартует после read/webhook confirmation") &&
    plan.includes("Latest confirmed operational projection") &&
    !/queue priority replaces jira priority/iu.test(specification);

  const entitlementValid =
    !specificationRead.error &&
    specification.includes("authorization filter, применённый до aggregation") &&
    !specification.includes("authorization filter, применённый после aggregation");

  const modelValid =
    !constitutionRead.error &&
    !specificationRead.error &&
    constitution.includes(
      "Результат модели всегда schema-validated и рассматривается как proposal",
    ) &&
    specification.includes("Hermes не назначает business priority") &&
    specification.includes("autonomous capacity allocation") &&
    !/hermes automatically assigns|model automatically (?:authorizes|assigns)|autonomous capacity allocation is enabled/iu.test(
      specification,
    );

  const boundaryValid =
    !planRead.error &&
    manifest.acceptedContour === "qa-jira-gitlab-mattermost-local" &&
    manifest.production === "DENIED" &&
    plan.includes("qa-jira-gitlab-mattermost-local") &&
    plan.includes("external network access") &&
    /production[^\n]*(?:denied|no deployment|no .*production)/iu.test(plan) &&
    !/production:\s*allowed|external network access allowed/iu.test(plan);

  const checks = Object.freeze([
    constitutionValid
      ? pass("constitution", "CONSTITUTION_2_0_ACCEPTED", manifest.constitution.path)
      : fail(
          "constitution",
          "CONSTITUTION_2_0_INVALID",
          constitutionRead.error ?? manifest.constitution.path,
        ),
    jiraValid
      ? pass(
          "jira-authority",
          "JIRA_OPERATIONAL_AUTHORITY_ACCEPTED",
          "confirmed Feature 003 projection remains canonical",
        )
      : fail(
          "jira-authority",
          "JIRA_OPERATIONAL_AUTHORITY_INVALID",
          specificationRead.error ?? planRead.error ?? "Jira authority invariant missing",
        ),
    entitlementValid
      ? pass(
          "entitlement",
          "ENTITLEMENT_BEFORE_AGGREGATION_ACCEPTED",
          "authorization precedes aggregation",
        )
      : fail(
          "entitlement",
          "ENTITLEMENT_BEFORE_AGGREGATION_INVALID",
          specificationRead.error ?? "pre-aggregation filter invariant missing",
        ),
    modelValid
      ? pass(
          "model-authority",
          "MODEL_AUTHORITY_BOUNDARY_ACCEPTED",
          "recommendation-only model and no autonomous capacity",
        )
      : fail(
          "model-authority",
          "MODEL_AUTHORITY_BOUNDARY_INVALID",
          constitutionRead.error ?? specificationRead.error ?? "model authority invariant missing",
        ),
    boundaryValid
      ? pass("deployment-boundary", "LOCAL_PRODUCTION_BOUNDARY_ACCEPTED", manifest.acceptedContour)
      : fail(
          "deployment-boundary",
          "LOCAL_PRODUCTION_BOUNDARY_INVALID",
          planRead.error ?? `${manifest.acceptedContour}/${manifest.production}`,
        ),
  ]);
  return Object.freeze({
    status: checks.every(({ status }) => status === "PASS") ? "PASS" : "FAIL",
    checks,
  });
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
  const binding = verifyFeature006GovernanceBinding(workspace, FEATURE_006_GOVERNANCE_MANIFEST);
  writeAtomic(
    outputPath,
    Object.freeze({
      schemaVersion: 1,
      feature: "006-queue-triage-capacity-sla",
      gate: "governance",
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      ...binding,
    }),
  );
  console.log(
    `[governance:006] ${binding.status}; checks=${binding.checks.map(({ id, status }) => `${id}:${status}`).join(",")}`,
  );
  for (const check of binding.checks)
    if (check.status === "FAIL") console.error(`- ${check.id}: ${check.code}: ${check.detail}`);
  if (binding.status !== "PASS") process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) run();
