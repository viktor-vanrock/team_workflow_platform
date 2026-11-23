import { beforeEach, describe, expect, it } from "vitest";

import type {
  AuthorizationFacts,
  Identity,
  ScopedAccessRepositoryPort,
} from "../../../../packages/platform-core/src/index.ts";
import type { VerifiedOidcIdentity } from "../../../../packages/platform-runtime-nest/src/index.ts";
import { CorporateIdentityService } from "../../../../packages/runtime-composition/src/security/corporate-identity.ts";

describe("008 corporate scope and current rights", () => {
  const at = Date.now();
  const ref = { id: "policy", version: 1, contentHash: `sha256:${"a".repeat(64)}` as const };
  const evidence: VerifiedOidcIdentity = {
    issuer: "https://identity.example",
    subject: "alice",
    tokenId: "token-id",
    clientId: "browser",
    issuedAt: Math.floor(at / 1000),
    expiresAt: Math.floor(at / 1000) + 300,
    groups: ["qa"],
    amr: [],
  };
  const scope = { kind: "PROJECT" as const, workspaceId: "workspace", projectId: "project" };
  let facts: AuthorizationFacts;
  let revoked: boolean;
  let projectState: "ACTIVE" | "SUSPENDED";
  let identity: Identity | undefined;
  let service: CorporateIdentityService;
  beforeEach(() => {
    identity = {
      id: "alice-id",
      issuer: evidence.issuer,
      subject: evidence.subject,
      kind: "HUMAN",
      displayName: "Alice",
    };
    revoked = false;
    projectState = "ACTIVE";
    facts = {
      membership: {
        ref,
        workspaceId: "workspace",
        principalId: "alice-id",
        state: "ACTIVE",
        validFrom: new Date(0),
      },
      entitlements: [
        {
          ref,
          ...scope,
          principalId: "alice-id",
          effect: "ALLOW",
          permissions: new Set(["pilot.read"]),
          classificationCeiling: { key: "INTERNAL", rank: 10 },
          validFrom: new Date(0),
        },
      ],
      roleAssignments: [
        {
          ref,
          ...scope,
          principalId: "alice-id",
          roleKey: "QA_LEAD",
          effect: "ALLOW",
          permissions: new Set(["pilot.read"]),
          validFrom: new Date(0),
        },
      ],
    };
    const access: ScopedAccessRepositoryPort = {
      getWorkspace: async () => ({ id: "workspace", key: "w", name: "w", state: "ACTIVE" }),
      getProject: async () => ({
        id: "project",
        workspaceId: "workspace",
        key: "p",
        state: projectState,
        classification: { key: "INTERNAL", rank: 10 },
      }),
      authorizationFacts: async () => facts,
      listVisibleProjects: async () => [],
    };
    service = new CorporateIdentityService(
      {
        ref,
        issuer: evidence.issuer,
        mappings: [
          { group: "qa", workspaceId: "workspace", projectIds: ["project"], roleKeys: ["QA_LEAD"] },
        ],
      },
      { findByVerifiedSubject: async () => identity },
      access,
      { active: async () => !revoked },
      () => at,
    );
  });
  const authorize = (overrides = {}) =>
    service.authorize(evidence, {
      scope,
      permission: "pilot.read",
      operationClass: "READ",
      ...overrides,
    });
  it("intersects mapped roles with current Core facts and retains correlation", async () => {
    expect(await authorize({ correlationId: "request-1" })).toMatchObject({
      actor: { principalId: "alice-id" },
      scope,
      correlationId: "request-1",
      authorizationBasis: { entitlementRefs: [{ id: "policy", version: 1 }] },
    });
  });
  it("does not turn claims or an unknown group into grants", async () => {
    await expect(
      service.authorize(
        { ...evidence, groups: ["owner", "administrator"] },
        { scope, permission: "pilot.read", operationClass: "READ" },
      ),
    ).rejects.toThrow();
    facts = { ...facts, entitlements: [] };
    await expect(authorize()).rejects.toThrow("PROJECT_RESOURCE_NOT_AVAILABLE");
  });
  it("rejects membership/role/entitlement revocation on the next request", async () => {
    await authorize();
    facts = { ...facts, membership: { ...facts.membership!, state: "REVOKED" } };
    await expect(authorize()).rejects.toThrow();
  });
  it("keeps explicit denies even for unmapped roles", async () => {
    facts = {
      ...facts,
      roleAssignments: [
        ...facts.roleAssignments,
        { ...facts.roleAssignments[0]!, roleKey: "UNMAPPED", effect: "DENY" },
      ],
    };
    await expect(authorize()).rejects.toThrow();
  });
  it("rejects cross-project/workspace scope and classification escalation", async () => {
    await expect(authorize({ scope: { ...scope, projectId: "other" } })).rejects.toThrow();
    await expect(authorize({ scope: { ...scope, workspaceId: "other" } })).rejects.toThrow();
    facts = {
      ...facts,
      entitlements: facts.entitlements.map((entry) => ({
        ...entry,
        classificationCeiling: { key: "PUBLIC", rank: 0 },
      })),
    };
    await expect(authorize()).rejects.toThrow();
  });
  it("rejects canonical identity drift, service identities and revocation", async () => {
    identity = { ...identity!, kind: "SERVICE" };
    await expect(authorize()).rejects.toThrow();
    identity = undefined;
    await expect(authorize()).rejects.toThrow();
    revoked = true;
    await expect(authorize()).rejects.toThrow();
  });
  it("allows scoped reads during project suspension and denies mutation", async () => {
    projectState = "SUSPENDED";
    await authorize();
    await expect(authorize({ operationClass: "MUTATE" })).rejects.toThrow();
  });
});
