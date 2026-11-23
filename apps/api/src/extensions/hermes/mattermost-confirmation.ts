import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import type { DataSource, EntityManager } from "typeorm";

import {
  confirmQaIntake,
  type QaConfirmedDraft,
  type QaIntakePayload,
  QaProjectPolicyRepository,
  type QaWorkspaceContext,
  validateConfirmedQaIntake,
} from "@awp/competency-qa/node";
import { CommandGateway, type CommandIntent, type WorkspaceContext } from "@awp/platform-core";
import { TypeOrmUnitOfWork } from "@awp/platform-persistence-typeorm";

import { digest, object, reject, uuid } from "../onboarding/durable-http.ts";
import type { QaIntakeConfiguration } from "../qa-intake-configuration.ts";
import type { HermesMattermostBinding } from "./mattermost-config.ts";
import { readMattermostProjectContext } from "./project-context-reader.ts";

type Confirmation = {
  draftId: string;
  principalId: string;
  identityVersion: number;
  snapshotHash: string;
  expiresAt: number;
};
const sign = (binding: HermesMattermostBinding, payload: string) =>
  createHmac("sha256", binding.token)
    .update(
      `hermes-mm-confirm-v1:${binding.key}:${binding.version}:${binding.teamId}:${binding.channelId}:${payload}`,
    )
    .digest("base64url");
