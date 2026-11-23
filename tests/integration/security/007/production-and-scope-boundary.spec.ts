import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  jiraEffectBoundary,
  loadEnvironment,
  mattermostEffectBoundary,
} from "../../../../packages/runtime-composition/src/config/environment.ts";
import {
  assertOnboardingLocalSecurityBoundary,
  assertQueueLocalProductionBoundary,
  localContainerEgressPolicy,
} from "../../../../packages/runtime-composition/src/security/local-security.ts";

describe("Feature 007 aggregate production and scope boundary", () => {
  it("denies Jira, Mattermost and the full local contour in production before credential resolution", () => {
    expect(jiraEffectBoundary({ environmentScope: "PLATFORM_PROD" })).toMatchObject({
      effects: "DENIED",
      credentialResolution: "DENIED",
      networkEgress: "DENIED",
    });
    expect(mattermostEffectBoundary({ environmentScope: "PLATFORM_PROD" })).toMatchObject({
      effects: "DENIED",
      credentialResolution: "DENIED",
      networkEgress: "DENIED",
    });
    expect(() =>
      loadEnvironment({
        AWP_ENVIRONMENT: "PLATFORM_PROD",
        AWP_COMPOSITION: "qa-jira-gitlab-mattermost-local",
        AWP_IDENTITY_ISSUER: "https://idp.invalid",
      }),
    ).toThrow("QA_JIRA_GITLAB_LOCAL_COMPOSITION_BARRIER_REQUIRED");
    expect(() =>
      assertQueueLocalProductionBoundary({
        AWP_PRODUCTION_API_TOKEN: "secret",
        AWP_EXTERNAL_ENDPOINT: "https://production.invalid",
      }),
    ).toThrow();
  });

  it("keeps generated security evidence free of obvious credentials and provider locators", () => {
    const root = resolve(import.meta.dirname, "../../../..");
    for (const file of ["us3.json", "us4.json", "us5.json"]) {
      const text = readFileSync(
        resolve(root, "reports/007-project-onboarding-evidence-security", file),
        "utf8",
      );
      expect(text, file).not.toMatch(
        /(?:password|access[_-]?token|private[_-]?key|secret:\/\/raw)/iu,
      );
    }
  });

  it("pins the exact onboarding contour, isolated signer and internal-only egress", () => {
    const environment = {
      AWP_ENVIRONMENT: "LOCAL",
      AWP_RUNTIME_PROFILE: "local",
      AWP_COMPOSITION: "qa-jira-gitlab-mattermost-local",
      AWP_EXTERNAL_NETWORK_MODE: "deny",
      AWP_ONBOARDING_STATIC_CONTOUR: "true",
      AWP_EVIDENCE_SIGNER: "local-ed25519",
      AWP_EVIDENCE_SIGNER_KID: "local-ed25519:1",
      AWP_EVIDENCE_SIGNER_PRIVATE_MATERIAL: "true",
      AWP_MOCK_HUB_URL: "http://mock-hub:4010",
    };
    expect(() => assertOnboardingLocalSecurityBoundary(environment)).not.toThrow();
    expect(() => loadEnvironment(environment)).not.toThrow();
    expect(localContainerEgressPolicy.canReach("worker", "mock-hub")).toBe(true);
    expect(localContainerEgressPolicy.canReach("worker", "gitlab.com")).toBe(false);
    expect(() =>
      assertOnboardingLocalSecurityBoundary({
        ...environment,
        AWP_PRODUCTION_SIGNING_SECRET: "secret",
      }),
    ).toThrow("QUEUE_LOCAL_PRODUCTION_AUTHORITY_FORBIDDEN");
  });
});
