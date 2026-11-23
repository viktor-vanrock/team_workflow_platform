import { describe, expect, it } from "vitest";

import { createRuntimeApprovalsV11Api } from "../../../packages/runtime-composition/src/queue/approval-api.ts";
import { RuntimeQueuePoliciesApi } from "../../../packages/runtime-composition/src/queue/policy-api.ts";
import {
  RuntimePortfolioQueueApi,
  RuntimeQueueApi,
} from "../../../packages/runtime-composition/src/queue/query-api.ts";

describe("008 queue HTTP authority", () => {
  it("requires the composed project/portfolio/workspace authority before repository queries", async () => {
    let queries = 0;
    const calls: string[] = [];
    const source = {
      query: async () => {
        queries++;
        return [];
      },
    } as never;
    const authority = {
      project: async () => {
        calls.push("project");
        throw new Error("QA_SCOPE_DENIED");
      },
      workspace: async () => {
        calls.push("workspace");
        throw new Error("QA_SCOPE_DENIED");
      },
      portfolio: async () => {
        calls.push("portfolio");
        throw new Error("QA_SCOPE_DENIED");
      },
    };
    const response = { setHeader() {} };
    const request = { localPersonaKey: "lead.alpha" };
    await expect(
      new RuntimeQueueApi(source, authority).capacity(request, "w", "p", response),
    ).rejects.toThrow("QA_SCOPE_DENIED");
    await expect(
      new RuntimePortfolioQueueApi(source, authority).capacity(request, "w", response),
    ).rejects.toThrow("QA_SCOPE_DENIED");
    await expect(
      new RuntimeQueuePoliciesApi(source, authority).policy(request, "w", response),
    ).rejects.toThrow("QA_SCOPE_DENIED");
    expect(calls).toEqual(["project", "portfolio", "workspace"]);
    expect(queries).toBe(0);
  });
  it("authorizes approval decisions before loading the approval subject", async () => {
    let queries = 0;
    const source = {
      query: async () => {
        queries++;
        return [];
      },
    } as never;
    const authority = {
      project: async () => {
        throw new Error("QA_SCOPE_DENIED");
      },
      workspace: async () => {
        throw new Error("QA_SCOPE_DENIED");
      },
      portfolio: async () => {
        throw new Error("QA_SCOPE_DENIED");
      },
    };
    const api = createRuntimeApprovalsV11Api(source, authority);
    expect(
      await api.decide({
        workspaceId: "w",
        projectId: "p",
        approvalId: "a",
        request: {},
        decision: "APPROVE",
      }),
    ).toBeUndefined();
    expect(queries).toBe(0);
  });
});
