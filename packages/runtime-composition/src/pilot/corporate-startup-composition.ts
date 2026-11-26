import { randomUUID } from "node:crypto";

import type { RuntimeEnvironment } from "../config/environment.ts";
import { createCorporateVaultConnectorFactories } from "../security/corporate-vault-connectors.ts";
import type { PilotNonLocalCompositionOptions } from "./composition.ts";
import type { PinnedNetworkTransport } from "./network-policy.ts";

/** Build API startup from the same published network and connector configuration. */
export function createCorporateStartupComposition(
  input: Readonly<{
    environment: RuntimeEnvironment;
    network: PinnedNetworkTransport;
    connectors: ReturnType<typeof createCorporateVaultConnectorFactories>;
    imageDigest: string;
    leaseMs?: number;
    validationDeadlineMs?: number;
  }>,
): Omit<PilotNonLocalCompositionOptions, "component"> {
  const deployment = input.environment.deployment;
  if (
    !deployment ||
    input.environment.profile !== "non-local" ||
    input.imageDigest !== deployment.imageDigest ||
    input.connectors.network !== input.network
  )
    throw new Error("CORPORATE_STARTUP_CONFIGURATION_INVALID");
  const requests = deployment.endpoints
    .filter((endpoint) => !["browser", "callback"].includes(endpoint.purpose))
    .map((endpoint) => {
      const url = new URL(endpoint.url);
      const policy = input.network.policy.endpoints.find((entry) => entry.origin === url.origin);
      const matching =
        policy?.routes.filter(
          (route) =>
            (route.match === "EXACT"
              ? route.path === url.pathname
              : url.pathname.startsWith(route.path)) &&
            [...url.searchParams.keys()].every((key) => route.queryKeys.includes(key)),
        ) ?? [];
      const methods = [...new Set(matching.flatMap((route) => route.methods))].sort();
      if (!methods.length) throw new Error("CORPORATE_STARTUP_ENDPOINT_DENIED");
      return { purpose: endpoint.purpose, url: endpoint.url, method: methods[0]! };
    });
  const browser = deployment.endpoints.find((endpoint) => endpoint.purpose === "browser");
  const callback = deployment.endpoints.find((endpoint) => endpoint.purpose === "callback");
  if (!browser || !callback) throw new Error("CORPORATE_STARTUP_CONFIGURATION_INVALID");
  return {
    startup: {
      instanceId: randomUUID(),
      imageDigest: input.imageDigest,
      leaseMs: input.leaseMs ?? 15_000,
      validationDeadlineMs: input.validationDeadlineMs ?? 5000,
      network: input.network,
      requests,
      browser: {
        origin: browser.url,
        callbackUrl: callback.url,
        identityPolicyRef: deployment.identityPolicyRef,
      },
    },
    connectorFactories: {
      network: input.network,
      vault: input.connectors.vault,
      authority: input.connectors.authority,
      secretAuthorization: input.connectors.secretAuthorization,
      bindings: input.connectors.bindings,
    },
  };
}
