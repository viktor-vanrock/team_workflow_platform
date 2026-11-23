import { describe, expect, it } from "vitest";

import type {
  AuthorizationFacts,
  ScopedAccessRepositoryPort,
} from "../../../packages/platform-core/src/index.ts";
import {
  type CorporateGroupPolicy,
  CorporateIdentityService,
} from "../../../packages/runtime-composition/src/security/corporate-identity.ts";

const ref = { id: "policy", version: 1, contentHash: `sha256:${"a".repeat(64)}` as const };
const evidence = {
  issuer: "https://identity.example",
  subject: "qa-1",
  tokenId: "token",
  clientId: "browser",
  issuedAt: 1,
  expiresAt: 9999999999,
  groups: ["qa"],
  amr: [],
};
function fixture() {
  let entitled = true;
  const role = {
    ref,
    workspaceId: "workspace",
    principalId: "qa-1",
    roleKey: "qa-executor",
    effect: "ALLOW" as const,
    permissions: new Set(["qa.session.execute"]),
    validFrom: new Date(0),
  };
  const access: ScopedAccessRepositoryPort = {
    getWorkspace: async () => ({ id: "workspace", key: "w", name: "w", state: "ACTIVE" }),
    getProject: async (scope) => ({
      id: scope.projectId,
      workspaceId: scope.workspaceId,
      key: scope.projectId,
      state: "ACTIVE",
      classification: { key: "INTERNAL", rank: 10 },
    }),
    authorizationFacts: async (scope): Promise<AuthorizationFacts> => ({
      membership: {
        ref,
        workspaceId: "workspace",
        principalId: "qa-1",
        state: "ACTIVE",
        validFrom: new Date(0),
      },
      roleAssignments: [role],
      entitlements:
        entitled && scope.kind === "PROJECT"
          ? [
              {
                ...role,
                projectId: scope.projectId,
                classificationCeiling: { key: "INTERNAL", rank: 10 },
              },
            ]
          : [],
    }),
    listVisibleProjects: async () => [],
  };
  const policy: CorporateGroupPolicy = {
    ref,
    issuer: evidence.issuer,
    mappings: [
      {
        group: "qa",
        workspaceId: "workspace",
        projectIds: [],
        projectAccessScope: "ALL_PROJECTS",
        roleKeys: ["qa-executor"],
      },
    ],
  };
  const create = (input = policy) =>
    new CorporateIdentityService(
      input,
      {
        findByVerifiedSubject: async () => ({
          id: "qa-1",
          kind: "HUMAN",
          issuer: evidence.issuer,
          subject: evidence.subject,
          displayName: "QA 1",
        }),
      },
      access,
      { active: async () => true },
    );
  return {
    create,
    policy,
    revoke: () => {
      entitled = false;
    },
  };
}
describe("explicit shared corporate QA mapping", () => {
  it("supports existing/future projects while requiring live exact grants and workspace/role", async () => {
    const f = fixture(),
      service = f.create();
    const authorize = (
      projectId: string,
      workspaceId = "workspace",
      permission = "qa.session.execute",
    ) =>
      service.authorize(evidence, {
        scope: { kind: "PROJECT", workspaceId, projectId },
        permission,
        operationClass: "MUTATE",
      });
    for (const project of ["ALPHA", "BETA", "NEW_PROJECT"])
      expect((await authorize(project)).scope).toMatchObject({ projectId: project });
    await expect(authorize("ALPHA", "foreign")).rejects.toThrow();
    await expect(authorize("ALPHA", "workspace", "project.entitlement.grant")).rejects.toThrow();
    f.revoke();
    await expect(authorize("NEW_PROJECT")).rejects.toThrow();
  });
  it("rejects ambiguous all-projects policies and wildcard role/project keys", () => {
    const f = fixture();
    for (const patch of [
      { projectIds: ["ALPHA"] },
      { roleKeys: ["*"] },
      { projectAccessScope: "SELECTED_PROJECTS" as const },
    ]) {
      expect(() =>
        f.create({ ...f.policy, mappings: [{ ...f.policy.mappings[0]!, ...patch }] }),
      ).toThrow("CORPORATE_IDENTITY_POLICY_INVALID");
    }
  });
});
