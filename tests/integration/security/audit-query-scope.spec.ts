import { describe, expect, it } from "vitest";

import type {
  AppendOnlyAuditPort,
  AuditEvent,
  ResourceScope,
  WorkspaceContext,
} from "../../../packages/platform-core/src/index.ts";
import { ScopedAuditQueryApplication } from "../../../packages/platform-runtime-nest/src/http/audit.controller.ts";

const projectScope = {
  kind: "PROJECT",
  workspaceId: "workspace-a",
  projectId: "project-alpha",
} as const;
const workspaceScope = { kind: "WORKSPACE", workspaceId: "workspace-a" } as const;
const projectContext: WorkspaceContext = {
  actor: { kind: "HUMAN", principalId: "auditor", issuer: "issuer", subject: "auditor" },
  scope: projectScope,
  correlationId: "correlation",
  causationId: "causation",
};
const workspaceContext: WorkspaceContext = { ...projectContext, scope: workspaceScope };
const baseEvent = {
  id: "event",
  occurredAt: new Date("2026-08-30T00:00:00.000Z"),
  action: "SECURITY_ENVELOPE_REJECTED",
  outcome: "DENIED",
  reasonCode: "SIGNATURE_INVALID",
  correlationId: "correlation",
  causationId: "causation",
  classification: { key: "INTERNAL", rank: 10 },
  versionRefs: [],
  attributes: {},
} as const;

class RecordingAuditPort implements AppendOnlyAuditPort {
  readonly scopes: ResourceScope[] = [];
  constructor(private readonly events: readonly AuditEvent[]) {}
  async append(): Promise<void> {
    throw new Error("NOT_USED");
  }
  async query(scope: ResourceScope): Promise<readonly AuditEvent[]> {
    this.scopes.push(scope);
    return this.events;
  }
}

describe("audit query scope separation", () => {
  it("returns operational events only through their exact Project scope", async () => {
    const event: AuditEvent = {
      ...baseEvent,
      scope: projectScope,
      actor: projectContext.actor,
      authorizationBasis: {
        kind: "PROJECT",
        policyVersion: "identity-access@1",
        membershipRef: { id: "membership", version: 1 },
        entitlementRefs: [{ id: "entitlement", version: 1 }],
        roleAssignmentRefs: [{ id: "role", version: 1 }],
        skillContext: "NOT_APPLICABLE",
      },
    };
    const port = new RecordingAuditPort([event]);
    await expect(
      new ScopedAuditQueryApplication(port).project(projectContext, {}),
    ).resolves.toEqual([event]);
    expect(port.scopes).toEqual([projectScope]);
  });

  it("allows pre-Project SYSTEM security events without fabricated human basis", async () => {
    const event: AuditEvent = {
      ...baseEvent,
      scope: workspaceScope,
      actor: { kind: "SERVICE", principalId: "webhook", serviceKey: "webhook-ingress" },
    };
    await expect(
      new ScopedAuditQueryApplication(new RecordingAuditPort([event])).workspaceSecurity(
        workspaceContext,
        {},
      ),
    ).resolves.toEqual([event]);
  });

  it("rejects widened scope and fabricated basis on Workspace security events", async () => {
    const wrongScope: AuditEvent = {
      ...baseEvent,
      scope: projectScope,
      actor: { kind: "SERVICE", principalId: "webhook", serviceKey: "webhook-ingress" },
    };
    await expect(
      new ScopedAuditQueryApplication(new RecordingAuditPort([wrongScope])).workspaceSecurity(
        workspaceContext,
        {},
      ),
    ).rejects.toThrow("AUDIT_SCOPE_CORRUPTION");

    const fabricated: AuditEvent = {
      ...baseEvent,
      scope: workspaceScope,
      actor: { kind: "SERVICE", principalId: "webhook", serviceKey: "webhook-ingress" },
      authorizationBasis: {
        kind: "WORKSPACE",
        policyVersion: "identity-access@1",
        membershipRef: { id: "fabricated", version: 1 },
        entitlementRefs: [],
        roleAssignmentRefs: [{ id: "fabricated", version: 1 }],
        skillContext: "NOT_APPLICABLE",
      },
    };
    await expect(
      new ScopedAuditQueryApplication(new RecordingAuditPort([fabricated])).workspaceSecurity(
        workspaceContext,
        {},
      ),
    ).rejects.toThrow("WORKSPACE_SECURITY_AUDIT_BASIS_INVALID");
  });
});
