import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  INPUT_REQUIREMENTS_008,
  canonicalInputHash008,
  pilotContentHash,
} from "../../../packages/platform-core/src/index.ts";
import { RuntimeConfigurationRepository } from "../../../packages/platform-persistence-typeorm/src/index.ts";
import { PublishedPilotReportPolicy } from "../../../packages/runtime-composition/src/pilot/published-report-policy.ts";

afterEach(() => vi.restoreAllMocks());
const scope = { workspaceId: "workspace", projectId: "project" };
const hash = `sha256:${"a".repeat(64)}` as const;
const ref = { id: "input", version: 1, contentHash: hash };
function inputPackage(verificationPolicyRef: string) {
  const list = new Set([
    "projectRefs",
    "channelRefs",
    "secretRefs",
    "origins",
    "callbackRoutes",
    "humanRefs",
    "sourceRefs",
  ]);
  const entries = Object.entries(INPUT_REQUIREMENTS_008).map(([id, fields]) => {
    const metadata: Record<string, unknown> = Object.fromEntries(
      fields.map((field) => [field, list.has(field) ? ["ref"] : "ref"]),
    );
    if (id === "IN-02")
      metadata.providers = ["JIRA", "GITLAB", "MATTERMOST"].map((type) => ({
        type,
        edition: "approved",
        version: "1",
        apiDialect: "v1",
        authStrategy: "approved",
        documentRef: "doc",
        permissionsRef: "rights",
      }));
    if (id === "IN-03") metadata.issuer = "https://issuer.example";
    if (id === "IN-07") {
      metadata.artifactMode = "GITLAB_ONLY";
      metadata.verificationPolicyRef = verificationPolicyRef;
    }
    if (id === "IN-08") metadata.backupMethod = "LOGICAL";
    const body = {
      id,
      version: 1,
      workspaceId: scope.workspaceId,
      projectIds: [scope.projectId],
      synthetic: false,
      status: "ACCEPTED",
      suppliedBy: "owner",
      reviewedBy: "reviewer",
      reviewedAt: "2026-01-01T00:00:00.000Z",
      evidenceRef: "review",
      metadata,
    };
    return { ...body, contentHash: canonicalInputHash008(body) };
  });
  return {
    schemaVersion: 1,
    id: "input",
    version: 1,
    profile: "integration",
    scope: { workspaceId: scope.workspaceId, projectIds: [scope.projectId] },
    entries,
  };
}

describe("published report verification policy", () => {
  it("requires the reviewed IN-07 hash and detects policy replacement", async () => {
    const directory = mkdtempSync(join(tmpdir(), "awp-report-policy-"));
    try {
      const file = join(directory, "policy.json");
      const body = {
        ...scope,
        subjectRef: ref,
        fingerprints: {},
        deploymentProfiles: ["integration"],
        executionGates: {},
        maximumAgeMs: 1000,
        keys: [],
      };
      const approved = pilotContentHash(body);
      const policy = { ...body, policyRef: { id: "policy", version: 1, contentHash: approved } };
      writeFileSync(file, JSON.stringify({ schemaVersion: 1, policies: [policy] }));
      vi.spyOn(RuntimeConfigurationRepository.prototype, "current").mockResolvedValue({
        document: inputPackage(approved),
      } as never);
      const source = {
        isInitialized: true,
        transaction: async (_level: string, work: (manager: object) => Promise<unknown>) =>
          await work({}),
      };
      const reader = new PublishedPilotReportPolicy(source as never, ref, file);
      expect(await reader.current(scope)).toEqual(policy);
      writeFileSync(
        file,
        JSON.stringify({ schemaVersion: 1, policies: [{ ...policy, maximumAgeMs: 2000 }] }),
      );
      await expect(reader.current(scope)).rejects.toThrow("PILOT_REPORT_POLICY_UNAVAILABLE");
      writeFileSync(file, JSON.stringify({ schemaVersion: 1, policies: [policy] }));
      vi.spyOn(RuntimeConfigurationRepository.prototype, "current").mockRejectedValue(
        new Error("REVOKED"),
      );
      await expect(reader.current(scope)).rejects.toThrow("PILOT_REPORT_POLICY_UNAVAILABLE");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
