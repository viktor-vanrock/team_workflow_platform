import { describe, expect, it } from "vitest";

import { createDefectMapping } from "../../../packages/connector-jira/src/operational/defect-create-mapper.ts";

describe("US4 defect.create contract", () => {
  it("preserves 1.0 target/payload and resolves ordered defect/request authority pins", () => {
    const mapped = createDefectMapping({
      effectId: "e1",
      effectMarker: "awp:e1",
      target: { projectId: "200", issueTypeId: "10002" },
      payload: {
        summary: "Checkout fails",
        description: "Steps",
        findingRef: { id: "f", version: "1", contentHash: "sha256:f" },
        sessionRef: { id: "s", version: "1", contentHash: "sha256:s" },
        buildRef: { id: "b", version: "1", contentHash: "sha256:b" },
        evidenceRefs: [{ id: "a", version: "1", contentHash: "sha256:a" }],
      },
      requiredFields: ["summary", "description"],
      pins: [
        {
          sequence: 0,
          purpose: "PRIMARY",
          logicalRole: "DEFECT_DESTINATION",
          authorityNamespaceHash: "n2",
        },
        {
          sequence: 1,
          purpose: "AUXILIARY",
          logicalRole: "QA_REQUEST_AUTHORITY",
          authorityNamespaceHash: "n1",
        },
      ],
    });
    expect(mapped.fields).toMatchObject({
      summary: "Checkout fails",
      description: "Steps",
      customfield_awp_effect: "awp:e1",
    });
    expect(mapped.configurationChain.map(({ logicalRole }) => logicalRole)).toEqual([
      "DEFECT_DESTINATION",
      "QA_REQUEST_AUTHORITY",
    ]);
    expect(mapped.target).toEqual({ projectId: "200", issueTypeId: "10002" });
  });
});
