import { createHash } from "node:crypto";

import type { DataSource } from "typeorm";

import { type JsonValue, sha256 } from "@awp/platform-contracts";
import {
  CommandGateway,
  defaultClassificationCatalog,
  DenyByDefaultAuthorizationPolicy,
  type GatewayCommit,
} from "@awp/platform-core";
import {
  PilotCommandAdmissionRepository,
  TypeOrmCommandRepository,
  TypeOrmNotificationIntentRepository,
  TypeOrmScopedAccessRepository,
  TypeOrmUnitOfWork,
} from "@awp/platform-persistence-typeorm";

import type { RuntimeEnvironment } from "../config/environment.ts";
import { integrationConfigurationHash } from "../onboarding/configuration-hash.ts";
import type { CorporateConnectorGrant } from "../pilot/connector-authority.ts";
import type { PilotCommandEffectGuard } from "../pilot/effect-guard.ts";
import { buildCorporateQaConfirmationNotification } from "./corporate-confirmation-notification.ts";

const uuid = (value: string) => {
  const h = createHash("sha256").update(value).digest("hex").slice(0, 32).split("");
  h[12] = "4";
  h[16] = ((parseInt(h[16]!, 16) & 3) | 8).toString(16);
  return `${h.slice(0, 8).join("")}-${h.slice(8, 12).join("")}-${h.slice(12, 16).join("")}-${h.slice(16, 20).join("")}-${h.slice(20).join("")}`;
};
const object = (value: unknown): Record<string, unknown> => {
  const raw = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("CORPORATE_NOTIFICATION_EVENT_INVALID");
  return raw as Record<string, unknown>;
};

