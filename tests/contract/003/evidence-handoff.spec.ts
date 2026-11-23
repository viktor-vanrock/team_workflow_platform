import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  captureFeature003HandoffSnapshot,
  sha256File,
  verifyFeature003HandoffReport,
} from "../../../tools/verification/feature-003-evidence-lib.mts";

const temporaryWorkspaces: string[] = [];

function fixtureWorkspace(): string {
  const workspace = mkdtempSync(join(tmpdir(), "feature-003-evidence-"));
  temporaryWorkspaces.push(workspace);
  mkdirSync(resolve(workspace, "apps/api/src"), { recursive: true });
  mkdirSync(resolve(workspace, "reports/003-jira-operational-authority"), { recursive: true });
  mkdirSync(resolve(workspace, "specs/003-jira-operational-authority"), { recursive: true });
  writeFileSync(resolve(workspace, "apps/api/src/runtime.ts"), "export const runtime = 1;\n");
  writeFileSync(
    resolve(workspace, "specs/003-jira-operational-authority/tasks.md"),
    "- [x] T161 Aggregate gate\n- [x] T162 Handoff evidence\n- [ ] T163 Release prose\n",
  );
  writeFileSync(
    resolve(workspace, "reports/003-jira-operational-authority/foundation.json"),
    `${JSON.stringify({ feature: "003-jira-operational-authority", gate: "foundation", status: "PASS" })}\n`,
  );
  return workspace;
}

function validReport(workspace: string): Readonly<Record<string, unknown>> {
  const snapshot = captureFeature003HandoffSnapshot(workspace);
  return {
    schemaVersion: 2,
    feature: "003-jira-operational-authority",
    gate: "feature-003-final",
    status: "PASS",
    stages: [{ id: "foundation", status: "PASS" }],
    evidence: [
      {
        name: "foundation.json",
        stageId: "foundation",
        status: "PASS",
        sha256: sha256File(
          resolve(workspace, "reports/003-jira-operational-authority/foundation.json"),
        ),
      },
    ],
    handoff: {
      status: "BOUND",
      generatedAfterAllProcessGates: true,
      verificationCommand: "pnpm verify:003:evidence",
      ...snapshot,
    },
  };
}

afterEach(() => {
  for (const workspace of temporaryWorkspaces.splice(0)) {
    rmSync(workspace, { recursive: true, force: true });
  }
});

describe("Feature 003 handoff evidence", () => {
  it("binds the final PASS to the exact task state and runtime tree", () => {
    const workspace = fixtureWorkspace();
    const report = validReport(workspace);

    expect(
      verifyFeature003HandoffReport({
        workspace,
        report,
        requiredEvidenceNames: ["foundation.json"],
      }),
    ).toMatchObject({ status: "PASS", failures: [] });

    writeFileSync(resolve(workspace, "apps/api/src/runtime.ts"), "export const runtime = 2;\n");
    expect(
      verifyFeature003HandoffReport({
        workspace,
        report,
        requiredEvidenceNames: ["foundation.json"],
      }).failures,
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "RUNTIME_SNAPSHOT_MISMATCH" })]),
    );
  });

  it("fails closed when task state or a referenced report drifts", () => {
    const workspace = fixtureWorkspace();
    const report = validReport(workspace);

    writeFileSync(
      resolve(workspace, "specs/003-jira-operational-authority/tasks.md"),
      "- [x] T161 Aggregate gate\n- [x] T162 Handoff evidence\n- [x] T163 Release prose\n",
    );
    expect(
      verifyFeature003HandoffReport({
        workspace,
        report,
        requiredEvidenceNames: ["foundation.json"],
      }).failures,
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "TASK_SNAPSHOT_MISMATCH" })]),
    );

    const rebound = validReport(workspace);
    writeFileSync(
      resolve(workspace, "reports/003-jira-operational-authority/foundation.json"),
      `${JSON.stringify({ feature: "003-jira-operational-authority", gate: "foundation", status: "FAIL" })}\n`,
    );
    expect(
      verifyFeature003HandoffReport({
        workspace,
        report: rebound,
        requiredEvidenceNames: ["foundation.json"],
      }).failures,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "EVIDENCE_DIGEST_MISMATCH" }),
        expect.objectContaining({ code: "EVIDENCE_STATUS_MISMATCH" }),
      ]),
    );
  });
});
