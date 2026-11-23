import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";

import { loadWorkspaceInstallationConfig } from "../../packages/runtime-composition/src/bootstrap/workspace-installation.ts";
import { PinnedNetworkTransport } from "../../packages/runtime-composition/src/pilot/network-policy.ts";

// Finalize reviewed, non-secret configuration; never generate or print credentials.
try {
  const path = process.argv[2];
  if (!path) throw new Error();
  const value = loadWorkspaceInstallationConfig({ AWP_WORKSPACE_CONFIG_PATH: path });
  if (/REPLACE_WITH|example\.org/u.test(JSON.stringify(value))) throw new Error();
  const { policyRef, ...session } = value.session;
  const { ref, ...network } = value.network;
  const hash = (body: unknown) =>
    `sha256:${createHash("sha256").update(JSON.stringify(body)).digest("hex")}` as const;
  const config = {
    ...value,
    session: {
      ...session,
      policyRef: { ...policyRef, contentHash: hash({ tokens: value.tokens, session }) },
    },
    network: { ...network, ref: { ...ref, contentHash: hash(network) } },
  };
  new PinnedNetworkTransport(config.network);
  // This file contains endpoints and policy metadata only. Preserve its existing permissions.
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
  console.log("WORKSPACE_CONFIGURATION_FINALIZED");
} catch {
  console.error(
    "WORKSPACE_CONFIGURATION_INVALID: provide a reviewed config path; replace placeholders, HTTPS origins, MFA claims, CIDRs and policy expiry",
  );
  process.exitCode = 1;
}
