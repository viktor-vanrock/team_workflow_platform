import type { DataSource } from "typeorm";

import { loadEnvironment, type RuntimeEnvironment } from "../config/environment.ts";
import { runtimePersistence } from "../pilot/composition.ts";

export type LocalDependencyKey = "db" | "schema" | "extensions" | "mockHub" | "gitlab";
export interface LocalDependencyStatus {
  readonly state: "UP" | "DOWN";
  readonly detail: string;
}
export interface LocalReadinessReport {
  readonly status: "UP" | "DOWN";
  readonly runtime: Readonly<{ profile: "local" | "test" }>;
  readonly dependencies: Readonly<Record<LocalDependencyKey, LocalDependencyStatus>>;
}

async function probe(name: string, check: () => Promise<string>): Promise<LocalDependencyStatus> {
  try {
    return Object.freeze({ state: "UP", detail: await check() });
  } catch (error) {
    return Object.freeze({
      state: "DOWN",
      detail: `${name}: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

async function reachable(url: string, headers?: Readonly<Record<string, string>>): Promise<string> {
  const response = await fetch(url, {
    ...(headers ? { headers } : {}),
    signal: AbortSignal.timeout(2_000),
  });
  if (response.status >= 500) throw new Error(`HTTP ${response.status}`);
  return `reachable (HTTP ${response.status})`;
}

export async function localReadinessReport(
  dataSource: DataSource,
  environment: RuntimeEnvironment = loadEnvironment(),
): Promise<LocalReadinessReport> {
  if (environment.profile !== "local" && environment.profile !== "test")
    throw new Error("LOCAL_READINESS_PROFILE_REQUIRED");
  const mockHubUrl = environment.mockHubUrl;
  if (!mockHubUrl) throw new Error("LOCAL_READINESS_MOCK_HUB_REQUIRED");
  const gitLab =
    environment.composition === "qa-jira-gitlab-local" ||
    environment.composition === "qa-jira-gitlab-mattermost-local";
  const entries = await Promise.all([
    probe("db", async () => {
      await dataSource.query("SELECT 1");
      return "authenticated query";
    }),
    probe("schema", async () => {
      const expected = runtimePersistence(environment.composition).expectedVersions;
      const versions = (await dataSource.query(
        "SELECT namespace,version FROM platform_schema_versions WHERE namespace=ANY($1::text[])",
        [Object.keys(expected)],
      )) as { namespace: string; version: number }[];
      if (
        Object.entries(expected).some(
          ([namespace, version]) =>
            !versions.some((row) => row.namespace === namespace && row.version === version),
        )
      )
        throw new Error("schema version mismatch");
      const rows = (await dataSource.query(
        "SELECT to_regclass('public.workspaces') AS workspaces,to_regclass('public.local_seed_markers') AS seed_markers,to_regclass('public.gitlab_discovery_snapshots') AS gitlab_discovery",
      )) as readonly Record<string, unknown>[];
      if (!rows[0]?.workspaces || !rows[0]?.seed_markers)
        throw new Error("required tables missing");
      if (gitLab && !rows[0]?.gitlab_discovery) throw new Error("GitLab migrations missing");
      return gitLab ? "core and GitLab migrations present" : "core migrations present";
    }),
    probe("extensions", async () => {
      const mattermost =
        environment.composition === "qa-jira-mattermost-local" ||
        environment.composition === "qa-jira-gitlab-mattermost-local";
      const rows = (await dataSource.query(
        `SELECT
           COUNT(*) FILTER (WHERE pack_key='dummy' AND pack_version='1.0.0')::int AS dummy,
           COUNT(*) FILTER (WHERE pack_key='competency-qa' AND pack_version='1.1.0')::int AS qa11,
           COUNT(*) FILTER (WHERE pack_key='competency-qa' AND pack_version='1.2.0')::int AS qa12
         FROM competency_pack_registrations WHERE registration_status='REGISTERED'`,
      )) as readonly { dummy: number; qa11: number; qa12: number }[];
      if (Number(rows[0]?.dummy) !== 1) throw new Error("Dummy registration missing");
      if (mattermost && Number(rows[0]?.qa11) !== 1) throw new Error("QA 1.1 registration missing");
      if (mattermost) {
        const connectors = (await dataSource.query(
          "SELECT COUNT(*)::int AS count FROM connector_registrations WHERE connector_key='mattermost.hermes-intake' AND connector_version='1.0.0' AND registration_status='REGISTERED'",
        )) as readonly { count: number }[];
        if (Number(connectors[0]?.count) !== 1) throw new Error("Mattermost registration missing");
      }
      if (gitLab) {
        if (Number(rows[0]?.qa12) !== 1) throw new Error("QA 1.2 registration missing");
        const connectors = (await dataSource.query(
          "SELECT COUNT(*)::int AS count FROM connector_registrations WHERE connector_key='gitlab.automated-validation' AND connector_version='1.0.0' AND registration_status='REGISTERED'",
        )) as readonly { count: number }[];
        if (Number(connectors[0]?.count) !== 1) throw new Error("GitLab registration missing");
      }
      return gitLab
        ? "dummy@1.0.0, competency-qa@1.2.0 and GitLab registered"
        : mattermost
          ? "dummy@1.0.0, competency-qa@1.1.0 and Mattermost registered"
          : "dummy@1.0.0 registered";
    }),
    probe("mockHub", async () => await reachable(`${mockHubUrl}/health/live`)),
    probe("gitlab", async () =>
      gitLab
        ? await reachable(`${mockHubUrl}/api/v4/version`, { "private-token": "mock-gitlab-read" })
        : "not selected",
    ),
  ]);
  const dependencies = Object.freeze({
    db: entries[0]!,
    schema: entries[1]!,
    extensions: entries[2]!,
    mockHub: entries[3]!,
    gitlab: entries[4]!,
  });
  return Object.freeze({
    status: Object.values(dependencies).every((dependency) => dependency.state === "UP")
      ? "UP"
      : "DOWN",
    runtime: Object.freeze({ profile: environment.profile }),
    dependencies,
  });
}
