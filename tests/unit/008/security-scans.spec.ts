import { describe, expect, it } from "vitest";

import {
  evaluateSecurityScan008,
  type SecurityScanExpectation008,
  type SecurityScanReport008,
} from "../../../tools/verification/008-security-scans.mts";

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const now = Date.parse("2026-09-05T00:00:00Z");
const expected: SecurityScanExpectation008 = {
  kind: "IMAGE",
  contour: "DEVELOPMENT_MOCKS",
  artifactDigest: digest("a"),
  requiredCoverage: "ADAPTER_FIXTURE",
  scanner: { id: "scanner", version: "1.0.0" },
  database: {
    id: "db",
    version: "2026.09.04",
    digest: digest("b"),
    publishedAt: "2026-09-04T00:00:00Z",
  },
  policy: {
    id: "policy",
    version: "1.0.0",
    digest: digest("c"),
    reportMaximumAgeMs: 172_800_000,
    databaseMaximumAgeMs: 172_800_000,
    acceptedRiskSeverities: ["MODERATE", "LOW"],
    acceptedFindings: [
      {
        id: "ADV-1",
        severity: "MODERATE",
        owner: "security-owner",
        expiresAt: "2026-09-06T00:00:00Z",
      },
    ],
  },
  now,
};
const report = (): SecurityScanReport008 => ({
  schemaVersion: "security-scan@1.0.0",
  kind: "IMAGE",
  contour: "DEVELOPMENT_MOCKS",
  coverage: "ADAPTER_FIXTURE",
  artifact: { kind: "OCI_IMAGE", digest: digest("a") },
  scanner: { id: "scanner", version: "1.0.0" },
  database: {
    id: "db",
    version: "2026.09.04",
    digest: digest("b"),
    publishedAt: "2026-09-04T00:00:00Z",
  },
  policy: { id: "policy", version: "1.0.0", digest: digest("c") },
  scannedAt: "2026-09-05T00:00:00Z",
  findings: [],
});

describe("008 strict dependency/image scan adapter", () => {
  it("passes exact adapter evidence without claiming release eligibility", () =>
    expect(evaluateSecurityScan008(report(), expected)).toMatchObject({
      status: "PASS",
      releaseEligible: false,
      measurements: { critical: 0, open: 0 },
    }));
  it.each([null, undefined])("blocks a missing scan", (value) =>
    expect(evaluateSecurityScan008(value, expected)).toMatchObject({
      status: "BLOCKED_INPUT",
      reasonCodes: ["SCAN_MISSING"],
    }),
  );
  it("blocks unknown fields", () =>
    expect(evaluateSecurityScan008({ ...report(), secret: "value" }, expected)).toMatchObject({
      status: "BLOCKED_INPUT",
      reasonCodes: ["SCAN_SCHEMA_INVALID"],
    }));
  it.each([
    [
      "artifact",
      { ...report(), artifact: { kind: "OCI_IMAGE", digest: digest("d") } },
      "SCAN_ARTIFACT_MISMATCH",
    ],
    [
      "scanner",
      { ...report(), scanner: { id: "other", version: "1.0.0" } },
      "SCAN_SCANNER_MISMATCH",
    ],
    [
      "database",
      { ...report(), database: { ...report().database, digest: digest("d") } },
      "SCAN_DATABASE_MISMATCH",
    ],
    [
      "policy",
      { ...report(), policy: { ...report().policy, digest: digest("d") } },
      "SCAN_POLICY_MISMATCH",
    ],
    ["coverage", { ...report(), coverage: "FULL" as const }, "SCAN_COVERAGE_INSUFFICIENT"],
  ] as const)("blocks %s pin drift", (_name, value, reason) =>
    expect(evaluateSecurityScan008(value, expected)).toMatchObject({
      status: "BLOCKED_INPUT",
      reasonCodes: expect.arrayContaining([reason]),
    }),
  );
  it("blocks stale reports and databases", () =>
    expect(
      evaluateSecurityScan008(
        {
          ...report(),
          scannedAt: "2026-09-01T00:00:00Z",
          database: { ...report().database, publishedAt: "2026-09-01T00:00:00Z" },
        },
        { ...expected, database: { ...expected.database, publishedAt: "2026-09-01T00:00:00Z" } },
      ),
    ).toMatchObject({
      status: "BLOCKED_INPUT",
      reasonCodes: expect.arrayContaining(["SCAN_REPORT_STALE", "SCAN_DATABASE_STALE"]),
    }));
  it.each(["CRITICAL", "HIGH"] as const)("fails an unclosed %s finding", (severity) =>
    expect(
      evaluateSecurityScan008(
        {
          ...report(),
          findings: [
            { id: "ADV", component: "package", installedVersion: "1", severity, status: "OPEN" },
          ],
        },
        expected,
      ),
    ).toMatchObject({
      status: "FAIL",
      reasonCodes: expect.arrayContaining([`${severity}_FINDING_NOT_CLOSED`]),
    }),
  );
  it("accepts only an exact owned, unexpired noncritical exception", () =>
    expect(
      evaluateSecurityScan008(
        {
          ...report(),
          findings: [
            {
              id: "ADV-1",
              component: "package",
              installedVersion: "1",
              severity: "MODERATE",
              status: "ACCEPTED_RISK",
              owner: "security-owner",
              expiresAt: "2026-09-06T00:00:00Z",
            },
          ],
        },
        expected,
      ),
    ).toMatchObject({ status: "PASS", measurements: { moderate: 1, open: 0 } }));
  it("fails expired or unowned risk acceptance", () =>
    expect(
      evaluateSecurityScan008(
        {
          ...report(),
          findings: [
            {
              id: "ADV-1",
              component: "package",
              installedVersion: "1",
              severity: "MODERATE",
              status: "ACCEPTED_RISK",
              owner: "other",
              expiresAt: "2026-09-04T00:00:00Z",
            },
          ],
        },
        expected,
      ),
    ).toMatchObject({ status: "FAIL", reasonCodes: ["FINDING_ACCEPTANCE_INVALID"] }));
  it("marks only a full corporate scan release eligible", () =>
    expect(
      evaluateSecurityScan008(
        { ...report(), contour: "CORPORATE", coverage: "FULL" },
        { ...expected, contour: "CORPORATE", requiredCoverage: "FULL" },
      ),
    ).toMatchObject({ status: "PASS", releaseEligible: true }));
});
