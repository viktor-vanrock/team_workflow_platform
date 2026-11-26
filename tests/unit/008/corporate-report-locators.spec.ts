import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createCorporateReportLocators } from "../../../apps/api/src/extensions/corporate-report-locators.ts";
import { pilotContentHash } from "../../../packages/platform-core/src/index.ts";

describe("corporate GitLab report locators", () => {
  it("limits locator lookup to the deployment and the exact report ref", async () => {
    const directory = mkdtempSync(join(tmpdir(), "awp-report-locators-"));
    try {
      const path = join(directory, "locators.json");
      const deployment = { workspaceId: "workspace", projectIds: ["project"] };
      const ref = { id: "report", version: 1, contentHash: `sha256:${"a".repeat(64)}` as const };
      const locator = {
        workspaceId: "workspace",
        projectId: "project",
        reportRef: ref,
        numericProjectId: 123,
        jobId: 456,
        path: "reports/008-pilot-hardening-and-conformance/report.json",
        signature: { executorId: "executor", keyRef: ref, subjectRef: ref, value: "signature" },
      };
      writeFileSync(
        path,
        JSON.stringify({
          schemaVersion: 1,
          deploymentPolicyHash: pilotContentHash(deployment),
          reports: [locator],
        }),
      );
      const source = { isInitialized: true, query: vi.fn() };
      const authority = createCorporateReportLocators({
        source: source as never,
        environment: { profile: "non-local", environmentScope: "NON_PROD", deployment } as never,
        connectors: {} as never,
        factories: {} as never,
        path,
      });
      expect(
        await authority.report({ workspaceId: "workspace", projectId: "project" }, ref),
      ).toEqual(locator);
      await expect(
        authority.report({ workspaceId: "workspace", projectId: "other" }, ref),
      ).rejects.toThrow("PILOT_REPORT_ARTIFACT_UNAVAILABLE");
      writeFileSync(
        path,
        JSON.stringify({ schemaVersion: 1, deploymentPolicyHash: "bad", reports: [locator] }),
      );
      await expect(
        authority.report({ workspaceId: "workspace", projectId: "project" }, ref),
      ).rejects.toThrow("CORPORATE_REPORT_LOCATORS_INVALID");
      expect(source.query).not.toHaveBeenCalled();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
