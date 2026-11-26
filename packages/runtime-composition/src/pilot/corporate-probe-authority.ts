import type { RuntimeEnvironment } from "../config/environment.ts";
import type { RequestedProbeTarget } from "../onboarding/requested-probe-worker.ts";
import type { CorporateConnectorGrant } from "./connector-authority.ts";
import type { CorporateConnectorRequestAuthority } from "./connector-factories.ts";

/** Resolve the probe to one exact published provider chain and live service permissions. */
export function createCorporateProbeAuthorization(
  input: Readonly<{
    environment: RuntimeEnvironment;
    grants: readonly CorporateConnectorGrant[];
    authority: CorporateConnectorRequestAuthority;
  }>,
) {
  const deployment = input.environment.deployment;
  if (
    input.environment.profile !== "non-local" ||
    input.environment.environmentScope !== "NON_PROD" ||
    !deployment ||
    typeof input.authority?.authorize !== "function"
  )
    throw new Error("CORPORATE_PROBE_AUTHORITY_REQUIRED");
  const same = (
    a: Readonly<{ id: string; version: number; contentHash: string }>,
    b: Readonly<{ id: string; version: number; contentHash: string }>,
  ) => a.id === b.id && a.version === b.version && a.contentHash === b.contentHash;
  return async (target: RequestedProbeTarget, signal: AbortSignal): Promise<boolean> => {
    if (
      signal.aborted ||
      target.workspaceId !== deployment.workspaceId ||
      !deployment.projectIds.includes(target.projectId) ||
      target.environmentScope !== "NON_PROD"
    )
      return false;
    const matches = input.grants.filter(
      ({ binding, integrationBindingRef }) =>
        binding.workspaceId === target.workspaceId &&
        binding.projectId === target.projectId &&
        same(integrationBindingRef, target.bindingRef) &&
        same(binding.profileRef, target.profileRef) &&
        same(binding.connectionRef, target.connectionRef),
    );
    if (matches.length !== 1) return false;
    return (
      (await input.authority.authorize(matches[0]!.binding, "CONNECTOR_READ", signal)) &&
      !signal.aborted
    );
  };
}
