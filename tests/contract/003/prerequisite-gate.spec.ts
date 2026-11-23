import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  type PrerequisiteReportRequirement,
  verifyPrerequisiteReports,
} from "../../../tools/verification/feature-003-prerequisites.mts";

const feature001 = Object.freeze({
  schemaVersion: 1,
  feature: "001-extension-kernel-local-skeleton",
  gate: "feature-001-final",
  status: "PASS",
  stages: [{ id: "architecture", status: "PASS" }],
});

const feature002 = Object.freeze({
  schemaVersion: 1,
  feature: "002-qa-manual-walking-skeleton",
  gate: "feature-002-final",
  status: "PASS",
  stages: [{ id: "regression", status: "PASS" }],
});

function encoded(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function fixture(): string {
  return mkdtempSync(resolve(tmpdir(), "awp-003-prerequisites-"));
}

function requirement(
  id: string,
  path: string,
  value: Readonly<Record<string, unknown>>,
): PrerequisiteReportRequirement {
  const text = encoded(value);
  return {
    id,
    path,
    sha256: digest(text),
    feature: String(value.feature),
    ...(value.gate ? { gate: String(value.gate) } : {}),
  };
}

function write(root: string, path: string, value: unknown): void {
  const target = resolve(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, encoded(value), "utf8");
}

describe("Feature 003 fail-closed prerequisite report gate", () => {
  it("reports every missing prerequisite instead of stopping on the first one", () => {
    const root = fixture();
    const requirements = [
      requirement("001", "artifacts/001.json", feature001),
      requirement("002", "artifacts/002.json", feature002),
    ];

    const result = verifyPrerequisiteReports(root, requirements);

    expect(result.status).toBe("FAIL");
    expect(result.checks.filter(({ status }) => status === "FAIL")).toHaveLength(2);
    expect(result.checks.map(({ code }) => code)).toEqual(["REPORT_MISSING", "REPORT_MISSING"]);
  });

  it("rejects a stale report whose bytes no longer match the frozen digest", () => {
    const root = fixture();
    const expected = requirement("001", "artifacts/001.json", feature001);
    write(root, expected.path, { ...feature001, finishedAt: "later" });

    const result = verifyPrerequisiteReports(root, [expected]);

    expect(result.status).toBe("FAIL");
    expect(result.checks[0]).toMatchObject({ code: "REPORT_DIGEST_MISMATCH", status: "FAIL" });
  });

  it("rejects incompatible identities and non-PASS evidence even when the digest matches", () => {
    const root = fixture();
    const incompatible = { ...feature002, feature: "some-other-feature", status: "FAIL" };
    const expected = {
      ...requirement("002", "artifacts/002.json", incompatible),
      feature: feature002.feature,
    };
    write(root, expected.path, incompatible);

    const result = verifyPrerequisiteReports(root, [expected]);

    expect(result.status).toBe("FAIL");
    expect(result.checks[0]?.code).toBe("REPORT_INCOMPATIBLE");
    expect(result.checks[0]?.detail).toContain("feature");
    expect(result.checks[0]?.detail).toContain("status");
  });

  it("accepts exact compatible passing evidence", () => {
    const root = fixture();
    const requirements = [
      requirement("001", "artifacts/001.json", feature001),
      requirement("002", "artifacts/002.json", feature002),
    ];
    write(root, requirements[0]!.path, feature001);
    write(root, requirements[1]!.path, feature002);

    const result = verifyPrerequisiteReports(root, requirements);

    expect(result.status).toBe("PASS");
    expect(result.checks).toHaveLength(2);
    expect(
      result.checks.every(({ code, status }) => code === "REPORT_ACCEPTED" && status === "PASS"),
    ).toBe(true);
  });
});
