import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";

import {
  assertReviewedLockAddition008,
  type DependencyReview008,
  verifyReviewedSdkDependencies008,
} from "../../../tools/verification/feature-008-dependencies.mts";
import { hashBytes, ROOT_008 } from "../../../tools/verification/feature-008-prerequisites.mts";

const baseline = JSON.parse(readFileSync("config/pilot/feature-007-baseline.json", "utf8")) as {
  commit: string;
};
const before = execFileSync("git", ["show", `${baseline.commit}:pnpm-lock.yaml`]);
const current = readFileSync("pnpm-lock.yaml");
const review = JSON.parse(
  readFileSync("config/pilot/otel-dependency-review.json", "utf8"),
) as DependencyReview008;
describe("008 reviewed additive SDK dependencies", () => {
  it("rejects changing an unrelated package through a forged remediation", () => {
    const remediation = JSON.parse(
      readFileSync("config/pilot/local-audit-dependency-review.json", "utf8"),
    ) as DependencyReview008;
    expect(() =>
      assertReviewedLockAddition008(before, current, {
        ...remediation,
        remediations: [
          ...remediation.remediations!,
          { path: ["packages", "@opentelemetry/api@1.9.1"], after: {} },
        ],
      }),
    ).toThrow("DEPENDENCY_REMEDIATION_INVALID");
  });
  it("requires the exact reviewed replacement values", () => {
    const remediation = JSON.parse(
      readFileSync("config/pilot/local-audit-dependency-review.json", "utf8"),
    ) as DependencyReview008;
    expect(() =>
      assertReviewedLockAddition008(before, current, {
        ...remediation,
        remediations: remediation.remediations!.map((value, index) =>
          index === 0 ? { ...value, after: "6.15.3" } : value,
        ),
      }),
    ).toThrow("DEPENDENCY_REMEDIATION_INVALID");
  });
  it("retains every 007 dependency and verifies the pinned review and audit", () => {
    expect(() => verifyReviewedSdkDependencies008(ROOT_008, before, current)).not.toThrow();
  });
  it("rejects changing an internal workspace link despite a matching lock hash", () => {
    const remediation = JSON.parse(
      readFileSync("config/pilot/local-audit-dependency-review.json", "utf8"),
    ) as DependencyReview008;
    const document = parse(current.toString());
    document.importers["apps/api"].dependencies["@awp/competency-tech-writing"].version =
      "link:../../packages/competency-qa";
    const altered = Buffer.from(stringify(document));
    expect(() =>
      assertReviewedLockAddition008(before, altered, {
        ...remediation,
        lockHash: hashBytes(altered),
      }),
    ).toThrow("DEPENDENCY_WORKSPACE_REVIEW_INVALID");
  });
  it("rejects forged workspace importer additions", () => {
    const remediation = JSON.parse(
      readFileSync("config/pilot/local-audit-dependency-review.json", "utf8"),
    ) as DependencyReview008;
    expect(() =>
      assertReviewedLockAddition008(before, current, {
        ...remediation,
        workspaceImporterAdditions: {
          ...remediation.workspaceImporterAdditions,
          "unreviewed/importer": { dependencies: {} },
        },
      }),
    ).toThrow("DEPENDENCY_WORKSPACE_REVIEW_INVALID");
  });
  it("rejects changed bytes without a matching review", () => {
    expect(() =>
      assertReviewedLockAddition008(before, Buffer.concat([current, Buffer.from("\n")]), review),
    ).toThrow();
  });
  it("rejects old dependency changes even if an edited review matches the new hash", () => {
    const document = parse(current.toString()) as { packages: Record<string, unknown> };
    document.packages["@opentelemetry/api@1.9.1"] = { resolution: { integrity: "altered" } };
    const altered = Buffer.from(stringify(document));
    expect(() =>
      assertReviewedLockAddition008(before, altered, { ...review, lockHash: hashBytes(altered) }),
    ).toThrow("DEPENDENCY_BASELINE_CHANGED");
  });
  it("rejects undeclared additions and attempts to remove historical entries", () => {
    const document = parse(current.toString()) as { packages: Record<string, unknown> };
    document.packages["unreviewed@1.0.0"] = {};
    let altered = Buffer.from(stringify(document));
    expect(() =>
      assertReviewedLockAddition008(before, altered, { ...review, lockHash: hashBytes(altered) }),
    ).toThrow();
    delete document.packages["@opentelemetry/api@1.9.1"];
    altered = Buffer.from(stringify(document));
    expect(() =>
      assertReviewedLockAddition008(before, altered, {
        ...review,
        lockHash: hashBytes(altered),
        addedPackages: [...review.addedPackages, "@opentelemetry/api@1.9.1"],
      }),
    ).toThrow();
  });
});
