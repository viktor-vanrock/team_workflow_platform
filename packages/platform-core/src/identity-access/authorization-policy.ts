import type {
  AuthorizationBasisRef,
  ResourceScope,
  VersionedReference,
  WorkspaceContext,
} from "../shared/primitives.ts";
import {
  type ClassificationCatalog,
  defaultClassificationCatalog,
} from "./classification-policy.ts";
import type { AuthorizationFacts, RoleAssignment } from "./model.ts";

export type AuthorizationReason =
  | "ALLOW"
  | "NO_MEMBERSHIP"
  | "NO_ENTITLEMENT"
  | "EXPLICIT_DENY"
  | "NO_ROLE_PERMISSION"
  | "CLASSIFICATION_EXCEEDED"
  | "PROJECT_SUSPENDED"
  | "INVALID_SCOPE";
export interface AuthorizationDecision {
  readonly allowed: boolean;
  readonly reason: AuthorizationReason;
  readonly publicReason?: "ALLOW" | "RESOURCE_NOT_AVAILABLE";
  readonly basis?: AuthorizationBasisRef;
}

const active = (
  value: { readonly validFrom: Date; readonly validUntil?: Date; readonly revokedAt?: Date },
  at: Date,
): boolean =>
  value.validFrom <= at &&
  (value.validUntil === undefined || value.validUntil > at) &&
  value.revokedAt === undefined;
const hasPermission = (permissions: ReadonlySet<string>, permission: string): boolean =>
  permissions.has(permission) || permissions.has("*");
const refs = (
  values: readonly { readonly ref: VersionedReference }[],
): readonly VersionedReference[] =>
  values.map(({ ref }) => ref).sort((a, b) => a.id.localeCompare(b.id) || a.version - b.version);

export interface AuthorizationRequest {
  readonly context: WorkspaceContext;
  readonly permission: string;
  readonly resourceClassification: Readonly<{ key: string; rank: number }>;
  readonly facts: AuthorizationFacts;
  readonly policyVersion?: string;
  readonly currentEntitlementRefs?: readonly VersionedReference[];
  readonly projectOperationalState?: "ACTIVE" | "SUSPENDED";
  readonly operationClass?: "READ" | "MUTATE" | "EFFECT";
  readonly at: Date;
}

const denied = (reason: Exclude<AuthorizationReason, "ALLOW">): AuthorizationDecision =>
  Object.freeze({ allowed: false, reason, publicReason: "RESOURCE_NOT_AVAILABLE" });

// These internal commands recover a project or inspect/export its existing evidence.
// Domain services still enforce exact incident/approval/version and step-up requirements.
// This does not authorize external effects, general QA writes, or capability activation.
const suspendedMaintenancePermissions = new Set([
  "project.metadata.update",
  "project.suspend",
  "project.resume",
  "qa.evidence.verify",
  "qa.evidence.export",
]);

export class DenyByDefaultAuthorizationPolicy {
  constructor(readonly classifications: ClassificationCatalog = defaultClassificationCatalog) {}

