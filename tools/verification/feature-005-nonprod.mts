import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  assertFeature005LiveNonProd,
  readFeature005Metadata,
} from "./feature-005-nonprod-metadata-lib.mts";
import { stringifyPortableJson } from "./portable-json.mts";

const workspace = resolve(import.meta.dirname, "../..");
const reportPath = resolve(workspace, "reports/005-gitlab-automated-validation/nonprod.json");
const metadataReportPath = resolve(
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
  throw new Error(`Unknown verify:005:nonprod arguments: ${unexpected.join(", ")}`);

type Status = "PASS" | "FAIL" | "SKIPPED_GATED";
const startedAt = new Date();
function finish(status: Status, body: Readonly<Record<string, unknown>>): never {
  const report = Object.freeze({
    schemaVersion: 1,
    feature: "005-gitlab-automated-validation",
    gate: "nonprod-conformance",
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    status,
    production: "DENIED",
    mutationRequests: 0,
    ...body,
  });
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, stringifyPortableJson(report, workspace), "utf8");
  console.log(`[nonprod:005] ${status}; report: ${reportPath}`);
  process.exit(status === "FAIL" ? 1 : 0);
}

const preflight = spawnSync(
  process.execPath,
  [
    "tools/verification/feature-005-nonprod-metadata.mts",
    ...(metadataArgument ? ["--metadata", metadataArgument] : []),
  ],
  { cwd: workspace, env: { ...process.env, CI: "true" }, stdio: "inherit" },
);
if ((preflight.status ?? 1) !== 0 || !existsSync(metadataReportPath))
  finish("FAIL", { reasonCode: "METADATA_PREFLIGHT_FAILED", liveGitLab: "NOT_RUN" });
const metadataReport = JSON.parse(readFileSync(metadataReportPath, "utf8")) as Readonly<
  Record<string, unknown>
>;
if (metadataReport.status === "SKIPPED_GATED")
  finish("SKIPPED_GATED", {
    reasonCode: metadataReport.reasonCode ?? "METADATA_NOT_SUPPLIED",
    liveGitLab: "SKIPPED_GATED",
  });
if (metadataReport.status !== "PASS" || !metadataArgument)
  finish("FAIL", { reasonCode: "METADATA_PREFLIGHT_FAILED", liveGitLab: "NOT_RUN" });

const requiredControls = Object.freeze([
  "AWP_LIVE_GITLAB_OPT_IN=true",
  "AWP_LIVE_TARGET_ATTESTATION=NON_PRODUCTION",
  "AWP_LIVE_GITLAB_ALLOWED_HOST",
  "AWP_LIVE_GITLAB_AUTHORIZATION",
]);
const optedIn = process.env.AWP_LIVE_GITLAB_OPT_IN === "true";
const attested = process.env.AWP_LIVE_TARGET_ATTESTATION === "NON_PRODUCTION";
const allowedHost = process.env.AWP_LIVE_GITLAB_ALLOWED_HOST?.trim();
const authorization = process.env.AWP_LIVE_GITLAB_AUTHORIZATION?.trim();
if (!optedIn || !attested || !allowedHost || !authorization)
  finish("SKIPPED_GATED", {
    reasonCode: "LIVE_GITLAB_CONTROLS_INCOMPLETE",
    requiredControls,
    liveGitLab: "SKIPPED_GATED",
  });

const loaded = readFeature005Metadata(metadataArgument, workspace);
const endpoint = assertFeature005LiveNonProd(loaded.metadata);
if (endpoint.hostname !== allowedHost)
  finish("FAIL", { reasonCode: "LIVE_HOST_NOT_ALLOWLISTED", liveGitLab: "FAIL" });
const timeoutMs = Number(
  (loaded.metadata.reconciliationContract as Readonly<Record<string, unknown>>).requestTimeoutMs ??
    10_000,
);
const reads = Object.freeze([
  Object.freeze({ id: "version", url: new URL("/api/v4/version", endpoint) }),
  Object.freeze({
    id: "project",
    url: new URL(`/api/v4/projects/${loaded.metadata.numericGitLabProjectId}`, endpoint),
  }),
]);
const results: Array<Readonly<Record<string, unknown>>> = [];
for (const read of reads) {
  try {
    const response = await fetch(read.url, {
      method: "GET",
      headers: { accept: "application/json", authorization },
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const bytes = new Uint8Array(await response.arrayBuffer());
    results.push(
      Object.freeze({
        id: read.id,
        status: response.ok ? "PASS" : "FAIL",
        httpStatus: response.status,
        responseHash: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
      }),
    );
  } catch (error) {
    results.push(
      Object.freeze({
        id: read.id,
        status: "FAIL",
        reasonCode: error instanceof Error ? error.name : "FETCH_FAILED",
      }),
    );
  }
}
if (results.some(({ status }) => status !== "PASS"))
  finish("FAIL", {
    reasonCode: "LIVE_GITLAB_READ_FAILED",
    liveGitLab: "FAIL",
    readRequests: results.length,
    results,
  });
finish("PASS", {
  reasonCode: "LIVE_NONPROD_ACCEPTED",
  liveGitLab: "PASS",
  endpointHostHash: createHash("sha256").update(endpoint.hostname).digest("hex"),
  metadataContentHash: loaded.metadata.contentHash,
  readRequests: results.length,
  results,
});
