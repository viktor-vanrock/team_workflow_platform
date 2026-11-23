import { describe, expect, it, vi } from "vitest";

import type {
  AuthorizationBasisRef,
  WorkspaceContext,
} from "../../../packages/platform-core/src/index.ts";

interface LiveQaHumanAuthorization {
  readonly allowed: boolean;
  readonly roleKey?: string;
  readonly authorizationBasis?: AuthorizationBasisRef;
}

interface LiveQaHumanAuthorizationPort {
  authorizeHuman(context: WorkspaceContext, permission: string): Promise<LiveQaHumanAuthorization>;
}

interface QaHumanAttestation {
  readonly actorId: string;
  readonly permission: string;
  readonly roleKey: string;
  readonly authorizationBasis: AuthorizationBasisRef;
}

interface QaHumanActorPolicyInstance {
  attest(
    input: Readonly<{
      context: WorkspaceContext;
      permission: string;
      claimedRole?: string;
    }>,
  ): Promise<QaHumanAttestation>;
}

interface QaHumanActorPolicyConstructor {
  new (authorization: LiveQaHumanAuthorizationPort): QaHumanActorPolicyInstance;
}

interface QaAuthorizationExports {
  readonly qaPermissionCatalog?: readonly string[];
  readonly QaHumanActorPolicy?: QaHumanActorPolicyConstructor;
}

const permissionCatalog = [
  "qa.request.create",
  "qa.request.confirm",
  "qa.request.input.revise",
  "qa.readiness.evaluate",
  "qa.readiness.confirm",
  "qa.readiness.waive",
  "qa.required-session-plan.publish",
  "qa.session.plan",
  "qa.session.execute",
  "qa.session.review",
  "qa.plan-item.result",
  "qa.finding.classify",
  "qa.finding.accept-risk",
  "qa.defect.draft",
  "qa.defect.publish",
  "qa.evidence.write",
  "qa.evidence.read",
  "qa.evidence.post-close-correction.record",
  "qa.verdict.sign",
  "qa.verdict.cosign",
  "qa.waiver.approve",
  "qa.completion.request",
  "qa.completion.approve",
] as const;

const rolePermissions = Object.freeze({
  requester: new Set(["qa.request.create", "qa.request.confirm", "qa.request.input.revise"]),
  executor: new Set([
    "qa.request.input.revise",
    "qa.readiness.evaluate",
    "qa.readiness.confirm",
    "qa.required-session-plan.publish",
    "qa.session.plan",
    "qa.session.execute",
    "qa.session.review",
    "qa.plan-item.result",
    "qa.finding.classify",
    "qa.defect.draft",
    "qa.defect.publish",
    "qa.evidence.write",
    "qa.evidence.read",
    "qa.verdict.sign",
    "qa.completion.request",
  ]),
  lead: new Set([
    "qa.readiness.confirm",
    "qa.readiness.waive",
    "qa.required-session-plan.publish",
    "qa.finding.accept-risk",
    "qa.verdict.cosign",
    "qa.waiver.approve",
    "qa.completion.approve",
  ]),
} as const);

const basis: AuthorizationBasisRef = Object.freeze({
  kind: "PROJECT",
  membershipRef: { id: "membership", version: 1 },
  entitlementRefs: [{ id: "entitlement", version: 1 }],
  roleAssignmentRefs: [{ id: "role", version: 1 }],
  policyVersion: "qa.authorization@1",
  skillContext: "NOT_APPLICABLE",
} as const);

function humanContext(principalId: keyof typeof rolePermissions): WorkspaceContext {
  return Object.freeze({
    actor: { kind: "HUMAN", principalId, issuer: "fake-idp", subject: principalId },
    scope: { kind: "PROJECT", workspaceId: "workspace-alpha", projectId: "project-alpha" },
    correlationId: `correlation-${principalId}`,
    causationId: `causation-${principalId}`,
  } as const);
}

