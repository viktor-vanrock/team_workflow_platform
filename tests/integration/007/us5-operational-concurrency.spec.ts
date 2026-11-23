import { describe, expect, it } from "vitest";

import { InMemoryProjectSuspensionService } from "../../../packages/runtime-composition/src/onboarding/project-suspension-service.ts";

describe("US5 concurrency", () => {
  it("serializes competing suspend transitions", async () => {
    const s = new InMemoryProjectSuspensionService("FULL_QA");
    const settled = await Promise.allSettled([
      s.suspend({ expectedVersion: 1, idempotencyKey: "a", incidentRef: "A", reason: "risk" }),
      s.suspend({ expectedVersion: 1, idempotencyKey: "b", incidentRef: "B", reason: "risk" }),
    ]);
    expect(settled.filter((x) => x.status === "fulfilled")).toHaveLength(1);
  });
});
