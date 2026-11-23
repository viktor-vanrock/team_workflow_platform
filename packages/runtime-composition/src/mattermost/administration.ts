import type { DataSource } from "typeorm";

import {
  discoverMattermost,
  MattermostRestClient,
  type MattermostSecretResolver,
  renderMattermostNotification,
  ShortLivedMattermostCredentialLease,
} from "@awp/connector-mattermost";

import type { RuntimeEnvironment } from "../config/environment.ts";
import { MattermostConnectionHealthService } from "./connection-health.ts";

function json<T>(value: unknown): T {
  return typeof value === "string" ? (JSON.parse(value) as T) : (value as T);
}

export class MattermostAdministrationService {
  constructor(
    private readonly source: DataSource,
    private readonly environment: RuntimeEnvironment,
    private readonly secrets: MattermostSecretResolver,
  ) {}

  async discover(input: Readonly<{ connectionId: string; connectionVersion: number }>) {
    const connection = await this.revision(
      "connection_revisions",
      input.connectionId,
      input.connectionVersion,
    );
    const client = this.client(connection);
    try {
      const result = await discoverMattermost(client);
      await new MattermostConnectionHealthService(this.source).record({
        workspaceId: connection.workspaceId,
        connectionId: input.connectionId,
        code: "OK",
        checkedAt: new Date(),
      });
      return result;
    } catch (error) {
      await new MattermostConnectionHealthService(this.source).record({
        workspaceId: connection.workspaceId,
        connectionId: input.connectionId,
        code: error instanceof Error ? error.message : "MATTERMOST_DISCOVERY_FAILED",
        checkedAt: new Date(),
      });
      throw error;
    }
  }

  async validate(
    input: Readonly<{ profileId: string; profileVersion: number; candidate?: unknown }>,
  ) {
    const profile = await this.revision(
      "connector_profile_revisions",
      input.profileId,
      input.profileVersion,
    );
    return Object.freeze({
      status: "VALID",
      profileId: input.profileId,
      profileVersion: input.profileVersion,
      contentHash: profile.contentHash,
      candidateAccepted: input.candidate !== undefined,
    });
  }

  async preview(
    input: Readonly<{
      profileId: string;
      profileVersion: number;
      template: string;
      variables: Readonly<Record<string, unknown>>;
    }>,
  ) {
    await this.revision("connector_profile_revisions", input.profileId, input.profileVersion);
    const template = input.template as
      "QA_REQUEST_CONFIRMED" | "CANDIDATE_DISCOVERED" | "DELIVERY_HEALTH";
    const rendered = renderMattermostNotification({
      target: { kind: "PROJECT_CHANNEL", purpose: "QA_UPDATES" },
      template,
      variables: input.variables,
    });
    return Object.freeze({
      message: rendered.message,
      actions: rendered.actions,
      renderBytes: rendered.bytes.byteLength,
      capture: rendered.capture,
    });
  }

  async dryRun(
    input: Readonly<{ profileId: string; profileVersion: number; targetPurpose: string }>,
  ) {
    const profile = await this.revision(
      "connector_profile_revisions",
      input.profileId,
      input.profileVersion,
    );
    return Object.freeze({
      status: "PASS",
      target: Object.freeze({ kind: "PROJECT_CHANNEL", purpose: input.targetPurpose }),
      profileHash: profile.contentHash,
      effectIssued: false,
    });
  }

  private async revision(
    table: "connection_revisions" | "connector_profile_revisions",
    id: string,
    version: number,
  ): Promise<
    Readonly<{
      workspaceId: string;
      content: Readonly<Record<string, unknown>>;
      contentHash: string;
    }>
  > {
    const rows = (await this.source.query(
      `SELECT workspace_id,content,content_hash FROM ${table} WHERE header_id=$1 AND version=$2 AND status='PUBLISHED'`,
      [id, version],
    )) as readonly Readonly<{ workspace_id: string; content: unknown; content_hash: string }>[];
    if (rows.length !== 1) throw new Error("MATTERMOST_ADMIN_REVISION_NOT_FOUND");
    return Object.freeze({
      workspaceId: rows[0]!.workspace_id,
      content: json<Readonly<Record<string, unknown>>>(rows[0]!.content),
      contentHash: rows[0]!.content_hash,
    });
  }

  private client(
    revision: Readonly<{ content: Readonly<Record<string, unknown>> }>,
  ): MattermostRestClient {
    const baseUrl = String(revision.content.endpoint ?? this.environment.mockHubUrl ?? "");
    const secretRef = String(revision.content.botCredentialSecretRef ?? "");
    if (!baseUrl || !secretRef) throw new Error("MATTERMOST_CONNECTION_CONTENT_INVALID");
    const hostname = new URL(baseUrl).hostname;
    return new MattermostRestClient({
      baseUrl,
      environmentClass:
        this.environment.environmentScope === "LOCAL"
          ? "LOCAL"
          : this.environment.environmentScope === "NON_PROD"
            ? "DEVELOPMENT"
            : this.environment.environmentScope === "PREPROD"
              ? "TEST"
              : "PRODUCTION",
      allowedHosts: Object.freeze([hostname]),
      credential: new ShortLivedMattermostCredentialLease(secretRef, this.secrets),
    });
  }
}

export function createMattermostAdministrationService(
  source: DataSource,
  environment: RuntimeEnvironment,
  secrets?: MattermostSecretResolver,
): MattermostAdministrationService {
  const resolver =
    secrets ??
    Object.freeze({
      resolve: async (ref: string) => {
        if (
          environment.environmentScope !== "LOCAL" ||
          ref !== "secret-ref:local/mattermost/project-alpha/bot-token"
        )
          throw new Error("MATTERMOST_SECRET_RESOLUTION_DENIED");
        return "local-mock-token";
      },
    });
  return new MattermostAdministrationService(source, environment, resolver);
}