function nonHumanContext(kind: "SERVICE" | "AGENT" | "EXTERNAL"): WorkspaceContext {
  const actor =
    kind === "SERVICE"
      ? { kind, principalId: "worker", serviceKey: "worker.local" }
      : { kind, principalId: kind.toLowerCase(), issuer: "untrusted", subject: kind.toLowerCase() };
  return {
    actor,
    scope: { kind: "PROJECT", workspaceId: "workspace-alpha", projectId: "project-alpha" },
    correlationId: `correlation-${kind}`,
    causationId: `causation-${kind}`,
  } as unknown as WorkspaceContext;
}

async function fixture() {
  const qa =
    (await import("../../../packages/competency-qa/src/node.ts")) as QaAuthorizationExports;
  expect(qa.qaPermissionCatalog, "T021 must export the exact QA permission catalog").toEqual(
    permissionCatalog,
  );
  expect(qa.QaHumanActorPolicy, "T022/T027 must export QaHumanActorPolicy").toBeTypeOf("function");
  const authorizeHuman = vi.fn(
    async (context: WorkspaceContext, permission: string): Promise<LiveQaHumanAuthorization> => {
      if (context.actor.kind !== "HUMAN") return { allowed: false };
      const roleKey = context.actor.principalId;
      const permissions = rolePermissions[roleKey as keyof typeof rolePermissions];
      return permissions?.has(permission)
        ? { allowed: true, roleKey: `QA_${roleKey.toUpperCase()}`, authorizationBasis: basis }
        : { allowed: false };
    },
  );
  return {
    policy: new qa.QaHumanActorPolicy!({ authorizeHuman }),
    authorizeHuman,
  };
}

describe("QA permission and verified HUMAN authorization matrix", () => {
  it.each([
    ["requester", "qa.request.create"],
    ["requester", "qa.request.input.revise"],
    ["executor", "qa.session.execute"],
    ["executor", "qa.defect.publish"],
    ["executor", "qa.verdict.sign"],
    ["lead", "qa.waiver.approve"],
    ["lead", "qa.verdict.cosign"],
    ["lead", "qa.completion.approve"],
  ] as const)("allows live %s permission %s", async (principal, permission) => {
    const { policy } = await fixture();
    await expect(policy.attest({ context: humanContext(principal), permission })).resolves.toEqual({
      actorId: principal,
      permission,
      roleKey: `QA_${principal.toUpperCase()}`,
      authorizationBasis: basis,
    });
  });

  it.each([
    ["requester", "qa.session.execute"],
    ["requester", "qa.completion.approve"],
    ["executor", "qa.waiver.approve"],
    ["executor", "qa.verdict.cosign"],
    ["lead", "qa.completion.request"],
    ["lead", "qa.request.create"],
  ] as const)("denies %s without live permission %s", async (principal, permission) => {
    const { policy } = await fixture();
    await expect(policy.attest({ context: humanContext(principal), permission })).rejects.toThrow(
      "QA_PERMISSION_DENIED",
    );
  });

  it.each(["SERVICE", "AGENT", "EXTERNAL"] as const)(
    "rejects %s before live authorization",
    async (kind) => {
      const { policy, authorizeHuman } = await fixture();
      await expect(
        policy.attest({
          context: nonHumanContext(kind),
          permission: "qa.session.execute",
          claimedRole: "QA_EXECUTOR",
        }),
      ).rejects.toThrow("QA_VERIFIED_HUMAN_REQUIRED");
      expect(authorizeHuman).not.toHaveBeenCalled();
    },
  );

  it("ignores forged body roles and rejects undeclared permissions", async () => {
    const { policy } = await fixture();
    await expect(
      policy.attest({
        context: humanContext("requester"),
        permission: "qa.completion.approve",
        claimedRole: "QA_LEAD",
      }),
    ).rejects.toThrow("QA_PERMISSION_DENIED");
    await expect(
      policy.attest({
        context: humanContext("lead"),
        permission: "qa.unknown.admin",
        claimedRole: "QA_LEAD",
      }),
    ).rejects.toThrow("QA_PERMISSION_NOT_DECLARED");
  });
});
