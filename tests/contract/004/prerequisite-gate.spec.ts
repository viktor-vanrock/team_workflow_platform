import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  type Feature004PrerequisiteManifest,
  verifyFeature004PrerequisiteBinding,
} from "../../../tools/verification/feature-004-prerequisites.mts";

function fixture(): string {
  return mkdtempSync(resolve(tmpdir(), "awp-004-prerequisites-"));
}

function encoded(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function digest(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function write(root: string, path: string, value: string): void {
  const target = resolve(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, value, "utf8");
}

const finalReport = Object.freeze({
  schemaVersion: 1,
  feature: "003-jira-operational-authority",
  gate: "feature-003-final",
  status: "PASS",
  stages: [{ id: "smoke-e2e", status: "PASS" }],
  handoff: {
    status: "BOUND",
    generatedAfterAllProcessGates: true,
    verificationCommand: "pnpm verify:003:evidence",
  },
});

function manifest(
  reportBytes: string,
  contracts: Readonly<Record<string, string>>,
): Feature004PrerequisiteManifest {
  return {
    schemaVersion: 1,
    feature003Report: {
      path: "reports/003/final-gate.json",
      sha256: digest(reportBytes),
      feature: "003-jira-operational-authority",
      gate: "feature-003-final",
    },
    consumedContracts: Object.entries(contracts).map(([path, bytes], index) => ({
      id: `contract-${index + 1}`,
      path,
      sha256: digest(bytes),
    })),
  };
}

describe("Feature 004 exact Feature 003 handoff prerequisite", () => {
  it("accepts only the exact PASS/BOUND final report and exact consumed contract bytes", () => {
    const root = fixture();
    const reportBytes = encoded(finalReport);
    const contracts = {
      "contracts/core.json": encoded({ id: "core", version: "1.0.0" }),
      "contracts/qa.json": encoded({ id: "qa", version: "1.1.0" }),
      "contracts/jira.json": encoded({ id: "jira", version: "1.0.0" }),
    };
    const requirement = manifest(reportBytes, contracts);
    write(root, requirement.feature003Report.path, reportBytes);
    for (const [path, bytes] of Object.entries(contracts)) write(root, path, bytes);

    const result = verifyFeature004PrerequisiteBinding(root, requirement);

    expect(result.status).toBe("PASS");
    expect(result.report).toMatchObject({ status: "PASS", code: "FEATURE_003_REPORT_ACCEPTED" });
    expect(
      result.consumedContracts.every(
        ({ status, code }) => status === "PASS" && code === "CONSUMED_CONTRACT_ACCEPTED",
      ),
    ).toBe(true);
  });

  it("rejects a report whose exact digest changed even if it still claims PASS", () => {
    const root = fixture();
    const reportBytes = encoded(finalReport);
    const requirement = manifest(reportBytes, {});
    write(
      root,
      requirement.feature003Report.path,
      encoded({ ...finalReport, finishedAt: "later" }),
    );

    const result = verifyFeature004PrerequisiteBinding(root, requirement);

    expect(result.status).toBe("FAIL");
    expect(result.report).toMatchObject({
      status: "FAIL",
      code: "FEATURE_003_REPORT_DIGEST_MISMATCH",
    });
  });

  it("rejects identity, status, process-gate and handoff-attestation mismatches", () => {
    const root = fixture();
    const incompatible = encoded({
      ...finalReport,
      feature: "other-feature",
      status: "FAIL",
      stages: [{ id: "smoke-e2e", status: "FAIL" }],
      handoff: { status: "UNBOUND" },
    });
    const requirement = {
      ...manifest(incompatible, {}),
      feature003Report: {
        ...manifest(incompatible, {}).feature003Report,
        feature: "003-jira-operational-authority",
      },
    };
    write(root, requirement.feature003Report.path, incompatible);

    const result = verifyFeature004PrerequisiteBinding(root, requirement);

    expect(result.status).toBe("FAIL");
    expect(result.report.code).toBe("FEATURE_003_REPORT_INCOMPATIBLE");
    expect(result.report.detail).toMatch(/feature|status|process|handoff/iu);
  });

  it("reports every missing or drifted consumed contract", () => {
    const root = fixture();
    const reportBytes = encoded(finalReport);
    const contracts = {
      "contracts/core.json": encoded({ id: "core" }),
      "contracts/qa.json": encoded({ id: "qa" }),
    };
    const requirement = manifest(reportBytes, contracts);
    write(root, requirement.feature003Report.path, reportBytes);
    write(root, "contracts/core.json", encoded({ id: "core", drift: true }));

    const result = verifyFeature004PrerequisiteBinding(root, requirement);

    expect(result.status).toBe("FAIL");
    expect(result.consumedContracts.map(({ code }) => code)).toEqual([
      "CONSUMED_CONTRACT_DIGEST_MISMATCH",
      "CONSUMED_CONTRACT_MISSING",
    ]);
  });
});
