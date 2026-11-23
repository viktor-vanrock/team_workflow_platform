import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  type Feature005PrerequisiteManifest,
  verifyFeature005PrerequisiteBinding,
} from "../../../tools/verification/feature-005-prerequisites.mts";

function fixture(): string {
  return mkdtempSync(resolve(tmpdir(), "awp-005-prerequisites-"));
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

const finishedAt = "2026-09-01T08:00:00.000Z";
const finalReport = Object.freeze({
  schemaVersion: 2,
  feature: "003-jira-operational-authority",
  gate: "feature-003-final",
  status: "PASS",
  finishedAt,
  stages: [{ id: "smoke-e2e", status: "PASS" }],
  handoff: {
    status: "BOUND",
    generatedAfterAllProcessGates: true,
    verificationCommand: "pnpm verify:003:evidence",
  },
});

const manualSchema = encoded({
  $id: "urn:awp:schemas:qa:test-session:v1",
  type: "object",
  properties: { mode: { const: "MANUAL" } },
});
const automatedNegative = encoded({ schemaVersion: 1, mode: "AUTOMATED" });

function manifest(reportBytes: string, contractBytes: string): Feature005PrerequisiteManifest {
  return {
    schemaVersion: 1,
    maximumReportAgeMs: 86_400_000,
    feature003Report: {
      path: "reports/003/final-gate.json",
      sha256: digest(reportBytes),
      schemaVersion: 2,
      feature: "003-jira-operational-authority",
      gate: "feature-003-final",
    },
    consumedContracts: [
      { id: "core-command", path: "contracts/core-command.ts", sha256: digest(contractBytes) },
    ],
    feature002ManualContracts: [
      {
        id: "manual-test-session",
        path: "contracts/test-session.v1.schema.json",
        sha256: digest(manualSchema),
      },
    ],
    feature002AutomatedNegativeFixture: {
      path: "contracts/automated-session.invalid.json",
      sha256: digest(automatedNegative),
    },
    feature004Evidence: {
      path: "reports/004/final-gate.json",
      requiredForStandalone: false,
    },
  };
}

function populate(root: string): Feature005PrerequisiteManifest {
  const reportBytes = encoded(finalReport);
  const contractBytes = "export const command = 'immutable';\n";
  const requirement = manifest(reportBytes, contractBytes);
  write(root, requirement.feature003Report.path, reportBytes);
  write(root, requirement.consumedContracts[0]!.path, contractBytes);
  write(root, requirement.feature002ManualContracts[0]!.path, manualSchema);
  write(root, requirement.feature002AutomatedNegativeFixture.path, automatedNegative);
  return requirement;
}

describe("Feature 005 fail-closed prerequisite gate", () => {
  it("accepts exact fresh Feature 003 evidence and byte-pinned upstream/manual contracts", () => {
    const root = fixture();
    const result = verifyFeature005PrerequisiteBinding(
      root,
      populate(root),
      Date.parse(finishedAt) + 60_000,
    );

    expect(result.status).toBe("PASS");
    expect(result.feature003Report.code).toBe("FEATURE_003_REPORT_ACCEPTED");
    expect(result.feature002ManualContracts[0]).toMatchObject({
      status: "PASS",
      code: "FEATURE_002_MANUAL_CONTRACT_ACCEPTED",
    });
    expect(result.feature002AutomatedNegativeFixture).toMatchObject({
      status: "PASS",
      code: "FEATURE_002_AUTOMATED_NEGATIVE_ACCEPTED",
    });
  });

  it("fails closed for a missing report or consumed contract", () => {
    const root = fixture();
    const requirement = populate(root);
    requirement.feature003Report = {
      ...requirement.feature003Report,
      path: "reports/003/missing.json",
    };
    requirement.consumedContracts = [
      { ...requirement.consumedContracts[0]!, path: "contracts/missing.ts" },
    ];

    const result = verifyFeature005PrerequisiteBinding(
      root,
      requirement,
      Date.parse(finishedAt) + 60_000,
    );

    expect(result.status).toBe("FAIL");
    expect(result.feature003Report.code).toBe("FEATURE_003_REPORT_MISSING");
    expect(result.consumedContracts[0]?.code).toBe("CONSUMED_CONTRACT_MISSING");
  });

  it("rejects stale Feature 003 evidence", () => {
    const root = fixture();
    const result = verifyFeature005PrerequisiteBinding(
      root,
      populate(root),
      Date.parse(finishedAt) + 86_400_001,
    );

    expect(result.status).toBe("FAIL");
    expect(result.feature003Report.code).toBe("FEATURE_003_REPORT_STALE");
  });

  it("rejects report and contract hash drift", () => {
    const root = fixture();
    const requirement = populate(root);
    write(
      root,
      requirement.feature003Report.path,
      encoded({ ...finalReport, finishedAt: "2026-09-01T08:00:01.000Z" }),
    );
    write(root, requirement.feature002ManualContracts[0]!.path, `${manualSchema} `);

    const result = verifyFeature005PrerequisiteBinding(
      root,
      requirement,
      Date.parse(finishedAt) + 60_000,
    );

    expect(result.status).toBe("FAIL");
    expect(result.feature003Report.code).toBe("FEATURE_003_REPORT_DIGEST_MISMATCH");
    expect(result.feature002ManualContracts[0]?.code).toBe(
      "FEATURE_002_MANUAL_CONTRACT_DIGEST_MISMATCH",
    );
  });

  it("rejects a Feature 002 manual contract that admits AUTOMATED mode", () => {
    const root = fixture();
    const requirement = populate(root);
    const widened = encoded({
      $id: "urn:awp:schemas:qa:test-session:v1",
      properties: { mode: { enum: ["MANUAL", "AUTOMATED"] } },
    });
    write(root, requirement.feature002ManualContracts[0]!.path, widened);
    requirement.feature002ManualContracts = [
      { ...requirement.feature002ManualContracts[0]!, sha256: digest(widened) },
    ];

    const result = verifyFeature005PrerequisiteBinding(
      root,
      requirement,
      Date.parse(finishedAt) + 60_000,
    );

    expect(result.status).toBe("FAIL");
    expect(result.feature002ManualContracts[0]?.code).toBe("FEATURE_002_MANUAL_CONTRACT_WIDENED");
  });

  it("records Feature 004 as explicitly not required for standalone conformance", () => {
    const root = fixture();
    const result = verifyFeature005PrerequisiteBinding(
      root,
      populate(root),
      Date.parse(finishedAt) + 60_000,
    );

    expect(result.status).toBe("PASS");
    expect(result.feature004Evidence).toMatchObject({
      status: "PASS",
      code: "FEATURE_004_NOT_REQUIRED_STANDALONE",
      detail: "reports/004/final-gate.json is reserved for the separate pilot-release gate",
    });
  });
});
