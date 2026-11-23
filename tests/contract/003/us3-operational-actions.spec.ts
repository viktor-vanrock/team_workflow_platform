import { describe, expect, it } from "vitest";

import { assertOperationalActionRequest } from "../../../packages/platform-core/src/work-management/operational-authority.ts";

describe("US3 action routes", () => {
  it.each([
    ["request.transition", { transition: { toStatusKey: "DONE" } }],
    ["request.assign", { assignment: { canonicalPrincipalId: "p" } }],
    ["request.set-priority", { priority: { normalizedKey: "HIGH" } }],
    ["request.set-due-date", { dueDate: { value: "2026-09-01" } }],
  ] as const)("accepts closed %s body", (operation, payload) => {
    expect(assertOperationalActionRequest({ operation, payload, ifMatch: 'W/"3"' })).toMatchObject({
      operation,
      ifMatch: 'W/"3"',
    });
  });
  it("rejects unknown body keys", () => {
    expect(() =>
      assertOperationalActionRequest({
        operation: "request.transition",
        payload: { transition: { toStatusKey: "DONE" }, providerId: "11" },
        ifMatch: 'W/"3"',
      }),
    ).toThrow("OPERATIONAL_ACTION_BODY_CLOSED");
  });
});
