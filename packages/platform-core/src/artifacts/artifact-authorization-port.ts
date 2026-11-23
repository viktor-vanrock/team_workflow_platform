import type { AuthorizationDecision } from "../identity-access/authorization-policy.ts";
import type { WorkspaceContext } from "../shared/primitives.ts";
import type { ArtifactMetadata } from "./artifact-service.ts";

export type ArtifactAuthorizationOperation = "READ_METADATA" | "STREAM_CONTENT";

export interface ArtifactAuthorizationRequest {
  readonly context: WorkspaceContext;
  readonly permission: "artifact.read";
  readonly operation: ArtifactAuthorizationOperation;
  readonly artifact: ArtifactMetadata;
}

export interface ArtifactAuthorizationContribution {
  readonly componentRef: string;
  matches(request: ArtifactAuthorizationRequest): boolean;
  authorize(request: ArtifactAuthorizationRequest): Promise<AuthorizationDecision>;
}

/**
 * Applies Pack-owned artifact restrictions after the platform's scope and
 * classification checks. Contributions are additive: none can grant access
 * that the platform denied, and every matching contribution must allow it.
 */
export class ArtifactAuthorizationContributionRegistry {
  readonly #contributions: readonly ArtifactAuthorizationContribution[];

  constructor(contributions: readonly ArtifactAuthorizationContribution[] = []) {
    const ordered = [...contributions].sort((left, right) =>
      left.componentRef.localeCompare(right.componentRef),
    );
    for (let index = 1; index < ordered.length; index += 1) {
      if (ordered[index - 1]?.componentRef === ordered[index]?.componentRef) {
        throw new Error(
          `ARTIFACT_AUTHORIZATION_CONTRIBUTION_COLLISION:${ordered[index]?.componentRef}`,
        );
      }
    }
    this.#contributions = Object.freeze(ordered);
  }

  async authorize(request: ArtifactAuthorizationRequest): Promise<AuthorizationDecision> {
    for (const contribution of this.#contributions) {
      if (!contribution.matches(request)) continue;
      const decision = await contribution.authorize(request);
      if (!decision.allowed) return decision;
    }
    return Object.freeze({ allowed: true, reason: "ALLOW" });
  }
}
