import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

import {
  assertFeature004LiveNonProd,
  isProductionTarget,
  validateFeature004MattermostMetadata,
} from "./feature-004-nonprod-metadata-lib.mts";
import { stringifyPortableJson } from "./portable-json.mts";

const workspace = resolve(import.meta.dirname, "../..");
const reportPath = resolve(workspace, "reports/004-mattermost-hermes-intake/nonprod-metadata.json");
const args = process.argv.slice(2).filter((value) => value !== "--");
const metadataIndex = args.indexOf("--metadata");
const metadataArgument =
  metadataIndex >= 0
    ? args[metadataIndex + 1]
    : process.env.AWP_MATTERMOST_NONPROD_METADATA_PACKAGE?.trim();
const unexpected = args.filter(
  (value, index) => value !== "--metadata" && index !== metadataIndex + 1,
);
if (metadataIndex >= 0 && !metadataArgument) throw new Error("--metadata requires a path");
if (unexpected.length > 0)
  throw new Error(`Unknown nonprod metadata arguments: ${unexpected.join(" ")}`);

type Status = "PASS" | "FAIL" | "SKIPPED_GATED";
const startedAt = new Date();
let status: Status = "SKIPPED_GATED";
let reasonCode = "METADATA_NOT_SUPPLIED";
let metadata: Readonly<Record<string, unknown>> | undefined;

try {
  if (metadataArgument) {
    const path = isAbsolute(metadataArgument)
      ? resolve(metadataArgument)
      : resolve(workspace, metadataArgument);
    if (path !== workspace && !path.startsWith(`${workspace}/`))
      throw new Error("METADATA_PATH_OUTSIDE_WORKSPACE");
    if (!existsSync(path)) throw new Error("METADATA_FILE_MISSING");
    const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (isProductionTarget(raw)) throw new Error("PRODUCTION_TARGET_DENIED");
    const validated = validateFeature004MattermostMetadata(raw, workspace);
    const endpoint = assertFeature004LiveNonProd(validated);
    status = "PASS";
    reasonCode = "METADATA_ACCEPTED";
    metadata = {
      contourKeyHash: createHash("sha256").update(validated.contourKey).digest("hex"),
      environmentClass: validated.environmentClass,
      workspaceIdHash: createHash("sha256").update(validated.workspaceId).digest("hex"),
      projectIdHash: createHash("sha256").update(validated.projectId).digest("hex"),
      server: {
        scheme: endpoint.protocol,
        hostHash: createHash("sha256").update(endpoint.hostname).digest("hex"),
        buildVersion: validated.server.buildVersion,
        apiFamily: validated.server.apiFamily,
      },
      callbackAuthentication: validated.callbackAuthentication,
      connectionScope: "ONE_PROJECT",
      credentialRefs: validated.projectCredentialSecretRefs.length,
      channelBindings: validated.channelIds.length,
      reconciliation: {
        pendingPostIdLookupSupported: validated.validatedServerLimits.pendingPostIdLookupSupported,
        effectMarkerLookupSupported: validated.validatedServerLimits.effectMarkerLookupSupported,
      },
      retention: validated.presentationTokenRetention ?? "NOT_APPLICABLE",
      productionDenied: true,
    };
  }
} catch (error) {
  status = "FAIL";
  reasonCode = error instanceof Error ? error.message.split(":", 1)[0]! : "METADATA_INVALID";
}

const report = {
  schemaVersion: 1,
  feature: "004-mattermost-hermes-intake",
  gate: "nonprod-metadata",
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  status,
  reasonCode,
  production: "DENIED",
  ...(metadata ? { metadata } : {}),
};
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, stringifyPortableJson(report, workspace), "utf8");
console.log(`[nonprod-metadata:004] ${status}; reason=${reasonCode}; report: ${reportPath}`);
if (status === "FAIL") process.exitCode = 1;
