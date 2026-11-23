import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

import { validatePilotMetadata } from "./feature-003-nonprod-metadata-lib.mts";
import { stringifyPortableJson } from "./portable-json.mts";

const workspace = resolve(import.meta.dirname, "../..");
const reportPath = resolve(workspace, "reports/003-jira-operational-authority/nonprod.json");
const metadataReportPath = resolve(
  workspace,
  "reports/003-jira-operational-authority/nonprod-metadata.json",
);
const flags = new Set(process.argv.slice(2));
const knownFlags = new Set(["--contract", "--least-privilege"]);
const unknownFlags = [...flags].filter((flag) => !knownFlags.has(flag));
if (unknownFlags.length > 0)
  throw new Error(`Unknown non-prod arguments: ${unknownFlags.join(", ")}`);

type CheckResult = Readonly<{
  id: string;
  status: "PASS" | "FAIL";
  httpStatus?: number;
  detail?: string;
  rateLimitPresent?: boolean;
}>;
type FinalStatus = "PASS" | "FAIL" | "SKIPPED_GATED";

function writeReport(
  status: FinalStatus,
  startedAt: Date,
  body: Readonly<Record<string, unknown>>,
): void {
  const report = {
    schemaVersion: 1,
    feature: "003-jira-operational-authority",
    gate: "nonprod-conformance",
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    status,
    ...body,
  };
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, stringifyPortableJson(report, workspace), "utf8");
  console.log(`[nonprod:003] ${status}; report: ${reportPath}`);
}

async function readOnlyGet(
  id: string,
  url: URL,
  authorization: string,
  inspect: (value: unknown) => string | undefined,
): Promise<CheckResult> {
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { accept: "application/json", authorization },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok)
      return Object.freeze({
        id,
        status: "FAIL",
        httpStatus: response.status,
        detail: `read-only endpoint returned ${response.status}`,
      });
    const value = (await response.json()) as unknown;
    const problem = inspect(value);
    return Object.freeze({
      id,
      status: problem ? "FAIL" : "PASS",
      httpStatus: response.status,
      ...(problem ? { detail: problem } : {}),
      rateLimitPresent:
        response.headers.has("retry-after") || response.headers.has("x-ratelimit-limit"),
    });
  } catch (error) {
    return Object.freeze({
      id,
      status: "FAIL",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

const startedAt = new Date();
const preflight = spawnSync(
  process.execPath,
  ["tools/verification/feature-003-nonprod-metadata.mts"],
  { cwd: workspace, env: { ...process.env, CI: "true" }, stdio: "inherit" },
);
if ((preflight.status ?? 1) !== 0 || !existsSync(metadataReportPath)) {
  writeReport("FAIL", startedAt, { reasonCode: "C1_PREFLIGHT_FAILED" });
  process.exit(1);
}
const metadataReport = JSON.parse(readFileSync(metadataReportPath, "utf8")) as Readonly<
  Record<string, unknown>
>;
if (metadataReport.status === "SKIPPED_GATED") {
  writeReport("SKIPPED_GATED", startedAt, {
    reasonCode: metadataReport.reasonCode ?? "C1_METADATA_NOT_SUPPLIED",
    metadataStatus: metadataReport.status,
  });
  process.exit(0);
}
if (metadataReport.status !== "PASS") {
  writeReport("FAIL", startedAt, {
    reasonCode: "C1_PREFLIGHT_FAILED",
    metadataStatus: metadataReport.status,
  });
  process.exit(1);
}

const optedIn = process.env.AWP_JIRA_NONPROD_CONFORMANCE === "1";
const attested = process.env.AWP_JIRA_NONPROD_TARGET_ATTESTATION === "NON_PRODUCTION";
const allowedHost = process.env.AWP_JIRA_NONPROD_ALLOWED_HOST?.trim();
const authorization = process.env.AWP_JIRA_NONPROD_AUTHORIZATION?.trim();
if (!optedIn || !attested || !allowedHost || !authorization) {
  writeReport("SKIPPED_GATED", startedAt, {
    reasonCode: "LIVE_CONFORMANCE_NOT_FULLY_OPTED_IN",
    requiredControls: [
      "AWP_JIRA_NONPROD_CONFORMANCE=1",
      "AWP_JIRA_NONPROD_TARGET_ATTESTATION=NON_PRODUCTION",
      "AWP_JIRA_NONPROD_ALLOWED_HOST",
      "AWP_JIRA_NONPROD_AUTHORIZATION",
    ],
    metadataStatus: metadataReport.status,
  });
  process.exit(0);
}

const supplied = process.env.AWP_JIRA_NONPROD_METADATA_PACKAGE!.trim();
const metadataPath = isAbsolute(supplied) ? resolve(supplied) : resolve(workspace, supplied);
const metadata = validatePilotMetadata(
  JSON.parse(readFileSync(metadataPath, "utf8")) as unknown,
  workspace,
);
const endpoint = new URL(metadata.endpoint.baseUrl);
if (
  metadata.environment !== "NON_PROD" ||
  endpoint.protocol !== "https:" ||
  endpoint.hostname !== allowedHost ||
  /(?:^|[.-])prod(?:uction)?(?:[.-]|$)/iu.test(endpoint.hostname)
) {
  writeReport("FAIL", startedAt, {
    reasonCode: "PRODUCTION_OR_UNATTESTED_TARGET_FORBIDDEN",
    hostHash: createHash("sha256").update(endpoint.hostname).digest("hex"),
  });
  process.exit(1);
}

const checks: CheckResult[] = [];
const runContract = flags.size === 0 || flags.has("--contract");
const runLeastPrivilege = flags.size === 0 || flags.has("--least-privilege");
const apiRoot = metadata.adapter.apiFlavor === "CLOUD_REST_V3" ? "rest/api/3/" : "rest/api/2/";
if (runContract) {
  checks.push(
    await readOnlyGet(
      "server-info-contract",
      new URL(`${apiRoot}serverInfo`, endpoint),
      authorization,
      (value) =>
        value !== null && typeof value === "object"
          ? undefined
          : "serverInfo response is not an object",
    ),
  );
}
if (runLeastPrivilege) {
  const forbidden = ["ADMINISTER", "ADMINISTER_PROJECTS", "DELETE_ISSUES"];
  const url = new URL(`${apiRoot}mypermissions`, endpoint);
  url.searchParams.set("permissions", forbidden.join(","));
  checks.push(
    await readOnlyGet("least-privilege-negative", url, authorization, (value) => {
      if (value === null || typeof value !== "object")
        return "permissions response is not an object";
      const permissions = (value as { permissions?: Record<string, { havePermission?: boolean }> })
        .permissions;
      if (!permissions) return "permissions map is missing";
      const granted = forbidden.filter(
        (permission) => permissions[permission]?.havePermission === true,
      );
      return granted.length > 0 ? `forbidden permissions granted: ${granted.join(",")}` : undefined;
    }),
  );
}
const failed = checks.some(({ status }) => status === "FAIL");
writeReport(failed ? "FAIL" : "PASS", startedAt, {
  mode:
    runContract && runLeastPrivilege
      ? "contract-and-least-privilege"
      : runContract
        ? "contract"
        : "least-privilege",
  adapter: { family: metadata.adapter.family, exactBuild: metadata.adapter.exactBuild },
  endpoint: { hostHash: createHash("sha256").update(endpoint.hostname).digest("hex") },
  mutationRequests: 0,
  checks,
});
if (failed) process.exitCode = 1;
