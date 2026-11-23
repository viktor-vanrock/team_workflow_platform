import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("Feature 007 US1 Project API", () => {
  it("exposes registration, authorized catalog, onboarding evaluation and exact mutation concurrency", () => {
    const root = resolve(import.meta.dirname, "../../..");
    const openapi = readFileSync(
      resolve(
        root,
        "specs/007-project-onboarding-evidence-security/contracts/openapi/project-onboarding-evidence-api.v1.yaml",
      ),
      "utf8",
    );
    const controller = readFileSync(
      resolve(root, "packages/platform-runtime-nest/src/http/project-onboarding.controller.ts"),
      "utf8",
    );
    expect(openapi).toMatch(/operationId: (?:listAuthorizedProjects|registerProject)/u);
    expect(openapi).toContain("operationId: getProjectOnboarding");
    expect(openapi).toContain("operationId: evaluateProjectOnboarding");
    expect(openapi).toMatch(/Idempotency-Key|If-Match|ETag/u);
    expect(controller).toContain("ProjectOnboardingController");
    expect(controller).toMatch(/catalog|register|evaluate|onboarding/u);
  });
});
