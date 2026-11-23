import { describe, expect, it } from "vitest";

import { assertDefectRouting } from "../../../../packages/connector-jira/src/operational/defect-create.ts";

describe("US4 defect routing", () => {
  it("rejects unapproved, wrong destination/profile and forbidden evidence before provider calls", () => {
    expect(() =>
      assertDefectRouting({
        approved: false,
        profileStatus: "VALID",
        expectedProjectId: "200",
        targetProjectId: "200",
        classificationAllowed: true,
        expectedAuthorityNamespace: "n",
        actualAuthorityNamespace: "n",
      }),
    ).toThrow("DEFECT_APPROVAL_REQUIRED");
    expect(() =>
      assertDefectRouting({
        approved: true,
        profileStatus: "VALID",
        expectedProjectId: "200",
        targetProjectId: "100",
        classificationAllowed: true,
        expectedAuthorityNamespace: "n",
        actualAuthorityNamespace: "n",
      }),
    ).toThrow("DEFECT_DESTINATION_MISMATCH");
    expect(() =>
      assertDefectRouting({
        approved: true,
        profileStatus: "VALID",
        expectedProjectId: "200",
        targetProjectId: "200",
        classificationAllowed: false,
        expectedAuthorityNamespace: "n",
        actualAuthorityNamespace: "n",
      }),
    ).toThrow("DEFECT_EVIDENCE_CLASSIFICATION_FORBIDDEN");
  });
});
