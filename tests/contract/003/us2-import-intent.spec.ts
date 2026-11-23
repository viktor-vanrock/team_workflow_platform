import { describe, expect, it } from "vitest";

import {
  buildImportDiscoveryQuery,
  sanitizeImportDiagnostic,
} from "../../../packages/connector-jira/src/import/import-candidate-source.ts";

describe("US2 import candidate contract", () => {
  it("builds strict scope JQL and content-free diagnostics", () => {
    const plan = buildImportDiscoveryQuery({
      projectKey: "QAC",
      issueTypeId: "10001",
      discriminatorField: "customfield_10010",
      discriminatorValue: "alpha",
    });
    expect(plan.jql).toContain('project = "QAC"');
    expect(plan.jql).toContain('issuetype = "10001"');
    expect(plan.fields).toEqual(["id", "key", "updated", "creator"]);
    expect(
      sanitizeImportDiagnostic({
        externalEntityId: "1",
        reasonCode: "OUT_OF_SCOPE",
        summary: "secret",
      } as never),
    ).toEqual({ externalEntityId: "1", reasonCode: "OUT_OF_SCOPE" });
  });
});
