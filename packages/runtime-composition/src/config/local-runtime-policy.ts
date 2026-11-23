export {
  assertConnectionEndpointAllowed,
  assertEffectEndpointAllowed,
  assertLocalSecretsAllowed,
  localContainerEgressPolicy,
} from "../security/local-security.ts";

export function assertLocalPhysicalBarrier(
  source: Readonly<Record<string, string | undefined>>,
): void {
  if (source.AWP_RUNTIME_PROFILE !== "local" || source.AWP_EXTERNAL_NETWORK_MODE !== "deny")
    throw new Error("LOCAL_NETWORK_DENY_REQUIRED");
  if (
    source.AWP_MOCK_HUB_URL !== "http://mock-hub:4010" ||
    source.AWP_IDENTITY_ISSUER !== "https://fake-idp:4443/oidc"
  )
    throw new Error("LOCAL_SERVICE_ALLOWLIST_MISMATCH");
}
