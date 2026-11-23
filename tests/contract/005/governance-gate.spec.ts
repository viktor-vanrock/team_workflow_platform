import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  type Feature005GovernanceManifest,
  verifyFeature005GovernanceBinding,
} from "../../../tools/verification/feature-005-governance.mts";

function fixture(): string {
  return mkdtempSync(resolve(tmpdir(), "awp-005-governance-"));
}

function digest(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function write(root: string, path: string, value: string): void {
  const target = resolve(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, value, "utf8");
}

const constitution =
  "**Версия:** 2.0.0\n**Статус:** Ratified\nTechnical attempt outcome is distinct. Только авторизованный человек подписывает QA verdict. Production actions запрещены.\n";
const specification =
  "Technical PASS stops at REVIEW_REQUIRED. automatic QA/release verdict is out of scope. Manual flow remains available.\n";
const plan =
  "Standalone qa-jira-gitlab-local does not require Mattermost. Pilot release requires qa-jira-gitlab-mattermost-development or qa-jira-gitlab-mattermost-test. production: DENIED.\n";

function populate(
  root: string,
  values = { constitution, specification, plan },
): Feature005GovernanceManifest {
  const manifest: Feature005GovernanceManifest = {
    schemaVersion: 1,
    constitution: {
      path: ".specify/memory/constitution.md",
      sha256: digest(values.constitution),
      version: "2.0.0",
    },
    specification: { path: "specs/005/spec.md", sha256: digest(values.specification) },
    plan: { path: "specs/005/plan.md", sha256: digest(values.plan) },
    standaloneContour: "qa-jira-gitlab-local",
    pilotReleaseContours: [
      "qa-jira-gitlab-mattermost-development",
      "qa-jira-gitlab-mattermost-test",
    ],
  };
  write(root, manifest.constitution.path, values.constitution);
  write(root, manifest.specification.path, values.specification);
  write(root, manifest.plan.path, values.plan);
  return manifest;
}

describe("Feature 005 Constitution and deployment-purpose gate", () => {
  it("accepts Constitution 2.0 authority and the non-adjudicative automation contour", () => {
    const root = fixture();
    const result = verifyFeature005GovernanceBinding(root, populate(root));

    expect(result.status).toBe("PASS");
    expect(result.checks.map(({ code }) => code)).toEqual([
      "CONSTITUTION_2_0_AUTHORITY_ACCEPTED",
      "TECHNICAL_RESULT_AUTHORITY_ACCEPTED",
      "PILOT_CONTOUR_AUTHORITY_ACCEPTED",
    ]);
  });

  it("rejects any text that lets a technical result become a human verdict", () => {
    const root = fixture();
    const values = {
      constitution,
      specification: "Technical PASS automatically signs QA verdict.",
      plan,
    };
    const result = verifyFeature005GovernanceBinding(root, populate(root, values));

    expect(result.status).toBe("FAIL");
    expect(result.checks[1]).toMatchObject({
      status: "FAIL",
      code: "TECHNICAL_RESULT_AUTHORITY_INVALID",
    });
  });

  it("rejects standalone GitLab conformance that requires Mattermost", () => {
    const root = fixture();
    const values = {
      constitution,
      specification,
      plan: "qa-jira-gitlab-local requires Mattermost. production: DENIED.",
    };
    const result = verifyFeature005GovernanceBinding(root, populate(root, values));

    expect(result.status).toBe("FAIL");
    expect(result.checks[2]).toMatchObject({
      status: "FAIL",
      code: "STANDALONE_MATTERMOST_DEPENDENCY_FORBIDDEN",
    });
  });

  it("rejects a pilot release contour without Mattermost or production denial", () => {
    const root = fixture();
    const requirement = populate(root);
    requirement.pilotReleaseContours = ["qa-jira-gitlab-development"];

    const result = verifyFeature005GovernanceBinding(root, requirement);

    expect(result.status).toBe("FAIL");
    expect(result.checks[2]).toMatchObject({
      status: "FAIL",
      code: "PILOT_CONTOUR_AUTHORITY_INVALID",
    });
  });
});