function ticket(binding: HermesMattermostBinding, value: Confirmation) {
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${payload}.${sign(binding, payload)}`;
}
function verify(binding: HermesMattermostBinding, value: string): Confirmation {
  const [payload, signature, extra] = value.split(".");
  if (!payload || !signature || extra || value.length > 1800)
    return reject("HERMES_CONFIRMATION_INVALID", 403);
  const expected = Buffer.from(sign(binding, payload)),
    actual = Buffer.from(signature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    return reject("HERMES_CONFIRMATION_INVALID", 403);
  let parsed: Record<string, unknown>;
  try {
    parsed = object(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")), [
      "draftId",
      "principalId",
      "identityVersion",
      "snapshotHash",
      "expiresAt",
    ]);
  } catch {
    return reject("HERMES_CONFIRMATION_INVALID", 403);
  }
  if (
    !Number.isSafeInteger(parsed.expiresAt) ||
    Number(parsed.expiresAt) < Date.now() ||
    Number(parsed.expiresAt) > Date.now() + 600_000 ||
    !Number.isSafeInteger(parsed.identityVersion) ||
    !/^sha256:[a-f0-9]{64}$/u.test(String(parsed.snapshotHash))
  )
    return reject("HERMES_CONFIRMATION_EXPIRED", 403);
  return {
    draftId: uuid(parsed.draftId),
    principalId: uuid(parsed.principalId),
    identityVersion: Number(parsed.identityVersion),
    snapshotHash: String(parsed.snapshotHash),
    expiresAt: Number(parsed.expiresAt),
  };
}
async function snapshot(
  manager: EntityManager,
  binding: HermesMattermostBinding,
  externalUserId: string,
  draftId: string,
  configuration: QaIntakeConfiguration,
) {
  const current = await readMattermostProjectContext(
    manager,
    binding,
    externalUserId,
    "qa.request.confirm",
  );
  const [row] = (await manager.query(
    "SELECT d.id,d.created_by,d.row_version,d.current_revision,d.current_content_hash,d.intake_payload FROM intake_drafts d WHERE workspace_id=$1 AND project_id=$2 AND id=$3 FOR UPDATE",
    [binding.workspaceId, binding.projectId, draftId],
  )) as {
    id: string;
    created_by: string;
    row_version: number;
    current_revision: number;
    current_content_hash: string;
    intake_payload: QaIntakePayload;
  }[];
  if (!row || row.created_by !== current.principalId)
    return reject("HERMES_DRAFT_OWNER_REQUIRED", 403);
  const selected = await configuration.load(binding),
    policy = await new QaProjectPolicyRepository(manager).currentProjectContext(
      binding,
      selected.projectContextId,
    );
  if (!policy || selected.inlineService) return reject("HERMES_DURABLE_JIRA_REQUIRED", 409);
  const [profile] = (await manager.query(
    "SELECT content,content_hash FROM connector_profile_revisions WHERE workspace_id=$1 AND header_id=$2 AND version=$3 AND status='PUBLISHED'",
    [binding.workspaceId, selected.profileRef.id, selected.profileRef.version],
  )) as {
    content: {
      connectorKey?: string;
      project?: { id?: string; name?: string };
      issueType?: { id?: string; name?: string };
    };
    content_hash: string;
  }[];
  if (
    !profile?.content.connectorKey?.startsWith("jira.") ||
    !profile.content.project?.id ||
    !profile.content.issueType?.id
  )
    return reject("HERMES_JIRA_TARGET_REQUIRED", 409);
  const context: QaWorkspaceContext = {
    actor: current.authority.actor,
    scope: { kind: "PROJECT", workspaceId: binding.workspaceId, projectId: binding.projectId },
    authorizationBasis: current.authority.basis,
    correlationId: randomUUID(),
    causationId: randomUUID(),
  };
  const draft: QaConfirmedDraft = {
    id: draftId,
    version: row.row_version,
    contentHash: digest(row.intake_payload),
    workspaceId: binding.workspaceId,
    projectId: binding.projectId,
    definitionRef: { key: "qa.validation", version: "1.0.0" },
    state: "CONFIRMED",
    requester: current.authority.actor,
    payload: row.intake_payload,
    authoritativeClassificationKey: current.authority.classification,
  };
  const evaluatedAt = new Date().toISOString();
  const validated = await validateConfirmedQaIntake({
    context,
    draft,
    projectContext: policy,
    responseChannels: selected.responseChannels,
    bindingRef: selected.bindingRef,
    evaluatedAt,
  });
  const stable = await selected.commandIdentity({
    sourceId: draftId,
    confirmationVersion: draft.version,
  });
  const snapshotHash = digest({
    scope: binding.projectId,
    workspace: binding.workspaceId,
    externalUserId,
    principalId: current.principalId,
    identityVersion: current.identityVersion,
    draftId,
    revision: row.current_revision,
    hash: row.current_content_hash,
    target: validated.target,
    payload: validated.createInput,
    bindingRef: selected.bindingRef,
    profileRef: selected.profileRef,
    profileHash: profile.content_hash,
    policyHash: policy.contentHash,
    stable,
  });
  return {
    current,
    row,
    selected,
    policy,
    context,
    draft,
    evaluatedAt,
    validated,
    stable,
    snapshotHash,
    profile: profile.content,
  };
}
export async function previewMattermostRequest(
  source: DataSource,
  binding: HermesMattermostBinding,
  externalUserId: string,
  draftId: string,
  configuration?: QaIntakeConfiguration,
) {
  if (!configuration)
    return {
      response_type: "ephemeral",
      text: "Черновик сохранён. Создание в Jira пока недоступно: подключите опубликованный Jira profile, QA policy и durable worker. Подтверждение не выдано.",
    };
  return source.transaction(async (manager) => {
    const value = await snapshot(manager, binding, externalUserId, uuid(draftId), configuration);
    const confirmation = ticket(binding, {
      draftId,
      principalId: value.current.principalId,
      identityVersion: value.current.identityVersion,
      snapshotHash: value.snapshotHash,
      expiresAt: Date.now() + 600_000,
    });
    const safe = (v: unknown) => JSON.stringify(v).replace(/`/gu, "\\u0060");
    return {
      response_type: "ephemeral",
      text: `Проверьте задачу перед созданием. Проект платформы: ${safe(value.current.context.key)}. Jira: ${safe(value.profile.project)}; тип: ${safe(value.profile.issueType)}.\nПоля запроса: ${safe(value.draft.payload)}\nТочные поля команды: ${safe(value.validated.createInput)}\nСоздание выполнится только по вашей команде (действует 10 минут):\n\`/hermes confirm ${confirmation}\``,
    };
  });
}
export async function confirmMattermostRequest(
  source: DataSource,
  binding: HermesMattermostBinding,
  externalUserId: string,
  token: string,
  configuration?: QaIntakeConfiguration,
) {
  if (!configuration) return reject("HERMES_DURABLE_JIRA_REQUIRED", 409);
  const proof = verify(binding, token);
  return source.transaction("SERIALIZABLE", async (manager) => {
    const value = await snapshot(manager, binding, externalUserId, proof.draftId, configuration);
    if (
      value.current.principalId !== proof.principalId ||
      value.current.identityVersion !== proof.identityVersion ||
      value.snapshotHash !== proof.snapshotHash
    )
      return reject("HERMES_CONFIRMATION_STALE", 409);
    const uow = new TypeOrmUnitOfWork(source, manager),
      gateway = new CommandGateway(
        uow,
        { now: () => new Date(value.evaluatedAt) },
        { next: () => value.stable.commandId },
      );
    const result = await confirmQaIntake({
      context: value.context,
      draft: value.draft,
      projectContext: value.policy,
      responseChannels: value.selected.responseChannels,
      bindingRef: value.selected.bindingRef,
      profileRef: value.selected.profileRef,
      clientRequestKey: `hermes-mm-confirm:${proof.draftId}:${proof.snapshotHash}`,
      evaluatedAt: value.evaluatedAt,
      commandGateway: {
        submit: async (context, intent) => {
          const existing = await uow.command(
            binding.workspaceId,
            binding.projectId,
            value.stable.commandId,
          );
          if (existing) {
            if (
              digest(existing.payload) !== digest(intent.payload) ||
              digest(existing.target) !== digest(intent.target) ||
              digest(existing.bindingRef) !== digest(intent.bindingRef) ||
              digest(existing.profileRef) !== digest(intent.profileRef)
            )
              return reject("HERMES_CONFIRMATION_STALE", 409);
            return {
              commandId: existing.id,
              effectIdempotencyKey: existing.effectIdempotencyKey,
              status: existing.status,
              replayed: true,
            };
          }
          const submission = await gateway.submit(
            context as unknown as WorkspaceContext,
            intent as unknown as CommandIntent,
          );
          return {
            commandId: submission.command.id,
            effectIdempotencyKey: submission.command.effectIdempotencyKey,
            status: submission.command.status,
            replayed: submission.replayed,
          };
        },
      },
    });
    return {
      response_type: "ephemeral",
      text: `Подтверждение принято. Команда создания Jira: ${result.command.commandId}; состояние: ${result.command.status}. Повтор не создаёт вторую задачу. Фактический результат появится после выполнения Jira Connector.`,
    };
  });
}
