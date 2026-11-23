import { describe, expect, it } from "vitest";

import { routeImportCandidate } from "../../../packages/connector-jira/src/import/import-router.ts";

describe("US2 exact import scope", () => {
  it("rejects adjacent project before loading issue content", async () => {
    let reads = 0;
    const result = await routeImportCandidate(
      { projectId: "200", issueTypeId: "10001", discriminator: "alpha", externalEntityId: "1" },
      { projectId: "100", issueTypeId: "10001", discriminator: "alpha", profileStatus: "VALID" },
      async () => {
        reads++;
        return { summary: "must not leak" };
      },
    );
    expect(result).toEqual({
      state: "IGNORED_OUT_OF_SCOPE",
      reasonCode: "PROJECT_MISMATCH",
      externalEntityId: "1",
    });
    expect(reads).toBe(0);
  });
});
