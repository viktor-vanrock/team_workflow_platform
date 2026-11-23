import { describe, expect, it } from "vitest";

import {
  type AuthorizationFacts,
  DenyByDefaultAuthorizationPolicy,
  type WorkspaceContext,
} from "../../../packages/platform-core/src/index.ts";
import { type FixtureOverrides, fixtureWithOverrides } from "../../support/fixture-value.ts";

const at = new Date("2026-09-03T12:00:00.000Z");
const context: WorkspaceContext = {
  actor: { kind: "HUMAN", principalId: "actor", issuer: "local", subject: "actor" },
  scope: { kind: "PROJECT", workspaceId: "workspace", projectId: "project" },
  correlationId: "correlation",
  causationId: "causation",
};
const member = {
  ref: { id: "membership", version: 1 },
  workspaceId: "workspace",
  principalId: "actor",
  state: "ACTIVE" as const,
  validFrom: new Date("2026-01-01"),
};
const allow = (version = 2, effect: "ALLOW" | "DENY" = "ALLOW") => ({
  ref: { id: "entitlement", version },
  workspaceId: "workspace",
  projectId: "project",
  principalId: "actor",
  effect,
  permissions: new Set(["qa.read", "qa.effect"]),
  classificationCeiling: { key: "INTERNAL", rank: 10 },
  validFrom: new Date("2026-01-01"),
});
const role = (effect: "ALLOW" | "DENY" = "ALLOW") => ({
  ref: { id: `role-${effect}`, version: 1 },
  workspaceId: "workspace",
  projectId: "project",
  principalId: "actor",
  roleKey: "qa",
  permissions: new Set(["qa.read", "qa.effect"]),
  effect,
  validFrom: new Date("2026-01-01"),
});
const facts = (overrides: FixtureOverrides<AuthorizationFacts> = {}): AuthorizationFacts =>
  fixtureWithOverrides<AuthorizationFacts>(
    { membership: member, entitlements: [allow()], roleAssignments: [role()] },
    overrides,
  );
const decide = (
  overrides: Partial<Parameters<DenyByDefaultAuthorizationPolicy["decide"]>[0]> = {},
) =>
  new DenyByDefaultAuthorizationPolicy().decide({
    context,
    permission: "qa.read",
    resourceClassification: { key: "INTERNAL", rank: 10 },
    facts: facts(),
    currentEntitlementRefs: [{ id: "entitlement", version: 2 }],
    projectOperationalState: "ACTIVE",
    operationClass: "READ",
    at,
    ...overrides,
  });

describe("Feature 007 US3 default-deny authorization matrix", () => {
  it.each([
    ["all current", {}, true, "ALLOW"],
    ["no membership", { facts: facts({ membership: undefined }) }, false, "NO_MEMBERSHIP"],
    ["no entitlement", { facts: facts({ entitlements: [] }) }, false, "NO_ENTITLEMENT"],
    ["no role", { facts: facts({ roleAssignments: [] }) }, false, "NO_ROLE_PERMISSION"],
    [
      "classification",
      { resourceClassification: { key: "RESTRICTED", rank: 20 } },
      false,
      "CLASSIFICATION_EXCEEDED",
    ],
    [
      "stale entitlement revision",
      { currentEntitlementRefs: [{ id: "entitlement", version: 3 }] },
      false,
      "NO_ENTITLEMENT",
    ],
    [
      "suspended effect",
      { permission: "qa.effect", operationClass: "EFFECT", projectOperationalState: "SUSPENDED" },
      false,
      "PROJECT_SUSPENDED",
    ],
    ["suspended read", { projectOperationalState: "SUSPENDED" }, true, "ALLOW"],
  ] as const)("evaluates %s", (_name, request, allowed, reason) => {
    expect(decide(request as never)).toMatchObject({
      allowed,
      reason,
      publicReason: allowed ? "ALLOW" : expect.any(String),
    });
  });

  it("gives current entitlement or role DENY precedence over every ALLOW", () => {
    expect(
      decide({
        facts: facts({
          entitlements: [allow(), { ...allow(2, "DENY"), ref: { id: "deny", version: 2 } }],
        }),
        currentEntitlementRefs: [
          { id: "entitlement", version: 2 },
          { id: "deny", version: 2 },
        ],
      }),
    ).toMatchObject({ allowed: false, reason: "EXPLICIT_DENY" });
    expect(
      decide({
        facts: facts({ roleAssignments: [role(), role("DENY")] }),
        resourceClassification: { key: "RESTRICTED", rank: 20 },
      }),
    ).toMatchObject({ allowed: false, reason: "EXPLICIT_DENY" });
  });

  it.each(["project.suspend", "project.resume", "qa.evidence.verify", "qa.evidence.export"])(
    "permits suspended-project maintenance %s only with current authority, never effects",
    (permission) => {
      const entitled = { ...allow(), permissions: new Set([permission]) };
      const assigned = { ...role(), permissions: new Set([permission]) };
      const request = {
        permission,
        operationClass: "MUTATE" as const,
        projectOperationalState: "SUSPENDED" as const,
        facts: facts({ entitlements: [entitled], roleAssignments: [assigned] }),
      };
      expect(decide(request)).toMatchObject({ allowed: true });
      expect(decide({ ...request, operationClass: "EFFECT" })).toMatchObject({
        allowed: false,
        reason: "PROJECT_SUSPENDED",
      });
      expect(
        decide({
          ...request,
          context: {
            ...context,
            actor: { kind: "SERVICE", principalId: "actor", serviceKey: "worker" },
          },
        }),
      ).toMatchObject({ allowed: false, reason: "PROJECT_SUSPENDED" });
      expect(
        decide({
          ...request,
          facts: facts({
            entitlements: [entitled],
            roleAssignments: [{ ...assigned, effect: "DENY" }],
          }),
        }),
      ).toMatchObject({ allowed: false, reason: "EXPLICIT_DENY" });
      expect(
        decide({ ...request, facts: facts({ entitlements: [], roleAssignments: [assigned] }) }),
      ).toMatchObject({ allowed: false, reason: "NO_ENTITLEMENT" });
    },
  );
});
