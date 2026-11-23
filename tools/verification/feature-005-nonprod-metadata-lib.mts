import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import {
  gitLabPilotMetadataContentHash,
  GitLabPilotMetadataError,
  type GitLabPilotMetadataPackage,
  validateGitLabPilotMetadataPackage,
} from "../../packages/platform-contracts/src/extensions/gitlab-pilot-metadata.ts";

const productionHost = /(?:^|[.-])prod(?:uction)?(?:[.-]|$)/iu;
const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

export { gitLabPilotMetadataContentHash, GitLabPilotMetadataError };
export type { GitLabPilotMetadataPackage };

export function isFeature005ProductionTarget(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Readonly<Record<string, unknown>>;
  const environment = String(candidate.environmentClass ?? "");
  const server =
    candidate.server !== null &&
    typeof candidate.server === "object" &&
    !Array.isArray(candidate.server)
      ? (candidate.server as Readonly<Record<string, unknown>>)
      : {};
  let hostname = "";
  try {
    hostname = new URL(String(server.baseUrl ?? "")).hostname;
  } catch {
    /* the contract validator reports malformed URLs */
  }
  return (
    /^PROD(?:UCTION)?$/iu.test(environment) ||
    productionHost.test(hostname) ||
    candidate.productionDenied === false
  );
}

function endpointFor(value: unknown): URL | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const server = (value as Readonly<Record<string, unknown>>).server;
  if (server === null || typeof server !== "object" || Array.isArray(server)) return undefined;
  try {
    return new URL(String((server as Readonly<Record<string, unknown>>).baseUrl ?? ""));
  } catch {
    return undefined;
  }
}

function assertEndpointPolicy(value: unknown): void {
  if (isFeature005ProductionTarget(value))
    throw new GitLabPilotMetadataError("PRODUCTION_TARGET_DENIED");
  if (value === null || typeof value !== "object" || Array.isArray(value)) return;
  const candidate = value as Readonly<Record<string, unknown>>;
  const endpoint = endpointFor(candidate);
  if (!endpoint) return;
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash)
    throw new GitLabPilotMetadataError("GITLAB_PILOT_ENDPOINT_CREDENTIAL_OR_QUERY_FORBIDDEN");
  if (candidate.environmentClass === "LOCAL" && !loopbackHosts.has(endpoint.hostname))
    throw new GitLabPilotMetadataError("LOCAL_ENDPOINT_NOT_LOOPBACK");
  if (
    (candidate.environmentClass === "DEVELOPMENT" || candidate.environmentClass === "TEST") &&
    endpoint.protocol !== "https:"
  )
    throw new GitLabPilotMetadataError("NONPROD_TLS_REQUIRED");
}

function assertPurposeContour(metadata: GitLabPilotMetadataPackage): void {
  const purpose = metadata.deploymentPurpose;
  const contour = metadata.contourKey;
  if (
    purpose === "CONFORMANCE_VALIDATION" &&
    !new Set(["qa-jira-gitlab-local", "qa-jira-gitlab-development", "qa-jira-gitlab-test"]).has(
      contour,
    )
  ) {
    throw new GitLabPilotMetadataError("GITLAB_PILOT_PURPOSE_CONTOUR_MISMATCH");
  }
  if (
    purpose === "PILOT_REHEARSAL" &&
    (contour !== "qa-jira-gitlab-mattermost-local" || metadata.environmentClass !== "LOCAL")
  ) {
    throw new GitLabPilotMetadataError("GITLAB_PILOT_REHEARSAL_CONTOUR_INVALID");
  }
  if (
    purpose === "PILOT_DEPLOYMENT" &&
    !new Set(["qa-jira-gitlab-mattermost-development", "qa-jira-gitlab-mattermost-test"]).has(
      contour,
    )
  ) {
    throw new GitLabPilotMetadataError("GITLAB_PILOT_RELEASE_CONTOUR_INVALID");
  }
}

export function validateFeature005GitLabMetadata(value: unknown): GitLabPilotMetadataPackage {
  assertEndpointPolicy(value);
  const metadata = validateGitLabPilotMetadataPackage(value);
  assertPurposeContour(metadata);
  return metadata;
}

export function assertFeature005LiveNonProd(metadata: GitLabPilotMetadataPackage): URL {
  if (metadata.deploymentPurpose !== "CONFORMANCE_VALIDATION")
    throw new GitLabPilotMetadataError("LIVE_METADATA_PURPOSE_INVALID");
  if (!new Set(["DEVELOPMENT", "TEST"]).has(metadata.environmentClass))
    throw new GitLabPilotMetadataError("LIVE_METADATA_NOT_NONPROD");
  if (!metadata.operatorOptIn || !metadata.productionDenied)
    throw new GitLabPilotMetadataError("NONPROD_OPERATOR_OPT_IN_REQUIRED");
  const endpoint = new URL(metadata.server.baseUrl);
  if (endpoint.protocol !== "https:" || productionHost.test(endpoint.hostname))
    throw new GitLabPilotMetadataError("NONPROD_TLS_OR_HOST_INVALID");
  return endpoint;
}

export function assertFeature005PilotRehearsal(metadata: GitLabPilotMetadataPackage): void {
  if (
    metadata.deploymentPurpose !== "PILOT_REHEARSAL" ||
    metadata.contourKey !== "qa-jira-gitlab-mattermost-local" ||
    metadata.environmentClass !== "LOCAL"
  ) {
    throw new GitLabPilotMetadataError("GITLAB_PILOT_REHEARSAL_CONTOUR_INVALID");
  }
}

export function assertFeature005PilotRelease(metadata: GitLabPilotMetadataPackage): URL {
  if (
    metadata.deploymentPurpose !== "PILOT_DEPLOYMENT" ||
    !new Set(["DEVELOPMENT", "TEST"]).has(metadata.environmentClass)
  ) {
    throw new GitLabPilotMetadataError("GITLAB_PILOT_RELEASE_CONTOUR_INVALID");
  }
  const endpoint = new URL(metadata.server.baseUrl);
  if (endpoint.protocol !== "https:" || productionHost.test(endpoint.hostname))
    throw new GitLabPilotMetadataError("GITLAB_PILOT_RELEASE_ENDPOINT_INVALID");
  return endpoint;
}

export function readFeature005Metadata(
  pathArgument: string,
  workspace: string,
): Readonly<{ path: string; metadata: GitLabPilotMetadataPackage; fileHash: `sha256:${string}` }> {
  const path = isAbsolute(pathArgument) ? resolve(pathArgument) : resolve(workspace, pathArgument);
  if (path !== workspace && !path.startsWith(`${workspace}/`))
    throw new GitLabPilotMetadataError("METADATA_PATH_OUTSIDE_WORKSPACE");
  if (!existsSync(path)) throw new GitLabPilotMetadataError("METADATA_FILE_MISSING");
  const bytes = readFileSync(path);
  return Object.freeze({
    path,
    metadata: validateFeature005GitLabMetadata(JSON.parse(bytes.toString("utf8")) as unknown),
    fileHash: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
  });
}
