import {
  type AuthorizationDecision,
  type ClassificationReference,
  defaultClassificationCatalog,
  onboardingOperationCatalog,
  queueOperationCatalog,
  type WorkspaceContext,
} from "@awp/platform-core";

import { pilotAuthorizationContribution } from "./pilot-authorization.ts";

export interface AuthorizationContributionRequest {
  readonly context: WorkspaceContext;
  readonly permission: string;
  readonly resourceClassification: ClassificationReference;
  readonly operation: string;
}

export interface AuthorizationContribution {
  readonly componentRef: string;
  matches(request: AuthorizationContributionRequest): boolean;
  authorize(request: AuthorizationContributionRequest): Promise<AuthorizationDecision>;
}

export interface ClassificationResolutionRequest {
  readonly permission: string;
  readonly operation: string;
  readonly declaredKey?: string;
  readonly resource?: unknown;
}

export interface ClassificationResolverContribution {
  readonly componentRef: string;
  matches(request: ClassificationResolutionRequest): boolean;
  resolve(
    request: ClassificationResolutionRequest,
  ): Promise<ClassificationReference | undefined> | ClassificationReference | undefined;
}

const recognizedPermissionRoots = new Set([
  "approval",
  "artifact",
  "audit",
  "command",
  "extension-registry",
  "intake",
  "integration",
  "project",
  "sample",
  "webhook",
  "work-item",
  "work-type",
  "qa",
  "queue",
  "notification",
  "agent-run",
  "pilot",
]);

export interface QueueAuthorizationContribution {
  readonly operation: string;
  readonly permission: string;
  readonly trustedContext: readonly string[];
  readonly requiresAuthorization: true;
  readonly capabilityGrantsPermission: false;
  readonly availabilityGrantsPermission: false;
}

export const queueAuthorizationContributions: readonly QueueAuthorizationContribution[] =
  Object.freeze(
    queueOperationCatalog.map(({ operation, permission, trustedContext }) =>
      Object.freeze({
        operation,
        permission,
        trustedContext,
        requiresAuthorization: true as const,
        capabilityGrantsPermission: false as const,
        availabilityGrantsPermission: false as const,
      }),
    ),
  );

export const onboardingAuthorizationContributions: readonly QueueAuthorizationContribution[] =
  Object.freeze(
    onboardingOperationCatalog.map(({ operation, permission }) =>
      Object.freeze({
        operation,
        permission,
        trustedContext: Object.freeze([
          "workspace-membership",
          "project-entitlement",
          "role-permission",
          "data-classification",
        ]),
        requiresAuthorization: true as const,
        capabilityGrantsPermission: false as const,
        availabilityGrantsPermission: false as const,
      }),
    ),
  );

export class ResourceClassificationResolver {
  readonly #contributions: readonly ClassificationResolverContribution[];
  constructor(contributions: readonly ClassificationResolverContribution[] = []) {
    this.#contributions = Object.freeze(
      [...contributions].sort((left, right) => left.componentRef.localeCompare(right.componentRef)),
    );
  }
  async resolve(request: ClassificationResolutionRequest): Promise<ClassificationReference> {
    if (request.declaredKey) return this.#reference(request.declaredKey);
    for (const contribution of this.#contributions) {
      if (!contribution.matches(request)) continue;
      const resolved = await contribution.resolve(request);
      if (resolved) {
        const canonical = this.#reference(resolved.key);
        if (canonical.rank !== resolved.rank)
          throw new Error("RESOURCE_CLASSIFICATION_RANK_MISMATCH");
        return canonical;
      }
    }
    const root = request.permission.split(".")[0] ?? "";
    if (!recognizedPermissionRoots.has(root))
      throw new Error(`RESOURCE_CLASSIFICATION_UNRESOLVED:${request.permission}`);
    if (request.permission === "audit.workspace-security.read")
      return this.#reference("RESTRICTED");
    if (
      root === "pilot" ||
      root === "artifact" ||
      request.permission.includes("evidence") ||
      request.permission.includes("model")
    )
      return this.#reference("CONFIDENTIAL");
    return this.#reference("INTERNAL");
  }
  #reference(key: string): ClassificationReference {
    try {
      return defaultClassificationCatalog.reference(key);
    } catch {
      throw new Error(`RESOURCE_CLASSIFICATION_UNKNOWN:${key}`);
    }
  }
}

/**
 * Applies generic contextual policies after the platform authorization policy.
 * Matching contributions are deny-capable only: every one must allow access.
 */
export class AuthorizationContributionRegistry {
  readonly #contributions: readonly AuthorizationContribution[];

  constructor(contributions: readonly AuthorizationContribution[] = []) {
    const ordered = [pilotAuthorizationContribution, ...contributions].sort((left, right) =>
      left.componentRef.localeCompare(right.componentRef),
    );
    for (let index = 1; index < ordered.length; index += 1) {
      if (ordered[index - 1]?.componentRef === ordered[index]?.componentRef) {
        throw new Error(`AUTHORIZATION_CONTRIBUTION_COLLISION:${ordered[index]?.componentRef}`);
      }
    }
    this.#contributions = Object.freeze(ordered);
  }

  async authorize(request: AuthorizationContributionRequest): Promise<AuthorizationDecision> {
    for (const contribution of this.#contributions) {
      if (!contribution.matches(request)) continue;
      const decision = await contribution.authorize(request);
      if (!decision.allowed) return decision;
    }
    return Object.freeze({ allowed: true, reason: "ALLOW" });
  }
}
