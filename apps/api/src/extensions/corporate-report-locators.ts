import { readFileSync } from "node:fs";

import type { DataSource } from "typeorm";

import {
  type ExactRevisionRef,
  pilotContentHash,
  type ProjectScope,
  samePilotRef,
} from "@awp/platform-core";
import {
  type CorporateConnectorFactories,
  type CorporateVaultConnectorConfiguration,
  type GitLabPilotReportLocator,
  type GitLabPilotReportLocatorAuthority,
  integrationConfigurationHash,
  type PilotReportReference,
  type RuntimeEnvironment,
} from "@awp/runtime-composition";

type GitLabConnectionConfiguration = Parameters<CorporateConnectorFactories["gitlab"]>[1];

/** Locator file contains no credentials. Authenticity is verified by the signed report policy. */
export function createCorporateReportLocators(
  input: Readonly<{
    source: DataSource;
    environment: RuntimeEnvironment;
    connectors: CorporateVaultConnectorConfiguration;
    factories: CorporateConnectorFactories;
    path: string;
  }>,
): GitLabPilotReportLocatorAuthority {
  const deployment = input.environment.deployment;
  if (
    !input.source.isInitialized ||
    input.environment.profile !== "non-local" ||
    input.environment.environmentScope !== "NON_PROD" ||
    !deployment ||
    !input.path.startsWith("/")
  )
    throw new Error("CORPORATE_REPORT_LOCATORS_INVALID");
  const all = (): GitLabPilotReportLocator[] => {
    try {
      const bytes = readFileSync(input.path);
      if (!bytes.length || bytes.length > 1_048_576) throw new Error();
      const value = JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
      if (
        !value ||
        Object.keys(value).some(
          (key) => !["schemaVersion", "deploymentPolicyHash", "reports"].includes(key),
        ) ||
        value.schemaVersion !== 1 ||
        value.deploymentPolicyHash !== pilotContentHash(deployment) ||
        !Array.isArray(value.reports) ||
        value.reports.length > 1000
      )
        throw new Error();
      const reports = value.reports as GitLabPilotReportLocator[];
      if (
        reports.some(
          (item) =>
            !item ||
            item.workspaceId !== deployment.workspaceId ||
            !deployment.projectIds.includes(item.projectId) ||
            Object.keys(item).some(
              (key) =>
                ![
                  "workspaceId",
                  "projectId",
                  "reportRef",
                  "numericProjectId",
                  "jobId",
                  "path",
                  "signature",
                ].includes(key),
            ) ||
            !item.reportRef ||
            Object.keys(item.reportRef).some(
              (key) => !["id", "version", "contentHash"].includes(key),
            ) ||
            !item.signature ||
            Object.keys(item.signature).some(
              (key) => !["executorId", "keyRef", "subjectRef", "value"].includes(key),
            ) ||
            !item.signature.keyRef ||
            !item.signature.subjectRef ||
            [item.signature.keyRef, item.signature.subjectRef].some((ref) =>
              Object.keys(ref).some((key) => !["id", "version", "contentHash"].includes(key)),
            ),
        ) ||
        new Set(
          reports.map(
            (item) => `${item.projectId}:${item.reportRef?.id}:${item.reportRef?.version}`,
          ),
        ).size !== reports.length
      )
        throw new Error();
      return reports;
    } catch {
      throw new Error("CORPORATE_REPORT_LOCATORS_INVALID");
    }
  };
  const report = async (scope: ProjectScope, ref: ExactRevisionRef) => {
    const values = all().filter(
      (item) =>
        item.workspaceId === scope.workspaceId &&
        item.projectId === scope.projectId &&
        samePilotRef(item.reportRef, ref),
    );
    if (values.length !== 1) throw new Error("PILOT_REPORT_ARTIFACT_UNAVAILABLE");
    return values[0]!;
  };
  return {
    report,
    prerequisite: async (
      scope: ProjectScope,
      parent: ExactRevisionRef,
      ref: PilotReportReference,
    ) => {
      const parentLocator = await report(scope, parent);
      const values = all().filter(
        (item) =>
          item.workspaceId === scope.workspaceId &&
          item.projectId === scope.projectId &&
          item.numericProjectId === parentLocator.numericProjectId &&
          item.jobId === parentLocator.jobId &&
          item.path === ref.path &&
          item.reportRef.contentHash === ref.sha256,
      );
      if (values.length !== 1) throw new Error("PILOT_REPORT_ARTIFACT_UNAVAILABLE");
      return values[0]!;
    },
    client: async (scope, locator) => {
      const entries = input.connectors.connectors.filter(
        ({ grant }) =>
          grant.binding.provider === "GITLAB" &&
          grant.binding.workspaceId === scope.workspaceId &&
          grant.binding.projectId === scope.projectId &&
          grant.binding.gitlab?.numericProjectId === locator.numericProjectId,
      );
      if (entries.length !== 1) throw new Error("PILOT_REPORT_ARTIFACT_UNAVAILABLE");
      const binding = entries[0]!.grant.binding;
      const rows = (await input.source.query(
        `SELECT r.content,r.content_hash FROM connection_headers h JOIN connection_revisions r
         ON (r.workspace_id,r.header_id,r.version)=(h.workspace_id,h.id,h.current_published_version)
         WHERE h.workspace_id=$1 AND h.id=$2 AND r.version=$3 AND r.status='PUBLISHED'`,
        [scope.workspaceId, binding.connectionRef.id, binding.connectionRef.version],
      )) as { content: Record<string, unknown>; content_hash: string }[];
      if (
        rows.length !== 1 ||
        rows[0]!.content_hash !== binding.connectionRef.contentHash ||
        integrationConfigurationHash("connection", rows[0]!.content) !== rows[0]!.content_hash
      )
        throw new Error("PILOT_REPORT_ARTIFACT_UNAVAILABLE");
      const envelope = rows[0]!.content.connectorConfiguration;
      if (
        !envelope ||
        typeof envelope !== "object" ||
        Array.isArray(envelope) ||
        !("value" in envelope) ||
        !envelope.value ||
        typeof envelope.value !== "object" ||
        Array.isArray(envelope.value)
      )
        throw new Error("PILOT_REPORT_ARTIFACT_UNAVAILABLE");
      return input.factories.gitlab(
        binding.ref.id,
        envelope.value as GitLabConnectionConfiguration,
        locator.numericProjectId,
      ).client;
    },
  };
}
