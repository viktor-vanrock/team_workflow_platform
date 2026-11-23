import { describe, expect, it } from "vitest";

import { onboardingOperationCatalog } from "../../packages/platform-core/src/project-onboarding/authorization.ts";
import { onboardingRuntimeOperationCatalog } from "../../packages/runtime-composition/src/onboarding/composition.ts";

describe("onboarding operation ownership", () => {
  it("keeps QA policy in its Pack while composing all published operations", () => {
    expect(onboardingOperationCatalog.some((value) => value.permission.startsWith("qa."))).toBe(
      false,
    );
    expect(onboardingRuntimeOperationCatalog).toHaveLength(20);
    expect(new Set(onboardingRuntimeOperationCatalog.map((value) => value.operation)).size).toBe(
      20,
    );
    expect(onboardingRuntimeOperationCatalog).toContainEqual({
      operation: "exportEvidencePackage",
      permission: "qa.evidence.export",
      scope: "PROJECT",
      actionClass: "MUTATE",
      requiresHuman: true,
      stepUpRequired: true,
    });
  });
});
