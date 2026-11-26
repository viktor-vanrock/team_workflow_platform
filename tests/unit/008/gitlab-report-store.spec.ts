import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { GitLabPilotReportStore } from "../../../packages/runtime-composition/src/pilot/gitlab-report-store.ts";

const scope = { workspaceId: "workspace", projectId: "project" };
const bytes = Buffer.from("report contents");
const hash = `sha256:${createHash("sha256").update(bytes).digest("hex")}` as const;
const ref = { id: "report", version: 1, contentHash: hash };
const path = "reports/008-pilot-hardening-and-conformance/gate.json";
const locator = {
  ...scope,
  reportRef: ref,
  numericProjectId: 123,
  jobId: 456,
  path,
  signature: { executorId: "executor", keyRef: ref, subjectRef: ref, value: "signature" },
};

describe("GitLab pilot report store", () => {
  it("reads the scoped artifact and checks the exact digest", async () => {
    const request = vi.fn(async () => new Response(bytes));
    const authority = {
      report: vi.fn(async () => locator),
      prerequisite: vi.fn(),
      client: vi.fn(async () => ({ request })),
    };
    const store = new GitLabPilotReportStore(authority as never);
    const result = await store.report(scope, ref, new AbortController().signal);
    expect(result.bytes).toEqual(new Uint8Array(bytes));
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: `/api/v4/projects/123/jobs/456/artifacts/${path}`,
        authOperation: "artifactStream",
      }),
    );
    await expect(
      store.report(
        scope,
        { ...ref, contentHash: `sha256:${"a".repeat(64)}` },
        new AbortController().signal,
      ),
    ).rejects.toThrow("PILOT_REPORT_ARTIFACT_UNAVAILABLE");
  });
  it("rejects path traversal and cross-project locators before calling the client", async () => {
    const authority = {
      report: vi.fn(async () => ({ ...locator, projectId: "other" })),
      prerequisite: vi.fn(),
      client: vi.fn(),
    };
    const store = new GitLabPilotReportStore(authority as never);
    await expect(store.report(scope, ref, new AbortController().signal)).rejects.toThrow(
      "PILOT_REPORT_ARTIFACT_UNAVAILABLE",
    );
    expect(authority.client).not.toHaveBeenCalled();
    authority.report.mockResolvedValue({
      ...locator,
      projectId: "other",
      path: "reports/008-pilot-hardening-and-conformance/../escape",
    });
    await expect(
      store.report({ ...scope, projectId: "other" }, ref, new AbortController().signal),
    ).rejects.toThrow("PILOT_REPORT_ARTIFACT_UNAVAILABLE");
    expect(authority.client).not.toHaveBeenCalled();
  });
  it("rejects changed locator authority and incorrect artifact bytes", async () => {
    const report = vi
      .fn()
      .mockResolvedValueOnce(locator)
      .mockResolvedValueOnce({ ...locator, jobId: 999 });
    const request = vi.fn(async () => new Response(bytes));
    const store = new GitLabPilotReportStore({
      report,
      prerequisite: vi.fn(),
      client: async () => ({ request }),
    } as never);
    await expect(store.report(scope, ref, new AbortController().signal)).rejects.toThrow(
      "PILOT_REPORT_ARTIFACT_UNAVAILABLE",
    );
    const other = new GitLabPilotReportStore({
      report: async () => locator,
      prerequisite: vi.fn(),
      client: async () => ({ request: async () => new Response("different bytes") }),
    } as never);
    await expect(other.report(scope, ref, new AbortController().signal)).rejects.toThrow(
      "PILOT_REPORT_ARTIFACT_UNAVAILABLE",
    );
  });
  it("rejects oversized streaming artifacts", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(2_000_001));
        controller.close();
      },
    });
    const store = new GitLabPilotReportStore({
      report: async () => locator,
      prerequisite: vi.fn(),
      client: async () => ({ request: async () => new Response(stream) }),
    } as never);
    await expect(store.report(scope, ref, new AbortController().signal)).rejects.toThrow(
      "PILOT_REPORT_ARTIFACT_UNAVAILABLE",
    );
  });
});
