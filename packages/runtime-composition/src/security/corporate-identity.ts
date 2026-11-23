import { randomUUID } from "node:crypto";

import {
  assertExactRevisionRef,
  canonicalRoleKey,
  DenyByDefaultAuthorizationPolicy,
  type ExactRevisionRef,
  freezePilotValue,
  type Identity,
  type IdentityRepositoryPort,
  type PlatformAccessContext,
  type PlatformAccessPermission,
  type ResourceScope,
  type ScopedAccessRepositoryPort,
  type WorkspaceContext,
} from "@awp/platform-core";
import type { VerifiedOidcIdentity } from "@awp/platform-runtime-nest";

export interface CorporateAccessProvisioning {
  registerVerified(evidence: VerifiedOidcIdentity): Promise<void>;
  authorize(
    principalId: string,
    permission: PlatformAccessPermission,
  ): Promise<PlatformAccessContext>;
}
export interface CorporateGroupPolicy {
  readonly ref: ExactRevisionRef;
  readonly issuer: string;
  readonly mappings: readonly Readonly<{
    group: string;
    workspaceId: string;
    projectIds: readonly string[];
    projectAccessScope?: "SELECTED_PROJECTS" | "ALL_PROJECTS";
    roleKeys: readonly string[];
  }>[];
}
export interface CorporateIdentityRevocations {
  active(issuer: string, subject: string, issuedAt: number): Promise<boolean>;
}

/** Provisioned users use live application grants. Legacy hosts may still narrow grants by groups. */
export class CorporateIdentityService {
  readonly policy: CorporateGroupPolicy;
  private readonly authorization = new DenyByDefaultAuthorizationPolicy();
  constructor(
    policy: CorporateGroupPolicy,
    private readonly identities: IdentityRepositoryPort,
    private readonly access: ScopedAccessRepositoryPort,
    private readonly revocations: CorporateIdentityRevocations,
    private readonly clock: () => number = Date.now,
    private readonly provisioning?: CorporateAccessProvisioning,
  ) {
    assertExactRevisionRef(policy.ref);
    if (
      !policy.issuer ||
      (!policy.mappings.length && !provisioning) ||
      policy.mappings.length > 256 ||
      policy.mappings.some(
        (mapping) =>
          !mapping.group ||
          !mapping.workspaceId ||
          (mapping.projectAccessScope !== undefined &&
            !["SELECTED_PROJECTS", "ALL_PROJECTS"].includes(mapping.projectAccessScope)) ||
          (mapping.projectAccessScope === "ALL_PROJECTS"
            ? mapping.projectIds.length !== 0
            : !mapping.projectIds.length) ||
          !mapping.roleKeys.length ||
          [...mapping.projectIds, ...mapping.roleKeys].some((key) => !key || key === "*"),
      )
    )
      throw new Error("CORPORATE_IDENTITY_POLICY_INVALID");
    this.policy = freezePilotValue(structuredClone(policy));
  }

  private async admit(evidence: VerifiedOidcIdentity): Promise<void> {
    if (
      evidence.issuer !== this.policy.issuer ||
      !Number.isFinite(evidence.expiresAt) ||
      evidence.expiresAt * 1000 <= this.clock() ||
      !(
        this.provisioning ||
        this.policy.mappings.some((mapping) => evidence.groups.includes(mapping.group))
      ) ||
      !(await this.revocations.active(evidence.issuer, evidence.subject, evidence.issuedAt))
    )
      throw new Error("CORPORATE_IDENTITY_DENIED");
  }
  async completeVerifiedLogin(evidence: VerifiedOidcIdentity): Promise<void> {
    await this.admit(evidence);
    await this.provisioning?.registerVerified(evidence);
  }
  async authorizePlatform(
    evidence: VerifiedOidcIdentity,
    permission: PlatformAccessPermission,
  ): Promise<PlatformAccessContext> {
    const identity = await this.authenticate(evidence);
    if (!this.provisioning) throw new Error("PLATFORM_ACCESS_DENIED");
    const context = await this.provisioning.authorize(identity.id, permission);
    if (
      context.assignmentSource === "LOCAL_BOOTSTRAP" ||
      context.assignmentSource === "LOCAL_FIRST_LOGIN"
    )
      throw new Error("PLATFORM_ACCESS_DENIED");
    await this.authenticate(evidence);
    return context;
  }
  async authenticate(evidence: VerifiedOidcIdentity): Promise<Identity> {
    await this.admit(evidence);
    const identity = await this.identities.findByVerifiedSubject(evidence.issuer, evidence.subject);
    if (
      !identity ||
      identity.kind !== "HUMAN" ||
      identity.issuer !== evidence.issuer ||
      identity.subject !== evidence.subject
    )
      throw new Error("CORPORATE_IDENTITY_DENIED");
    return Object.freeze(identity);
  }