/** Creates a notification from a confirmed QA event; inbox, intent, command and admission are atomic. */
export function createCorporateQaNotificationProducer(
  input: Readonly<{
    source: DataSource;
    environment: RuntimeEnvironment;
    grants: readonly CorporateConnectorGrant[];
    guard: PilotCommandEffectGuard;
  }>,
) {
  const deployment = input.environment.deployment;
  if (
    !input.source.isInitialized ||
    input.environment.profile !== "non-local" ||
    input.environment.environmentScope !== "NON_PROD" ||
    !deployment ||
    typeof input.guard?.assertCommandAllowed !== "function"
  )
    throw new Error("CORPORATE_NOTIFICATION_PRODUCER_REQUIRED");
  return {
    async run() {
      return await input.source.transaction("SERIALIZABLE", async (manager) => {
        const events = (await manager.query(
          `SELECT e.id,e.workspace_id,e.project_id,e.envelope,e.envelope_hash,e.created_at
        FROM event_outbox e LEFT JOIN consumer_inbox i ON i.consumer_key='corporate-qa-confirmation-notify' AND i.message_id=e.id::text
        WHERE e.event_type='qa.request.accepted' AND i.message_id IS NULL AND e.workspace_id=$1 AND e.project_id=ANY($2::uuid[])
        ORDER BY e.created_at,e.id FOR UPDATE OF e SKIP LOCKED LIMIT 1`,
          [deployment.workspaceId, deployment.projectIds],
        )) as readonly Record<string, unknown>[];
        if (!events.length) return 0;
        const event = events[0]!,
          envelope = object(event.envelope),
          payload = object(envelope.payload);
        if (
          sha256(envelope as JsonValue) !== event.envelope_hash ||
          envelope.workspaceId !== event.workspace_id ||
          envelope.projectId !== event.project_id ||
          envelope.eventType !== "qa.request.accepted" ||
          typeof payload.workItemId !== "string"
        )
          throw new Error("CORPORATE_NOTIFICATION_EVENT_INVALID");
        const facts = (await manager.query(
          `SELECT w.source_draft_id,w.created_by,w.title,w.classification_key,c.id AS command_id
        FROM work_items w JOIN intake_drafts d ON d.workspace_id=w.workspace_id AND d.project_id=w.project_id AND d.id=w.source_draft_id AND d.state='SUBMITTED'
        JOIN connector_commands c ON c.workspace_id=w.workspace_id AND c.project_id=w.project_id AND c.capability_key='operational-work-item'
          AND c.operation='request.create' AND c.state='CONFIRMED' AND c.payload #>> '{metadata,source,intakeDraftId}'=d.id::text
        WHERE w.workspace_id=$1 AND w.project_id=$2 AND w.id=$3 AND w.created_by=d.created_by
          AND c.actor->>'principalId'=w.created_by::text FOR SHARE OF w,d,c`,
          [event.workspace_id, event.project_id, payload.workItemId],
        )) as readonly Record<string, unknown>[];
        if (facts.length !== 1 || typeof facts[0]!.title !== "string")
          throw new Error("CORPORATE_NOTIFICATION_CONFIRMATION_REQUIRED");
        const fact = facts[0]!,
          workspaceId = String(event.workspace_id),
          projectId = String(event.project_id);
        const parent = await new TypeOrmCommandRepository(input.source).get(
          workspaceId,
          projectId,
          String(fact.command_id),
          manager,
        );
        if (
          !parent ||
          parent.actor.kind !== "HUMAN" ||
          parent.actor.principalId !== fact.created_by ||
          !parent.source.intakeDraftId ||
          !Number.isSafeInteger(parent.source.confirmationVersion)
        )
          throw new Error("CORPORATE_NOTIFICATION_CONFIRMATION_REQUIRED");
        await input.guard.assertCommandAllowed(parent);
        const admissions = new PilotCommandAdmissionRepository(input.source),
          admission = await admissions.load(parent, manager);
        if (!admission) throw new Error("PILOT_COMMAND_ADMISSION_REQUIRED");
        const scope = { kind: "PROJECT" as const, workspaceId, projectId },
          access = new TypeOrmScopedAccessRepository(manager),
          now = new Date();
        const project = await access.getProject(scope);
        if (!project || project.state !== "ACTIVE")
          throw new Error("CORPORATE_NOTIFICATION_AUTHORIZATION_DENIED");
        const decision = new DenyByDefaultAuthorizationPolicy().decide({
          context: {
            scope,
            actor: parent.actor,
            correlationId: parent.correlationId,
            causationId: parent.causationId,
          },
          permission: "qa.request.confirm",
          resourceClassification: defaultClassificationCatalog.reference(
            String(fact.classification_key),
          ),
          facts: await access.authorizationFacts(scope, parent.actor.principalId, now),
          at: now,
          policyVersion: "qa-confirmation-notification@1",
          operationClass: "EFFECT",
          projectOperationalState: "ACTIVE",
        });
        if (!decision.allowed || !decision.basis)
          throw new Error("CORPORATE_NOTIFICATION_AUTHORIZATION_DENIED");
        const grants = input.grants.filter(
          ({ binding }) =>
            binding.provider === "MATTERMOST" &&
            binding.workspaceId === workspaceId &&
            binding.projectId === projectId,
        );
        if (grants.length !== 1) throw new Error("CORPORATE_MATTERMOST_BINDING_REQUIRED");
        const grant = grants[0]!;
        const profiles = (await manager.query(
          `SELECT r.content,r.content_hash FROM connector_profile_headers h JOIN connector_profile_revisions r
        ON (r.workspace_id,r.header_id,r.version)=(h.workspace_id,h.id,h.current_published_version)
        WHERE h.workspace_id=$1 AND h.id=$2 AND r.version=$3 AND r.status='PUBLISHED' FOR SHARE OF h,r`,
          [workspaceId, grant.binding.profileRef.id, grant.binding.profileRef.version],
        )) as readonly { content: Record<string, unknown>; content_hash: string }[];
        const profileRow = profiles[0];
        if (
          profiles.length !== 1 ||
          !profileRow ||
          profileRow.content_hash !== grant.binding.profileRef.contentHash ||
          integrationConfigurationHash("connector_profile", profileRow.content) !==
            profileRow.content_hash
        )
          throw new Error("CORPORATE_MATTERMOST_PROFILE_STALE");
        const config = profileRow.content.profileConfiguration
          ? object(profileRow.content.profileConfiguration)
          : profileRow.content;
        const profile = config.value ? object(config.value) : config;
        if (profile.reconciliationMode !== "NONE_AMBIGUOUS")
          throw new Error("MATTERMOST_CORPORATE_RECONCILIATION_NOT_IMPLEMENTED");
        const commandId = uuid(`qa-notification:${workspaceId}:${projectId}:${event.id}`);
        const expiresAt = new Date(new Date(String(event.created_at)).getTime() + 86_400_000);
        if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= now)
          throw new Error("CORPORATE_NOTIFICATION_EVENT_EXPIRED");
        const prepared = buildCorporateQaConfirmationNotification({
          workspaceId,
          projectId,
          draftId: parent.source.intakeDraftId,
          confirmationVersion: parent.source.confirmationVersion!,
          notificationId: `notification:${sha256(String(event.id)).slice(7, 39)}`,
          commandId,
          eventId: String(event.id),
          title: String(fact.title),
          classificationKey: String(fact.classification_key),
          profile,
          expiresAt,
        });
        const base = new TypeOrmUnitOfWork(input.source, manager);
        const unit = {
          find: base.find.bind(base),
          command: base.command.bind(base),
          async commit(value: GatewayCommit) {
            if (
              value.command.id !== commandId ||
              value.command.payloadHash !== prepared.intent.payloadHash ||
              value.command.targetHash !== prepared.intent.targetHash
            )
              throw new Error("CORPORATE_NOTIFICATION_COMMAND_CONFLICT");
            const saved = await new TypeOrmNotificationIntentRepository(input.source).create(
              prepared.intent,
              manager,
            );
            if (saved.replayed) throw new Error("CORPORATE_NOTIFICATION_DEDUPE_CONFLICT");
            await base.commit(value);
            await admissions.insert(manager, value.command, {
              ...admission,
              commandId: value.command.id,
              payloadHash: value.command.payloadHash,
              targetHash: value.command.targetHash,
            });
          },
        };
        const result = await new CommandGateway(
          unit,
          { now: () => now },
          { next: () => commandId },
        ).submit(
          {
            scope,
            actor: parent.actor,
            correlationId: parent.correlationId,
            causationId: parent.causationId,
            authorizationBasis: decision.basis,
          },
          {
            clientRequestKey: `qa-confirmed:${String(event.id)}`,
            commandType: "qa.notification.send",
            capability: {
              key: "messaging.notify",
              exactContractVersion: "1.0.0",
              operation: "notification.send",
              logicalRole: "PILOT_MESSAGING",
            },
            target: prepared.intent.target,
            payload: prepared.payload,
            expectedExternalState: { mode: "NONE_AMBIGUOUS" },
            bindingRef: {
              id: grant.integrationBindingRef.id,
              version: grant.integrationBindingRef.version,
            },
            profileRef: {
              id: grant.binding.profileRef.id,
              version: grant.binding.profileRef.version,
            },
            dataClassificationKey: String(fact.classification_key),
            source: { notificationIntentId: prepared.intent.id },
            recoveryPolicy: "NONE_AMBIGUOUS",
          },
        );
        if (result.replayed) {
          const existing = await new TypeOrmNotificationIntentRepository(input.source).get(
            workspaceId,
            projectId,
            prepared.intent.id,
            undefined,
            manager,
          );
          if (
            !existing ||
            existing.commandId !== result.command.id ||
            existing.payloadHash !== prepared.intent.payloadHash ||
            existing.targetHash !== prepared.intent.targetHash ||
            existing.renderHash !== prepared.intent.renderHash ||
            sha256(existing.templateEvidence as unknown as JsonValue) !==
              sha256(prepared.intent.templateEvidence as unknown as JsonValue)
          )
            throw new Error("CORPORATE_NOTIFICATION_DEDUPE_CONFLICT");
          await input.guard.assertCommandAllowed(result.command);
        }
        await input.guard.assertCommandAllowed(parent);
        await manager.query(
          "INSERT INTO consumer_inbox(consumer_key,message_id,message_hash,processed_at) VALUES('corporate-qa-confirmation-notify',$1,$2,clock_timestamp()) ON CONFLICT DO NOTHING",
          [event.id, event.envelope_hash],
        );
        return 1;
      });
    },
  };
}
