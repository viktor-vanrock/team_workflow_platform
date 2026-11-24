import { describe, expect, it, vi } from "vitest";

import { assertNoAuthoritativeClientFields } from "../../../../packages/platform-runtime-nest/src/auth/workspace-context.ts";
import { assertLocalPhysicalBarrier } from "../../../../packages/runtime-composition/src/config/local-runtime-policy.ts";
import {
  assertNonLocalConfiguration,
  nonLocalComposition,
} from "../../../../packages/runtime-composition/src/non-local.composition.ts";
import {
  assertConnectionEndpointAllowed,
  assertEffectEndpointAllowed,
  assertLocalSecretsAllowed,
  localContainerEgressPolicy,
  localPersonaCatalog,
} from "../../../../packages/runtime-composition/src/security/local-security.ts";

describe("AT-003 local security boundary", () => {
  it("exposes only persona keys while grants remain server-side", () => {
    expect(localPersonaCatalog.publicOptions()).toEqual([
      { key: "superadmin.local", label: "Суперадминистратор" },
      { key: "owner.local", label: "Администратор · 1" },
      { key: "integration-admin.alpha", label: "Администратор · 2" },
      { key: "requester.alpha", label: "Requester" },
      { key: "executor.alpha", label: "QA Executor · QA 1" },
      { key: "executor.qa2", label: "QA Executor · QA 2" },
      { key: "lead.alpha", label: "QA Lead" },
      { key: "viewer.beta", label: "Читатель" },
      { key: "writer.docs", label: "Технический писатель" },
      { key: "lead.docs", label: "Лид технических писателей" },
    ]);
    expect(localPersonaCatalog.resolve("owner.local")).toMatchObject({
      roles: ["system-administrator"],
      permissions: expect.arrayContaining(["approval.decide"]),
    });
    expect(() => localPersonaCatalog.resolve("admin")).toThrow("LOCAL_PERSONA_UNKNOWN");
  });

  it.each(["role", "roles", "workspaceId", "projectId", "authorizationBasis"])(
    "rejects forged authoritative field %s",
    (field) => {
      expect(() =>
        assertNoAuthoritativeClientFields({ personaKey: "requester", [field]: "forged" }),
      ).toThrow(/forbidden/u);
    },
  );

  it("denies fake secrets outside local and denies non-local connections before persistence/effect", async () => {
    expect(() =>
      assertLocalSecretsAllowed("non-local", { AWP_PROVIDER_SECRET_KEY: "local-only" }),
    ).toThrow("FAKE_SECRET_FORBIDDEN_OUTSIDE_LOCAL");
    const persist = vi.fn();
    expect(() =>
      assertConnectionEndpointAllowed("non-local", "http://mock-hub:4010", persist),
    ).toThrow("NON_LOCAL_CONNECTION_ENDPOINT_FORBIDDEN");
    expect(persist).not.toHaveBeenCalled();
    const invoke = vi.fn();
    expect(() => assertEffectEndpointAllowed("non-local", "http://mock-hub:4010", invoke)).toThrow(
      "NON_LOCAL_EFFECT_ENDPOINT_FORBIDDEN",
    );
    expect(invoke).not.toHaveBeenCalled();
  });

  it("allows API/worker to reach internal providers but denies public and corporate sinks", () => {
    expect(localContainerEgressPolicy.allowedServices).toEqual([
      "fake-idp",
      "mock-hub",
      "postgres",
    ]);
    expect(localContainerEgressPolicy.canReach("api", "mock-hub")).toBe(true);
    expect(localContainerEgressPolicy.canReach("worker", "mock-hub")).toBe(true);
    expect(localContainerEgressPolicy.canReach("api", "api.openai.com")).toBe(false);
    expect(localContainerEgressPolicy.canReach("worker", "corp.example.internal")).toBe(false);
  });

  it("keeps non-local composition Core-only and rejects every local provider fragment", () => {
    expect(nonLocalComposition).toMatchObject({
      extensionCandidates: [],
      localRoutes: [],
      localProviders: [],
    });
    expect(nonLocalComposition.entities.length).toBeGreaterThan(0);
    expect(() =>
      assertNonLocalConfiguration({
        AWP_RUNTIME_PROFILE: "non-local",
        AWP_EXTERNAL_NETWORK_MODE: "allowlisted",
        AWP_IDENTITY_ISSUER: "https://identity.example",
        AWP_EXTERNAL_ENDPOINT_ALLOWLIST: "https://api.example",
        AWP_MODEL_PROVIDER: "deterministic-fake",
      }),
    ).toThrow("NON_LOCAL_LOCAL_COMPONENT_REFERENCE_FORBIDDEN");
    expect(() =>
      assertLocalPhysicalBarrier({
        AWP_RUNTIME_PROFILE: "local",
        AWP_EXTERNAL_NETWORK_MODE: "deny",
        AWP_MOCK_HUB_URL: "http://mock-hub:4010",
        AWP_IDENTITY_ISSUER: "https://fake-idp:4443/oidc",
      }),
    ).not.toThrow();
  });
});