  async authorize(
    evidence: VerifiedOidcIdentity,
    input: Readonly<{
      scope: ResourceScope;
      permission: string;
      operationClass: "READ" | "MUTATE" | "EFFECT";
      correlationId?: string;
      causationId?: string;
    }>,
  ): Promise<WorkspaceContext> {
    const identity = await this.authenticate(evidence);
    const mappings = this.policy.mappings.filter(
      (mapping) =>
        evidence.groups.includes(mapping.group) &&
        mapping.workspaceId === input.scope.workspaceId &&
        (input.scope.kind === "WORKSPACE" ||
          mapping.projectAccessScope === "ALL_PROJECTS" ||
          mapping.projectIds.includes(input.scope.projectId)),
    );
    if (!this.provisioning && !mappings.length) throw new Error("PROJECT_RESOURCE_NOT_AVAILABLE");
    const workspace = await this.access.getWorkspace({
      kind: "WORKSPACE",
      workspaceId: input.scope.workspaceId,
    });
    const project =
      input.scope.kind === "PROJECT" ? await this.access.getProject(input.scope) : undefined;
    if (
      workspace?.state !== "ACTIVE" ||
      workspace.id !== input.scope.workspaceId ||
      (input.scope.kind === "PROJECT" &&
        (!project ||
          project.id !== input.scope.projectId ||
          project.workspaceId !== input.scope.workspaceId ||
          project.state === "ARCHIVED"))
    )
      throw new Error("PROJECT_RESOURCE_NOT_AVAILABLE");
    const at = new Date(this.clock());
    const facts = await this.access.authorizationFacts(input.scope, identity.id, at);
    const roles = new Set(mappings.flatMap((mapping) => mapping.roleKeys.map(canonicalRoleKey)));
    const correlation = (id?: string) =>
      id && /^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,127}$/u.test(id) ? id : randomUUID();
    const context: WorkspaceContext = {
      actor: {
        kind: "HUMAN",
        principalId: identity.id,
        issuer: identity.issuer,
        subject: identity.subject,
      },
      scope: input.scope,
      correlationId: correlation(input.correlationId),
      causationId: correlation(input.causationId),
    };
    const decision = this.authorization.decide({
      context,
      permission: input.permission,
      resourceClassification: project?.classification ?? { key: "INTERNAL", rank: 10 },
      facts: {
        ...facts,
        roleAssignments: facts.roleAssignments.filter(
          (role) =>
            this.provisioning ||
            role.effect === "DENY" ||
            roles.has(canonicalRoleKey(role.roleKey)),
        ),
      },
      policyVersion: `${this.policy.ref.id}:${this.policy.ref.version}:${this.policy.ref.contentHash}`,
      at,
      operationClass: input.operationClass,
      ...(project
        ? { projectOperationalState: project.state === "SUSPENDED" ? "SUSPENDED" : "ACTIVE" }
        : {}),
    });
    if (!decision.allowed || !decision.basis) throw new Error("PROJECT_RESOURCE_NOT_AVAILABLE");
    // Revocation may have arrived while authoritative rows were being read.
    await this.authenticate(evidence);
    return freezePilotValue({ ...context, authorizationBasis: decision.basis });
  }
}
