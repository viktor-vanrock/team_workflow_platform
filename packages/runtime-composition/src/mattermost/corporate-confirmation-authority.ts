import type { DataSource } from "typeorm";
import { type JsonValue, sha256 } from "@awp/platform-contracts";
import {
  defaultClassificationCatalog,
  DenyByDefaultAuthorizationPolicy,
  type ConnectorCommand,
} from "@awp/platform-core";
import { TypeOrmScopedAccessRepository } from "@awp/platform-persistence-typeorm";
import type { RuntimeEnvironment } from "../config/environment.ts";
import type { CorporateMattermostCommandAuthority } from "./corporate-worker.ts";

/** Only notifications for an already confirmed QA request may use requester rights. */
export function createCorporateQaConfirmationNotificationAuthority(
  source: DataSource,
  environment: RuntimeEnvironment,
): CorporateMattermostCommandAuthority {
  const deployment = environment.deployment;
  if (
    !source.isInitialized ||
    environment.profile !== "non-local" ||
    environment.environmentScope !== "NON_PROD" ||
    !deployment
  )
    throw new Error("CORPORATE_NOTIFICATION_AUTHORITY_REQUIRED");
  const access = new TypeOrmScopedAccessRepository(source);
  return {
    async revalidate(command: ConnectorCommand) {
      if (
        command.actor.kind !== "HUMAN" ||
        !command.source.notificationIntentId ||
        command.workspaceId !== deployment.workspaceId ||
        !deployment.projectIds.includes(command.projectId) ||
        command.capability.key !== "messaging.notify" ||
        command.capability.operation !== "notification.send"
      )
        throw new Error("CORPORATE_NOTIFICATION_AUTHORIZATION_DENIED");
      const payload = command.payload as Record<string, unknown>;
      const variables = payload?.variables as Record<string, unknown> | undefined;
      if (
        payload?.template !== "QA_REQUEST_CONFIRMED" ||
        !variables ||
        typeof variables !== "object" ||
        Array.isArray(variables) ||
        Object.keys(variables).some((key) => key !== "title" && key !== "schemaVersion") ||
        variables.schemaVersion !== 1 ||
        typeof variables.title !== "string" ||
        variables.title.length === 0 ||
        variables.title.length > 200 ||
        /[\r\n<>@`\[\]()*_~\\]|https?:\/\//iu.test(variables.title)
      )
        throw new Error("CORPORATE_NOTIFICATION_TYPE_DENIED");
      const rows = (await source.query(
        `SELECT w.title FROM notification_intents n
      JOIN intake_drafts d ON d.workspace_id=n.workspace_id AND d.project_id=n.project_id
        AND n.source_event_ref LIKE 'draft:'||d.id::text||':confirmed:%'
      JOIN work_items w ON w.workspace_id=d.workspace_id AND w.project_id=d.project_id AND w.source_draft_id=d.id
      JOIN connector_commands c ON c.workspace_id=d.workspace_id AND c.project_id=d.project_id
        AND c.capability_key='operational-work-item' AND c.operation='request.create' AND c.state='CONFIRMED'
        AND c.payload #>> '{metadata,source,intakeDraftId}'=d.id::text
        AND n.source_event_ref='draft:'||d.id::text||':confirmed:'||(c.payload #>> '{metadata,source,confirmationVersion}')
      JOIN identities i ON i.id=d.created_by AND i.kind='HUMAN'
      WHERE n.workspace_id=$1 AND n.project_id=$2 AND n.id=$3 AND n.command_id=$4
        AND n.target_hash=$5 AND n.payload_hash=$6 AND n.expires_at>clock_timestamp()
        AND d.state='SUBMITTED' AND d.created_by=$7 AND w.created_by=$7
        AND c.actor->>'principalId'=$7::text AND i.issuer=$8 AND i.subject=$9`,
        [
          command.workspaceId,
          command.projectId,
          command.source.notificationIntentId,
          command.id,
          command.targetHash,
          command.payloadHash,
          command.actor.principalId,
          command.actor.issuer,
          command.actor.subject,
        ],
      )) as readonly { title: string }[];
      if (rows.length !== 1 || rows[0]!.title !== variables.title)
        throw new Error("CORPORATE_NOTIFICATION_CONFIRMATION_REQUIRED");
      const scope = {
        kind: "PROJECT" as const,
        workspaceId: command.workspaceId,
        projectId: command.projectId,
      };
      const at = new Date();
      const project = await access.getProject(scope);
      if (!project || project.state !== "ACTIVE")
        throw new Error("CORPORATE_NOTIFICATION_AUTHORIZATION_DENIED");
      const decision = new DenyByDefaultAuthorizationPolicy().decide({
        context: {
          scope,
          actor: command.actor,
          correlationId: command.correlationId,
          causationId: command.causationId,
        },
        permission: "qa.request.confirm",
        resourceClassification: defaultClassificationCatalog.reference(
          command.dataClassificationKey,
        ),
        facts: await access.authorizationFacts(scope, command.actor.principalId, at),
        at,
        policyVersion: "qa-confirmation-notification@1",
        operationClass: "EFFECT",
        projectOperationalState: "ACTIVE",
      });
      if (!decision.allowed || !decision.basis)
        throw new Error("CORPORATE_NOTIFICATION_AUTHORIZATION_DENIED");
      return {
        evaluatedAt: at,
        authorizationBasis: decision.basis,
        authorizationBasisHash: sha256(decision.basis as unknown as JsonValue),
      };
    },
  };
}
