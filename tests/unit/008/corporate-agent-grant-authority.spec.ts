import { afterEach, describe, expect, it, vi } from "vitest";

import { createCorporateAgentGrantAuthority } from "../../../apps/api/src/extensions/corporate-agent-grant-authority.ts";
import { DenyByDefaultAuthorizationPolicy } from "../../../packages/platform-core/src/index.ts";
import {
  TypeOrmCorporateScopedAccessRepository,
  TypeOrmIdentityRepository,
} from "../../../packages/platform-persistence-typeorm/src/index.ts";

const configuration = {
  workspaceId: "workspace",
  projectId: "project",
  servicePrincipalId: "service",
  serviceIdentity: { issuer: "issuer", subject: "service-subject", serviceKey: "agent" },
  actions: [
    { action: "facts.read", humanPermission: "work-item.read", servicePermission: "agent.read" },
  ],
};
const input = {
  authorization: {
    scope: { kind: "PROJECT", workspaceId: "workspace", projectId: "project" },
    actor: { kind: "HUMAN", principalId: "human", issuer: "issuer", subject: "human-subject" },
    classificationCeiling: "INTERNAL",
  },
  subject: {
    kind: "DRAFT",
    id: "draft",
    version: 1,
    contentHash: "hash",
    aggregateSnapshotHash: "hash",
  },
  skill: {
    maxClassification: "INTERNAL",
    actionAllowlist: [
      { action: "facts.read", effectClass: "READ_ONLY" },
      { action: "unmapped.read", effectClass: "READ_ONLY" },
    ],
  },
};
afterEach(() => vi.restoreAllMocks());

describe("corporate agent grants", () => {
  it("intersects the skill mapping with current human and service rights", async () => {
    vi.spyOn(TypeOrmIdentityRepository.prototype, "findByVerifiedSubject").mockImplementation(
      async (_issuer, subject) =>
        subject === "human-subject"
          ? ({ id: "human", kind: "HUMAN" } as never)
          : ({ id: "service", kind: "SERVICE" } as never),
    );
    vi.spyOn(TypeOrmCorporateScopedAccessRepository.prototype, "getWorkspace").mockResolvedValue({
      state: "ACTIVE",
    } as never);
    vi.spyOn(TypeOrmCorporateScopedAccessRepository.prototype, "getProject").mockResolvedValue({
      state: "ACTIVE",
    } as never);
    vi.spyOn(
      TypeOrmCorporateScopedAccessRepository.prototype,
      "authorizationFacts",
    ).mockResolvedValue({} as never);
    const decision = vi
      .spyOn(DenyByDefaultAuthorizationPolicy.prototype, "decide")
      .mockReturnValue({ allowed: true } as never);
    const authority = createCorporateAgentGrantAuthority({ isInitialized: true } as never, [
      configuration,
    ]);
    const result = await authority.resolve(input as never);
    expect(result.grants.map((grant) => grant.action)).toEqual(["facts.read"]);
    expect(decision).toHaveBeenCalledTimes(2);
    decision.mockReturnValueOnce({ allowed: false } as never);
    expect((await authority.resolve(input as never)).grants).toEqual([]);
  });
  it("rejects identities and classifications outside the approved scope", async () => {
    const authority = createCorporateAgentGrantAuthority({ isInitialized: true } as never, [
      configuration,
    ]);
    await expect(
      authority.resolve({
        ...input,
        authorization: { ...input.authorization, classificationCeiling: "PUBLIC" },
      } as never),
    ).rejects.toThrow("AGENT_GRANTS_DENIED");
    await expect(
      authority.resolve({
        ...input,
        authorization: {
          ...input.authorization,
          scope: { ...input.authorization.scope, projectId: "other" },
        },
      } as never),
    ).rejects.toThrow("AGENT_GRANTS_DENIED");
  });
});
