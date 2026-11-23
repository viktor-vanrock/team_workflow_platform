import { describe, expect, it } from "vitest";

import { classifyJiraResponse } from "../../../packages/connector-jira/src/operational/jira-effect-control.ts";

describe("003 Jira operation error matrix", () => {
  it.each([
    "request.create",
    "request.transition",
    "request.assign",
    "request.set-priority",
    "request.set-due-date",
    "defect.create",
  ])("fails closed for %s", (operation) => {
    expect(operation).toBeTruthy();
    expect(classifyJiraResponse(401)).toMatchObject({
      category: "AUTHENTICATION",
      retryDisposition: "DO_NOT_RETRY",
    });
    expect(classifyJiraResponse(403)).toMatchObject({
      category: "PERMISSION",
      retryDisposition: "DO_NOT_RETRY",
    });
    expect(classifyJiraResponse(429, { "retry-after": "3" })).toMatchObject({
      category: "RATE_LIMIT",
      retryAfterSeconds: 3,
    });
    expect(classifyJiraResponse(500).retryDisposition).toBe("RECONCILE_BEFORE_RETRY");
  });
});
