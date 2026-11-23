import { describe, expect, it } from "vitest";

import { classifyJiraResponse } from "../../../packages/connector-jira/src/operational/jira-effect-control.ts";

describe("US3 command failures", () => {
  it("stops auth failures, budgets 429 and reconciles uncertainty", () => {
    expect(classifyJiraResponse(401).retryDisposition).toBe("DO_NOT_RETRY");
    expect(classifyJiraResponse(429, { "retry-after": "9" })).toMatchObject({
      retryDisposition: "RETRY_AFTER",
      retryAfterSeconds: 9,
    });
    expect(classifyJiraResponse(503).retryDisposition).toBe("RECONCILE_BEFORE_RETRY");
  });
});
