import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

import {
  assertFeature005LiveNonProd,
  readFeature005Metadata,
} from "./feature-005-nonprod-metadata-lib.mts";
import { stringifyPortableJson } from "./portable-json.mts";

const workspace = resolve(import.meta.dirname, "../..");
const reportPath = resolve(
  workspace,
  "reports/005-gitlab-automated-validation/nonprod-metadata.json",
);
const args = process.argv.slice(2).filter((value) => value !== "--");
const metadataIndex = args.indexOf("--metadata");
const metadataArgument =
  metadataIndex >= 0
    ? args[metadataIndex + 1]
    : process.env.AWP_GITLAB_NONPROD_METADATA_PACKAGE?.trim();
const unexpected = args.filter(
  (value, index) => value !== "--metadata" && index !== metadataIndex + 1,
);
if (metadataIndex >= 0 && !metadataArgument) throw new Error("--metadata requires a path");
if (unexpected.length > 0)
  throw new Error(`Unknown Feature 005 nonprod metadata arguments: ${unexpected.join(", ")}`);

const startedAt = new Date();
let status: "PASS" | "FAIL" | "SKIPPED_GATED" = "SKIPPED_GATED";
let reasonCode = "METADATA_NOT_SUPPLIED";
let sanitizedMetadata: Readonly<Record<string, unknown>> | undefined;
try {
  if (metadataArgument) {
    const loaded = readFeature005Metadata(metadataArgument, workspace);
    const endpoint = assertFeature005LiveNonProd(loaded.metadata);
    status = "PASS";
    reasonCode = "METADATA_ACCEPTED";
    sanitizedMetadata = Object.freeze({
      metadataRef: relative(workspace, loaded.path).replaceAll("\\", "/"),
      metadataFileHash: loaded.fileHash,
      metadataContentHash: loaded.metadata.contentHash,
      deploymentPurpose: loaded.metadata.deploymentPurpose,
      contourKey: loaded.metadata.contourKey,
      environmentClass: loaded.metadata.environmentClass,
      workspaceIdHash: createHash("sha256").update(loaded.metadata.workspaceId).digest("hex"),
      projectIdHash: createHash("sha256").update(loaded.metadata.projectId).digest("hex"),
      numericProjectIdHash: createHash("sha256")
        .update(String(loaded.metadata.numericGitLabProjectId))
        .digest("hex"),
      endpoint: Object.freeze({
        scheme: endpoint.protocol,
        hostHash: createHash("sha256").update(endpoint.hostname).digest("hex"),
        apiFamily: loaded.metadata.server.apiFamily,
        exactVersion: loaded.metadata.server.exactVersion,
        exactBuild: loaded.metadata.server.exactBuild,
      }),
      identities: Object.freeze({
        routingMode: loaded.metadata.identities.credentialRoutingMode,
        separatedSlots: 3,
        secretRefsStored: 0,
      }),
      configurationPins: loaded.metadata.configurationPins.length,
      suiteBindings: loaded.metadata.suiteBindingRefs.length,
      productionDenied: true,
    });
  }
} catch (error) {
  status = "FAIL";
  reasonCode = error instanceof Error ? error.message.split(":", 1)[0]! : "METADATA_INVALID";
}

const report = Object.freeze({
  schemaVersion: 1,
  feature: "005-gitlab-automated-validation",
  gate: "nonprod-metadata",
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  status,
  reasonCode,
  production: "DENIED",
  ...(sanitizedMetadata ? { metadata: sanitizedMetadata } : {}),
});
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, stringifyPortableJson(report, workspace), "utf8");
console.log(`[nonprod-metadata:005] ${status}; reason=${reasonCode}; report: ${reportPath}`);
if (status === "FAIL") process.exitCode = 1;
