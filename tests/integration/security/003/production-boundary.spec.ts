import { describe, expect, it } from "vitest";

import {
  assertJiraEffectsAllowed,
  jiraEffectBoundary,
  loadEnvironment,
  parseRuntimeEnvironmentScope,
} from "../../../../packages/runtime-composition/src/config/environment.ts";

const nonLocalBase = Object.freeze({
  AWP_EXTERNAL_NETWORK_MODE: "allowlisted",
  AWP_IDENTITY_ISSUER: "https://identity.example.test",
  AWP_DATABASE_URL: "postgresql://runtime@example.test/awp",
});

describe("Feature 003 production Jira boundary", () => {
  it("normalizes canonical scopes and audits legacy profile parsing", () => {
    expect(parseRuntimeEnvironmentScope({ AWP_ENVIRONMENT: "LOCAL" })).toEqual({
      scope: "LOCAL",
      source: "CANONICAL",
      raw: "LOCAL",
    });
    expect(parseRuntimeEnvironmentScope({ AWP_RUNTIME_PROFILE: "test" })).toEqual({
      scope: "LOCAL",
      source: "LEGACY",
      raw: "test",
    });
    expect(parseRuntimeEnvironmentScope({ AWP_RUNTIME_PROFILE: "non-local" })).toEqual({
      scope: "NON_PROD",
      source: "LEGACY",
      raw: "non-local",
    });
    expect(() =>
      parseRuntimeEnvironmentScope({ AWP_ENVIRONMENT: "PREPROD", AWP_RUNTIME_PROFILE: "local" }),
    ).toThrow("RUNTIME_ENVIRONMENT_CONFLICT");
  });

  it.each(["PREPROD", "PLATFORM_PROD"] as const)(
    "denies Jira effects, credential resolution and Jira egress in %s",
    (scope) => {
      expect(() => loadEnvironment({ ...nonLocalBase, AWP_ENVIRONMENT: scope })).toThrow(
        "BLOCKED_INPUT:AWP_DEPLOYMENT_CONFIG",
      );
      const environment = { environmentScope: scope };
      const boundary = jiraEffectBoundary(environment);

      expect(environment.environmentScope).toBe(scope);
      expect(boundary).toEqual({
        environmentScope: scope,
        effects: "DENIED",
        credentialResolution: "DENIED",
        networkEgress: "DENIED",
        reasonCode: "JIRA_EFFECT_ENVIRONMENT_FORBIDDEN",
      });
      expect(JSON.stringify(boundary)).not.toMatch(/secretRef|credentialValue|endpoint|baseUrl/iu);
      expect(() => assertJiraEffectsAllowed(environment)).toThrow(
        "JIRA_EFFECT_ENVIRONMENT_FORBIDDEN",
      );
    },
  );

  it.each(["LOCAL", "NON_PROD"] as const)(
    "permits the Jira effect boundary only in %s",
    (scope) => {
      const environment = { environmentScope: scope };
      if (scope === "LOCAL")
        expect(
          loadEnvironment({ AWP_ENVIRONMENT: scope, AWP_EXTERNAL_NETWORK_MODE: "deny" })
            .environmentScope,
        ).toBe(scope);
      else
        expect(() => loadEnvironment({ ...nonLocalBase, AWP_ENVIRONMENT: scope })).toThrow(
          "BLOCKED_INPUT:AWP_DEPLOYMENT_CONFIG",
        );

      expect(jiraEffectBoundary(environment)).toEqual({
        environmentScope: scope,
        effects: "ALLOWED",
        credentialResolution: "ALLOWED",
        networkEgress: "ALLOWED",
        reasonCode: "JIRA_EFFECT_ENVIRONMENT_ALLOWED",
      });
      expect(() => assertJiraEffectsAllowed(environment)).not.toThrow();
    },
  );
});
