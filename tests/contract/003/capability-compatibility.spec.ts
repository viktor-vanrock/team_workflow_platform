import { describe, expect, it } from "vitest";

import {
  assertOperationalActionInput,
  operationalWorkItemCapability,
  operationalWorkItemCapabilityV1_1,
} from "../../../packages/connector-sdk/src/index.ts";

describe("operational-work-item 1.0/1.1 compatibility", () => {
  it("preserves the exact 1.0 surface and adds only closed 1.1 operations", () => {
    expect(operationalWorkItemCapability).toEqual({
      key: "operational-work-item",
      version: "1.0.0",
      operations: ["request.create", "request.transition", "defect.create"],
    });
    expect(operationalWorkItemCapabilityV1_1.operations).toEqual([
      "request.create",
      "request.transition",
      "request.assign",
      "request.set-priority",
      "request.set-due-date",
      "defect.create",
    ]);
  });

  it("keeps 1.0 transitions READY|DONE and validates additive actions", () => {
    expect(() =>
      assertOperationalActionInput({
        schemaVersion: "1.0",
        operation: "request.transition",
        requestedNormalizedStatus: "READY",
        expectedExternalVersion: "v1",
      }),
    ).not.toThrow();
    expect(() =>
      assertOperationalActionInput({
        schemaVersion: "1.0",
        operation: "request.transition",
        requestedNormalizedStatus: "IN_PROGRESS",
        expectedExternalVersion: "v1",
      }),
    ).toThrow("SCHEMA_DRIFT");
    expect(() =>
      assertOperationalActionInput({
        schemaVersion: "1.1",
        operation: "request.assign",
        assignment: { canonicalPrincipalId: "11111111-1111-4111-8111-111111111111" },
      }),
    ).not.toThrow();
    expect(() =>
      assertOperationalActionInput({
        schemaVersion: "1.1",
        operation: "request.update",
        fields: {},
      }),
    ).toThrow("SCHEMA_DRIFT");
  });
});
