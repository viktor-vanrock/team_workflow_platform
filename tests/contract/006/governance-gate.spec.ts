import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  type Feature006GovernanceManifest,
  verifyFeature006GovernanceBinding,
} from "../../../tools/verification/feature-006-governance.mts";

const constitution = `**Версия:** 2.0.0
Jira является первым и каноническим источником operational state.
Доступ вычисляется как пересечение Workspace membership ∩ Project Entitlement ∩ Role permission ∩ Data Classification; default — deny.
Результат модели всегда schema-validated и рассматривается как proposal.
Первый релиз не выполняет production actions.
`;
const specification = `Jira priority остаётся accepted operational value. Hermes не назначает business priority.
project lanes и portfolio view используют один authorization filter, применённый до aggregation.
SLA clock стартует после read/webhook confirmation фактического Jira READY.
autonomous capacity allocation is out of scope.
`;
const plan = `qa-jira-gitlab-mattermost-local is the only accepted contour.
external network access is denied before credential resolution or adapter invocation.
Latest confirmed operational projection remains the source for Jira-owned fields.
Missing inputs produce MEASURE_ONLY or SKIPPED_GATED; production: DENIED.
`;

function fixture(): string {
  return mkdtempSync(resolve(tmpdir(), "awp-006-governance-"));
}

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function write(root: string, path: string, value: string): void {
  const target = resolve(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, value, "utf8");
}

function populate(
  root: string,
  values = { constitution, specification, plan },
): Feature006GovernanceManifest {
  const manifest: Feature006GovernanceManifest = {
    schemaVersion: 1,
    constitution: {
      path: ".specify/memory/constitution.md",
      sha256: digest(values.constitution),
      version: "2.0.0",
    },
    specification: { path: "specs/006/spec.md", sha256: digest(values.specification) },
    plan: { path: "specs/006/plan.md", sha256: digest(values.plan) },
    acceptedContour: "qa-jira-gitlab-mattermost-local",
    production: "DENIED",
  };
  write(root, manifest.constitution.path, values.constitution);
  write(root, manifest.specification.path, values.specification);
  write(root, manifest.plan.path, values.plan);
  return manifest;
}

describe("Feature 006 Constitution, authority, and deployment boundary", () => {
  it("accepts Constitution 2.0, Jira authority, entitlement-first reads, proposal-only models, and local-only execution", () => {
    const root = fixture();
    const result = verifyFeature006GovernanceBinding(root, populate(root));

    expect(result.status).toBe("PASS");
    expect(result.checks.map(({ code }) => code)).toEqual([
      "CONSTITUTION_2_0_ACCEPTED",
      "JIRA_OPERATIONAL_AUTHORITY_ACCEPTED",
      "ENTITLEMENT_BEFORE_AGGREGATION_ACCEPTED",
      "MODEL_AUTHORITY_BOUNDARY_ACCEPTED",
      "LOCAL_PRODUCTION_BOUNDARY_ACCEPTED",
    ]);
  });

  it("rejects a non-2.0 Constitution or byte drift", () => {
    const root = fixture();
    const manifest = populate(root);
    manifest.constitution = { ...manifest.constitution, version: "1.1.1" };

    const result = verifyFeature006GovernanceBinding(root, manifest);

    expect(result.checks[0]).toMatchObject({ status: "FAIL", code: "CONSTITUTION_2_0_INVALID" });
  });

  it("rejects local queue state as a second Jira authority", () => {
    const root = fixture();
    const values = {
      constitution,
      specification: specification.replace(
        "Jira priority остаётся accepted operational value.",
        "Queue priority replaces Jira priority.",
      ),
      plan,
    };

    const result = verifyFeature006GovernanceBinding(root, populate(root, values));

    expect(result.checks[1]).toMatchObject({
      status: "FAIL",
      code: "JIRA_OPERATIONAL_AUTHORITY_INVALID",
    });
  });

  it("rejects aggregation before authorization", () => {
    const root = fixture();
    const values = {
      constitution,
      specification: specification.replace(
        "authorization filter, применённый до aggregation",
        "authorization filter, применённый после aggregation",
      ),
      plan,
    };

    const result = verifyFeature006GovernanceBinding(root, populate(root, values));

    expect(result.checks[2]).toMatchObject({
      status: "FAIL",
      code: "ENTITLEMENT_BEFORE_AGGREGATION_INVALID",
    });
  });

  it("rejects autonomous model priority or capacity authority", () => {
    const root = fixture();
    const values = {
      constitution,
      specification: `${specification}\nHermes automatically assigns business priority and capacity.`,
      plan,
    };

    const result = verifyFeature006GovernanceBinding(root, populate(root, values));

    expect(result.checks[3]).toMatchObject({
      status: "FAIL",
      code: "MODEL_AUTHORITY_BOUNDARY_INVALID",
    });
  });

  it("rejects a live or production-capable contour", () => {
    const root = fixture();
    const manifest = populate(root, {
      constitution,
      specification,
      plan: "qa-jira-gitlab-mattermost-production; external network access allowed; production: ALLOWED.",
    });
    manifest.acceptedContour = "qa-jira-gitlab-mattermost-production";
    manifest.production = "ALLOWED";

    const result = verifyFeature006GovernanceBinding(root, manifest);

    expect(result.checks[4]).toMatchObject({
      status: "FAIL",
      code: "LOCAL_PRODUCTION_BOUNDARY_INVALID",
    });
  });
});
