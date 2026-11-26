import { readFileSync } from "node:fs";

import type { TelemetryTransport } from "@awp/platform-runtime-nest";

import type { PinnedNetworkTransport } from "./network-policy.ts";

/** Only the approved mTLS client files are read. No credential is returned as an HTTP header. */
export function createCorporateTelemetryTransport(
  network: PinnedNetworkTransport,
  env: NodeJS.ProcessEnv = process.env,
): TelemetryTransport {
  const certificatePath = env.AWP_TELEMETRY_CLIENT_CERT_PATH;
  const keyPath = env.AWP_TELEMETRY_CLIENT_KEY_PATH;
  if (
    !certificatePath?.startsWith("/") ||
    !keyPath?.startsWith("/") ||
    network.policy.mode !== "CORPORATE"
  )
    throw new Error("CORPORATE_TELEMETRY_CREDENTIAL_REQUIRED");
  try {
    const cert = readFileSync(certificatePath);
    const key = readFileSync(keyPath);
    if (!cert.length || cert.length > 65_536 || !key.length || key.length > 65_536)
      throw new Error();
    return {
      agentOptions: { cert, key },
      headers: async () => ({}),
      authorizeExport: async (url, signal) => await network.authorizeEndpoint(url, "POST", signal),
    };
  } catch {
    throw new Error("CORPORATE_TELEMETRY_CREDENTIAL_INVALID");
  }
}
