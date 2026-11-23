import { describe, expect, it } from "vitest";

import {
  type AuthorizationFacts,
  DenyByDefaultAuthorizationPolicy,
  validateAuthorizationBasis,
  type WorkspaceContext,
} from "../../../packages/platform-core/src/index.ts";

const now = new Date("2026-01-01T00:00:00Z");
const context: WorkspaceContext = {
  actor: { kind: "HUMAN", principalId: "actor", issuer: "issuer", subject: "subject" },
  scope: { kind: "PROJECT", workspaceId: "workspace", projectId: "project" },
  correlationId: "correlation-0001",
  causationId: "causation-0001",
};
const facts = (overrides: Partial<AuthorizationFacts> = {}): AuthorizationFacts => ({
  membership: {
    ref: { id: "membership", version: 1 },
    workspaceId: "workspace",
    principalId: "actor",
    state: "ACTIVE",
    validFrom: new Date("2025-01-01"),
  },
  entitlements: [
    {
      ref: { id: "entitlement", version: 1 },
      workspaceId: "workspace",
      projectId: "project",
      principalId: "actor",
      effect: "ALLOW",
      permissions: new Set(["work-item.read"]),
      classificationCeiling: { key: "INTERNAL", rank: 10 },
      validFrom: new Date("2025-01-01"),
    },
  ],
  roleAssignments: [
    {
      ref: { id: "role", version: 1 },
      workspaceId: "workspace",
      projectId: "project",
      principalId: "actor",
      roleKey: "requester",
      permissions: new Set(["work-item.read"]),
      effect: "ALLOW",
      validFrom: new Date("2025-01-01"),
    },
  ],
  ...overrides,
});
const decide = (authorizationFacts: AuthorizationFacts, resource = { key: "INTERNAL", rank: 10 }) =>
  new DenyByDefaultAuthorizationPolicy().decide({
    context,
    permission: "work-item.read",
    resourceClassification: resource,
    facts: authorizationFacts,
    at: now,
  });

describe("membership ∩ entitlement ∩ role ∩ classification", () => {
  it("allows only when every factor is current", () => {
    expect(decide(facts())).toMatchObject({ allowed: true, reason: "ALLOW" });
  });
  it("defaults to deny for each missing factor", () => {
    expect(
      decide({ entitlements: facts().entitlements, roleAssignments: facts().roleAssignments }),
    ).toMatchObject({ allowed: false, reason: "NO_MEMBERSHIP" });
    expect(decide(facts({ entitlements: [] }))).toMatchObject({
      allowed: false,
      reason: "NO_ENTITLEMENT",
    });
    expect(decide(facts({ roleAssignments: [] }))).toMatchObject({
      allowed: false,
      reason: "NO_ROLE_PERMISSION",
    });
    expect(decide(facts(), { key: "RESTRICTED", rank: 20 })).toMatchObject({
      allowed: false,
      reason: "CLASSIFICATION_EXCEEDED",
    });
  });
  it("gives explicit DENY precedence over ALLOW", () => {
    const deny = {
      ...facts().entitlements[0]!,
      ref: { id: "deny", version: 1 },
      effect: "DENY" as const,
    };
    expect(decide(facts({ entitlements: [...facts().entitlements, deny] }))).toMatchObject({
      allowed: false,
      reason: "EXPLICIT_DENY",
    });
  });
  it("validates closed Project and Workspace authorization-basis forms", () => {
    const basis = decide(facts()).basis!;
    expect(() => validateAuthorizationBasis(context.scope, basis)).not.toThrow();
    expect(() =>
      validateAuthorizationBasis({ kind: "WORKSPACE", workspaceId: "workspace" }, basis),
    ).toThrow(/invalid/u);
    expect(() =>
      validateAuthorizationBasis(
        { kind: "WORKSPACE", workspaceId: "workspace" },
        { ...basis, kind: "WORKSPACE", entitlementRefs: [] },
      ),
    ).not.toThrow();
  });
});
