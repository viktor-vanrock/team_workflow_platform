import {
  type ArtifactAuthorizationContribution,
  ArtifactAuthorizationContributionRegistry,
} from "@awp/platform-core";
import {
  type AuthorizationContribution,
  AuthorizationContributionRegistry,
} from "@awp/platform-runtime-nest";

export interface GenericPolicyContributions {
  readonly authorization?: readonly AuthorizationContribution[];
  readonly artifactAuthorization?: readonly ArtifactAuthorizationContribution[];
}

export function composeGenericContributions(contributions: GenericPolicyContributions = {}) {
  return Object.freeze({
    authorizationContributions: new AuthorizationContributionRegistry(
      contributions.authorization ?? [],
    ),
    artifactAuthorizationContributions: new ArtifactAuthorizationContributionRegistry(
      contributions.artifactAuthorization ?? [],
    ),
  });
}
