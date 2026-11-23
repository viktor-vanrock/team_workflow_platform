import { describe, expect, it } from "vitest";

import {
  classifyJiraResponse,
  lookupJiraEffect,
} from "../../../packages/connector-jira/src/index.ts";

describe("closed Jira effect lookup and retry", () => {
  it.each([
    [[], true, "PROVEN_ABSENT"],
    [["10001"], true, "FOUND"],
    [["1", "2"], true, "MULTIPLE"],
    [[], false, "UNKNOWN"],
  ] as const)("classifies marker results", (matches, visibilityProven, state) => {
    expect(lookupJiraEffect(matches, visibilityProven).state).toBe(state);
  });

  it.each([
    [401, "AUTHENTICATION"],
    [403, "PERMISSION"],
    [429, "RATE_LIMIT"],
    [500, "TRANSIENT"],
  ] as const)("normalizes %s", (status, category) => {
    expect(classifyJiraResponse(status, { "retry-after": "2" }).category).toBe(category);
  });
});
