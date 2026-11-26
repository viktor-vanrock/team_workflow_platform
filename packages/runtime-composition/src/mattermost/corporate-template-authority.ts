import type { DataSource } from "typeorm";
import { renderMattermostNotification } from "@awp/connector-mattermost";
import type { MessagingLogicalTarget } from "@awp/connector-sdk";
import { designContractRegistry, type JsonValue, sha256 } from "@awp/platform-contracts";
import type { ConnectorCommand } from "@awp/platform-core";
import type { CorporateMattermostTemplateAuthority } from "./corporate-worker.ts";

/** Stable digest of the one server-owned renderer supported by this pilot. */
export const qaConfirmedTemplateHash = sha256(
  "AWP QA\n\nQA request confirmed: {{title}}" as JsonValue,
);
export const qaConfirmedTemplateRef = "qa.intake.confirmed@1";

export function createCorporateMattermostTemplateAuthority(
  source: DataSource,
): CorporateMattermostTemplateAuthority {
  if (!source.isInitialized) throw new Error("MATTERMOST_TEMPLATE_AUTHORITY_REQUIRED");
  return {
    async verify(command: ConnectorCommand, profile: Readonly<Record<string, unknown>>) {
      try {
        const rows = (await source.query(
          "SELECT template_evidence,render_hash,target_hash,payload_hash FROM notification_intents WHERE workspace_id=$1 AND project_id=$2 AND id=$3 AND command_id=$4",
          [command.workspaceId, command.projectId, command.source.notificationIntentId, command.id],
        )) as readonly {
          template_evidence: unknown;
          render_hash: string;
          target_hash: string;
          payload_hash: string;
        }[];
        if (
          rows.length !== 1 ||
          !rows[0]!.template_evidence ||
          rows[0]!.target_hash !== command.targetHash ||
          rows[0]!.payload_hash !== command.payloadHash
        )
          return false;
        const raw = rows[0]!.template_evidence;
        const evidence = (typeof raw === "string" ? JSON.parse(raw) : raw) as Record<
          string,
          unknown
        >;
        if (
          !evidence ||
          typeof evidence !== "object" ||
          Array.isArray(evidence) ||
          Object.keys(evidence).sort().join(",") !==
            "renderHash,templateHash,templateRef,variablesHash,variablesSchemaRef" ||
          evidence.templateRef !== qaConfirmedTemplateRef ||
          evidence.templateHash !== qaConfirmedTemplateHash ||
          !Array.isArray(profile.templates)
        )
          return false;
        const matches = profile.templates.filter(
          (item) =>
            item &&
            typeof item === "object" &&
            !Array.isArray(item) &&
            (item as Record<string, unknown>).templateRef === qaConfirmedTemplateRef &&
            (item as Record<string, unknown>).templateHash === qaConfirmedTemplateHash,
        );
        if (matches.length !== 1) return false;
        const template = matches[0] as Record<string, unknown>;
        const schemaRef = evidence.variablesSchemaRef as {
          id: string;
          version: number;
          digest: `sha256:${string}`;
        };
        if (
          !schemaRef ||
          schemaRef.version !== 1 ||
          sha256(schemaRef as unknown as JsonValue) !==
            sha256(template.variablesSchemaRef as JsonValue)
        )
          return false;
        const payload = command.payload as Record<string, unknown>;
        if (
          payload.template !== "QA_REQUEST_CONFIRMED" ||
          !payload.variables ||
          typeof payload.variables !== "object" ||
          Array.isArray(payload.variables)
        )
          return false;
        designContractRegistry.validate({ schemaRef, value: payload.variables });
        if (sha256(payload.variables as JsonValue) !== evidence.variablesHash) return false;
        const rendered = renderMattermostNotification({
          target: command.target as MessagingLogicalTarget,
          template: "QA_REQUEST_CONFIRMED",
          variables: payload.variables as Record<string, unknown>,
        });
        const renderedHash = sha256(new TextDecoder().decode(rendered.bytes));
        return renderedHash === evidence.renderHash && renderedHash === rows[0]!.render_hash;
      } catch {
        return false;
      }
    },
  };
}
