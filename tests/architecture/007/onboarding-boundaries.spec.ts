import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../..");
const required = [
  "packages/platform-core/src/project-onboarding/model.ts",
  "packages/competency-qa/src/domain/project-resources.ts",
  "packages/runtime-composition/src/onboarding/composition.ts",
  "packages/platform-core/src/commanding/project-effect-guard.ts",
];

describe("Feature 007 ownership boundaries", () => {
  it("keeps Core provider-neutral, QA semantics Pack-owned and connector DTOs out of Core", () => {
    for (const path of required) expect(existsSync(resolve(root, path)), path).toBe(true);
    const core = readFileSync(
      resolve(root, "packages/platform-core/src/project-onboarding/model.ts"),
      "utf8",
    );
    expect(core).not.toMatch(/jira|gitlab|mattermost|qa environment|test account/iu);
    const qa = readFileSync(
      resolve(root, "packages/competency-qa/src/domain/project-resources.ts"),
      "utf8",
    );
    expect(qa).toContain("QaProjectEnvironmentRevision");
    expect(qa).not.toMatch(
      /readonly\s+(?:password|accessToken|refreshToken|cookie|signedUrl)\??\s*:/u,
    );
  });

  it("does not create a new service or grant Hermes/model administrative authority", () => {
    const composition = readFileSync(
      resolve(root, "packages/runtime-composition/src/onboarding/composition.ts"),
      "utf8",
    );
    expect(composition).not.toMatch(/createServer|listen\(|NestFactory\.create/iu);
    expect(composition).not.toMatch(
      /Hermes.*(?:approve|publish|resume)|model.*(?:approve|verdict)/iu,
    );
  });
});
