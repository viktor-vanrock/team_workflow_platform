import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

import {
  assertFeature004LiveNonProd,
  validateFeature004MattermostMetadata,
} from "./feature-004-nonprod-metadata-lib.mts";
import { stringifyPortableJson } from "./portable-json.mts";

const workspace = resolve(import.meta.dirname, "../..");
const reportPath = resolve(workspace, "reports/004-mattermost-hermes-intake/nonprod.json");
const metadataReportPath = resolve(
  workspace,
  "reports/004-mattermost-hermes-intake/nonprod-metadata.json",
);
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
  throw new Error(`Unknown verify:004:nonprod arguments: ${unexpected.join(" ")}`);

type Status = "PASS" | "FAIL" | "SKIPPED_GATED";
const startedAt = new Date();
function finish(status: Status, body: Readonly<Record<string, unknown>>): never {
  const report = {
    schemaVersion: 1,
    feature: "004-mattermost-hermes-intake",
    gate: "nonprod-conformance",
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    status,
    production: "DENIED",
    ...body,
  };
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, stringifyPortableJson(report, workspace), "utf8");
  console.log(`[nonprod:004] ${status}; report: ${reportPath}`);
  process.exit(status === "FAIL" ? 1 : 0);
}

const preflightArgs = [
  "tools/verification/feature-004-nonprod-metadata.mts",
  ...(metadataArgument ? ["--metadata", metadataArgument] : []),
];
const preflight = spawnSync(process.execPath, preflightArgs, {
  cwd: workspace,
  env: { ...process.env, CI: "true" },
  stdio: "inherit",
});
if ((preflight.status ?? 1) !== 0 || !existsSync(metadataReportPath))
  finish("FAIL", {
    reasonCode: "METADATA_PREFLIGHT_FAILED",
    liveMattermost: "NOT_RUN",
    liveModel: "NOT_RUN",
  });
const metadataReport = JSON.parse(readFileSync(metadataReportPath, "utf8")) as Readonly<
  Record<string, unknown>
>;
if (metadataReport.status === "SKIPPED_GATED")
  finish("SKIPPED_GATED", {
    reasonCode: metadataReport.reasonCode ?? "METADATA_NOT_SUPPLIED",
    liveMattermost: "SKIPPED_GATED",
    liveModel: "SKIPPED_GATED",
  });
if (metadataReport.status !== "PASS" || !metadataArgument)
  finish("FAIL", {
    reasonCode: "METADATA_PREFLIGHT_FAILED",
    liveMattermost: "NOT_RUN",
    liveModel: "NOT_RUN",
  });

const optedIn = process.env.AWP_LIVE_MATTERMOST_OPT_IN === "true";
const attested = process.env.AWP_LIVE_TARGET_ATTESTATION === "NON_PRODUCTION";
const allowedHost = process.env.AWP_LIVE_MATTERMOST_ALLOWED_HOST?.trim();
const authorization = process.env.AWP_LIVE_MATTERMOST_AUTHORIZATION?.trim();
if (!optedIn || !attested || !allowedHost || !authorization)
  finish("SKIPPED_GATED", {
    reasonCode: "LIVE_MATTERMOST_CONTROLS_INCOMPLETE",
    requiredControls: [
      "AWP_LIVE_MATTERMOST_OPT_IN=true",
      "AWP_LIVE_TARGET_ATTESTATION=NON_PRODUCTION",
      "AWP_LIVE_MATTERMOST_ALLOWED_HOST",
      "AWP_LIVE_MATTERMOST_AUTHORIZATION",
    ],
    liveMattermost: "SKIPPED_GATED",
    liveModel: "SKIPPED_GATED",
  });

const metadataPath = isAbsolute(metadataArgument)
  ? resolve(metadataArgument)
  : resolve(workspace, metadataArgument);
const metadata = validateFeature004MattermostMetadata(
  JSON.parse(readFileSync(metadataPath, "utf8")) as unknown,
  workspace,
);
const endpoint = assertFeature004LiveNonProd(metadata);
if (endpoint.hostname !== allowedHost)
  finish("FAIL", {
    reasonCode: "LIVE_HOST_NOT_ALLOWLISTED",
    liveMattermost: "FAIL",
    liveModel: "NOT_RUN",
  });

let mattermostStatus: "PASS" | "FAIL" = "FAIL";
let mattermostDetail: string;
try {
  const response = await fetch(new URL("api/v4/system/ping", endpoint), {
    method: "GET",
    headers: { accept: "application/json", authorization },
    redirect: "error",
    signal: AbortSignal.timeout(metadata.validatedServerLimits.requestTimeoutMs),
  });
  mattermostStatus = response.ok ? "PASS" : "FAIL";
  mattermostDetail = `HTTP ${response.status}`;
} catch (error) {
  mattermostDetail = error instanceof Error ? error.message : String(error);
}
if (mattermostStatus === "FAIL")
  finish("FAIL", {
    reasonCode: "LIVE_MATTERMOST_READ_FAILED",
    liveMattermost: mattermostStatus,
    mattermostDetail,
    liveModel: "NOT_RUN",
  });

let liveModel: "PASS" | "FAIL" | "SKIPPED_GATED" = "SKIPPED_GATED";
let modelDetail = "MODEL_NOT_OPTED_IN";
if (process.env.AWP_LIVE_MODEL_OPT_IN === "true") {
  const modelUrl = process.env.AWP_LIVE_MODEL_HEALTH_URL?.trim();
  const modelAllowedHost = process.env.AWP_LIVE_MODEL_ALLOWED_HOST?.trim();
  if (!modelUrl || !modelAllowedHost)
    finish("FAIL", {
      reasonCode: "LIVE_MODEL_CONTROLS_INCOMPLETE",
      liveMattermost: "PASS",
      liveModel: "FAIL",
    });
  const target = new URL(modelUrl);
  if (
    target.protocol !== "https:" ||
    target.hostname !== modelAllowedHost ||
    /(?:^|[.-])prod(?:uction)?(?:[.-]|$)/iu.test(target.hostname)
  )
    finish("FAIL", {
      reasonCode: "LIVE_MODEL_TARGET_DENIED",
      liveMattermost: "PASS",
      liveModel: "FAIL",
    });
  try {
    const response = await fetch(target, {
      method: "GET",
      headers: { accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    liveModel = response.ok ? "PASS" : "FAIL";
    modelDetail = `HTTP ${response.status}`;
  } catch (error) {
    liveModel = "FAIL";
    modelDetail = error instanceof Error ? error.message : String(error);
  }
}
finish(liveModel === "FAIL" ? "FAIL" : "PASS", {
  reasonCode: liveModel === "FAIL" ? "LIVE_MODEL_READ_FAILED" : "LIVE_NONPROD_ACCEPTED",
  endpointHostHash: createHash("sha256").update(endpoint.hostname).digest("hex"),
  mutationRequests: 0,
  liveMattermost: "PASS",
  mattermostDetail,
  liveModel,
  modelDetail,
});