  decide(request: AuthorizationRequest): AuthorizationDecision {
    const { context, facts, at } = request;
    const membership = facts.membership;
    if (
      membership === undefined ||
      membership.workspaceId !== context.scope.workspaceId ||
      membership.principalId !== context.actor.principalId ||
      membership.state !== "ACTIVE" ||
      !active(membership, at)
    ) {
      return denied("NO_MEMBERSHIP");
    }
    if (context.scope.kind === "WORKSPACE") {
      const roles = this.#matchingRoles(
        facts.roleAssignments,
        context.scope,
        context.actor.principalId,
        request.permission,
        at,
      );
      if (roles.denied) return denied("EXPLICIT_DENY");
      if (roles.allowed.length === 0) return denied("NO_ROLE_PERMISSION");
      return {
        allowed: true,
        reason: "ALLOW",
        publicReason: "ALLOW",
        basis: this.#basis(
          "WORKSPACE",
          membership.ref,
          [],
          refs(roles.allowed),
          request.policyVersion,
        ),
      };
    }
    const projectScope = context.scope;
    const currentRefs =
      request.currentEntitlementRefs === undefined
        ? undefined
        : new Set(request.currentEntitlementRefs.map(({ id, version }) => `${id}:${version}`));
    const matching = facts.entitlements.filter(
      (entitlement) =>
        entitlement.workspaceId === projectScope.workspaceId &&
        entitlement.projectId === projectScope.projectId &&
        entitlement.principalId === context.actor.principalId &&
        active(entitlement, at) &&
        (currentRefs === undefined ||
          currentRefs.has(`${entitlement.ref.id}:${entitlement.ref.version}`)),
    );
    if (
      matching.some(
        (entitlement) =>
          entitlement.effect === "DENY" &&
          hasPermission(entitlement.permissions, request.permission),
      )
    )
      return denied("EXPLICIT_DENY");
    const roles = this.#matchingRoles(
      facts.roleAssignments,
      context.scope,
      context.actor.principalId,
      request.permission,
      at,
    );
    if (roles.denied) return denied("EXPLICIT_DENY");
    const grants = matching.filter(
      (entitlement) =>
        entitlement.effect === "ALLOW" &&
        hasPermission(entitlement.permissions, request.permission),
    );
    if (grants.length === 0) return denied("NO_ENTITLEMENT");
    if (roles.allowed.length === 0) return denied("NO_ROLE_PERMISSION");
    if (
      !grants.some((grant) =>
        this.classifications.permits(grant.classificationCeiling, request.resourceClassification),
      )
    )
      return denied("CLASSIFICATION_EXCEEDED");
    if (
      request.projectOperationalState === "SUSPENDED" &&
      request.operationClass !== undefined &&
      request.operationClass !== "READ" &&
      !(
        context.actor.kind === "HUMAN" &&
        request.operationClass === "MUTATE" &&
        suspendedMaintenancePermissions.has(request.permission)
      )
    )
      return denied("PROJECT_SUSPENDED");
    return {
      allowed: true,
      reason: "ALLOW",
      publicReason: "ALLOW",
      basis: this.#basis(
        "PROJECT",
        membership.ref,
        refs(grants),
        refs(roles.allowed),
        request.policyVersion,
      ),
    };
  }

  #matchingRoles(
    values: readonly RoleAssignment[],
    scope: ResourceScope,
    principalId: string,
    permission: string,
    at: Date,
  ): { denied: boolean; allowed: readonly RoleAssignment[] } {
    const scoped = values.filter(
      (role) =>
        role.workspaceId === scope.workspaceId &&
        role.principalId === principalId &&
        active(role, at) &&
        (role.projectId === undefined ||
          (scope.kind === "PROJECT" && role.projectId === scope.projectId)) &&
        hasPermission(role.permissions, permission),
    );
    return {
      denied: scoped.some((role) => role.effect === "DENY"),
      allowed: scoped.filter((role) => role.effect === "ALLOW"),
    };
  }

  #basis(
    kind: "PROJECT" | "WORKSPACE",
    membershipRef: VersionedReference,
    entitlementRefs: readonly VersionedReference[],
    roleAssignmentRefs: readonly VersionedReference[],
    policyVersion = "identity-access@1",
  ): AuthorizationBasisRef {
    return Object.freeze({
      kind,
      membershipRef,
      entitlementRefs,
      roleAssignmentRefs,
      policyVersion,
      skillContext: "NOT_APPLICABLE",
    });
  }
}

export function validateAuthorizationBasis(
  scope: ResourceScope,
  basis: AuthorizationBasisRef,
): void {
  if (scope.kind !== basis.kind)
    throw new Error(`Authorization basis ${basis.kind} is invalid for ${scope.kind} scope`);
  if (basis.kind === "PROJECT" && basis.entitlementRefs.length === 0)
    throw new Error("Project authorization basis requires an exact Project Entitlement reference");
  if (basis.kind === "WORKSPACE" && basis.entitlementRefs.length !== 0)
    throw new Error(
      "Workspace authorization basis must not fabricate Project Entitlement references",
    );
  if (basis.roleAssignmentRefs.length === 0)
    throw new Error("Authorization basis requires at least one role assignment reference");
}
