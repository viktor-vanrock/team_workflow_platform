import { describe, expect, it, vi } from "vitest";
import { sha256 } from "../../../packages/platform-contracts/src/index.ts";
import {
  createCorporateGitLabResultProvider,
  corporateGitLabResultJobExpiry,
} from "../../../packages/runtime-composition/src/gitlab/corporate-result-provider.ts";

describe("corporate GitLab result provider", () => {
  it("accepts expiration only for one exact result job", () => {
    const job = { id: 20, name: "awp:result", artifacts_expire_at: "2026-12-01T00:00:00Z" };
    expect(corporateGitLabResultJobExpiry([job], "20", "awp:result")).toBe(
      "2026-12-01T00:00:00.000Z",
    );
    expect(() => corporateGitLabResultJobExpiry([job, job], "20", "awp:result")).toThrow(
      "CORPORATE_GITLAB_RESULT_EXPIRY_UNVERIFIED",
    );
    expect(() =>
      corporateGitLabResultJobExpiry([{ ...job, artifacts_expire_at: null }], "20", "awp:result"),
    ).toThrow("CORPORATE_GITLAB_RESULT_EXPIRY_UNVERIFIED");
    expect(() => corporateGitLabResultJobExpiry([job], "20", "other")).toThrow(
      "CORPORATE_GITLAB_RESULT_EXPIRY_UNVERIFIED",
    );
  });
  it("rejects a missing execution pin before loading provider configuration", async () => {
    const query = vi.fn();
    await expect(
      createCorporateGitLabResultProvider({
        source: { query },
        grants: [],
        factories: {},
        authority: {},
        terminal: {
          candidate: { attemptId: "a", commandId: "c", workspaceId: "w", projectId: "p" },
        },
        attempt: {
          automationAttemptId: "a",
          connectorCommandId: "c",
          workspaceId: "w",
          projectId: "p",
        },
        snapshot: { configurationPins: [] },
        signal: new AbortController().signal,
      } as never),
    ).rejects.toThrow("CORPORATE_GITLAB_RESULT_PIN_INVALID");
    expect(query).not.toHaveBeenCalled();
  });

  it("does not use a grant belonging to another integration binding", async () => {
    const query = vi.fn();
    const ref = { id: "profile", version: 1, contentHash: "sha256:profile" };
    const connection = { id: "connection", version: 1, contentHash: "sha256:connection" };
    const binding = { id: "binding", version: 1, contentHash: "sha256:binding" };
    const snapshotBody = {
      workspaceId: "w",
      projectId: "p",
      testSessionId: "session",
      configurationPins: [
        {
          logicalRole: "TEST_EXECUTION",
          profileRef: ref,
          connectionRef: connection,
          projectIntegrationBindingRef: binding,
        },
      ],
    };
    const snapshotHash = sha256(snapshotBody);
    await expect(
      createCorporateGitLabResultProvider({
        source: { query },
        grants: [
          {
            binding: { ref: { id: "grant" }, servicePrincipalId: "service" },
            integrationBindingRef: { ...binding, id: "other" },
          },
        ],
        factories: {},
        authority: {},
        terminal: {
          candidate: { attemptId: "a", commandId: "c", workspaceId: "w", projectId: "p" },
          binding: { ref: { id: "grant" }, profileRef: ref, connectionRef: connection },
        },
        attempt: {
          automationAttemptId: "a",
          connectorCommandId: "c",
          workspaceId: "w",
          projectId: "p",
          executingServiceId: "service",
          testSessionId: "session",
          currentStatus: "RUNNING",
          targetSnapshotHash: snapshotHash,
        },
        snapshot: {
          snapshotHash,
          ...snapshotBody,
        },
        signal: new AbortController().signal,
      } as never),
    ).rejects.toThrow("CORPORATE_GITLAB_RESULT_ACCESS_DENIED");
    expect(query).not.toHaveBeenCalled();
  });
});
