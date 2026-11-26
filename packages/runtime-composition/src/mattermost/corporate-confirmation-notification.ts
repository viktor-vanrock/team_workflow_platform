import { renderMattermostNotification } from "@awp/connector-mattermost";
import { designContractRegistry, sha256 } from "@awp/platform-contracts";
import { NotificationIntentAggregate, type NotificationIntentSnapshot } from "@awp/platform-core";
import { resolveCorporateMattermostChannel } from "./corporate-channel.ts";
import { qaConfirmedTemplateHash, qaConfirmedTemplateRef } from "./corporate-template-authority.ts";

const variablesSchemaId = "urn:awp:schemas:004:qa-intake-partial-content:v1";

/** Builds only the approved confirmation template and never accepts a provider destination. */
export function buildCorporateQaConfirmationNotification(
  input: Readonly<{
    workspaceId: string;
    projectId: string;
    draftId: string;
    confirmationVersion: number;
    notificationId: string;
    commandId: string;
    eventId: string;
    title: string;
    classificationKey: string;
    profile: Readonly<Record<string, unknown>>;
    expiresAt: Date;
  }>,
): Readonly<{
  intent: NotificationIntentSnapshot;
  payload: Readonly<{
    template: "QA_REQUEST_CONFIRMED";
    variables: Readonly<{ schemaVersion: 1; title: string }>;
  }>;
}> {
  if (
    !input.draftId ||
    !input.notificationId ||
    !input.commandId ||
    !input.eventId ||
    !Number.isSafeInteger(input.confirmationVersion) ||
    input.confirmationVersion < 1 ||
    !input.title ||
    input.title.length > 200 ||
    /[\r\n<>@`\[\]()*_~\\]|https?:\/\//iu.test(input.title) ||
    !Number.isFinite(input.expiresAt.getTime())
  )
    throw new Error("CORPORATE_NOTIFICATION_INPUT_INVALID");
  const target = Object.freeze({ kind: "PROJECT_CHANNEL" as const, purpose: "REQUEST_STATUS" });
  resolveCorporateMattermostChannel({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    target,
    classificationKey: input.classificationKey,
    profile: input.profile,
  });
  const templates = Array.isArray(input.profile.templates) ? input.profile.templates : [];
  const approved = templates.filter(
    (item) =>
      item &&
      typeof item === "object" &&
      !Array.isArray(item) &&
      (item as Record<string, unknown>).templateRef === qaConfirmedTemplateRef &&
      (item as Record<string, unknown>).templateHash === qaConfirmedTemplateHash,
  );
  if (approved.length !== 1) throw new Error("CORPORATE_NOTIFICATION_TEMPLATE_UNAPPROVED");
  const schemaRef = {
    id: variablesSchemaId,
    version: 1,
    digest: designContractRegistry.digest(variablesSchemaId),
  };
  if (
    sha256((approved[0] as Record<string, unknown>).variablesSchemaRef as never) !==
    sha256(schemaRef)
  )
    throw new Error("CORPORATE_NOTIFICATION_SCHEMA_UNAPPROVED");
  const variables = Object.freeze({ schemaVersion: 1 as const, title: input.title });
  designContractRegistry.validate({ schemaRef, value: variables });
  const payload = Object.freeze({ template: "QA_REQUEST_CONFIRMED" as const, variables });
  const render = new TextDecoder().decode(
    renderMattermostNotification({ target, template: payload.template, variables }).bytes,
  );
  const evidence = Object.freeze({
    templateRef: qaConfirmedTemplateRef,
    templateHash: qaConfirmedTemplateHash,
    variablesSchemaRef: schemaRef,
    variablesHash: sha256(variables),
    renderHash: sha256(render),
  });
  const intent = NotificationIntentAggregate.create({
    id: input.notificationId,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    dedupeKey: `qa-confirmed:${input.eventId}`,
    sourceEventRef: `draft:${input.draftId}:confirmed:${input.confirmationVersion}`,
    target,
    payload,
    render,
    templateEvidence: evidence,
    commandId: input.commandId,
    expiresAt: input.expiresAt,
  }).snapshot();
  return Object.freeze({ intent, payload });
}
