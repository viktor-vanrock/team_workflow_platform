import { type MessagingLogicalTarget, validateMessagingTarget } from "@awp/connector-sdk";
import { defaultClassificationCatalog } from "@awp/platform-core";

/** Route only through the exact published profile; a browser never supplies a channel id. */
export function resolveCorporateMattermostChannel(
  input: Readonly<{
    workspaceId: string;
    projectId: string;
    target: MessagingLogicalTarget;
    classificationKey: string;
    profile: Readonly<Record<string, unknown>>;
  }>,
): string {
  const target = validateMessagingTarget(input.target);
  if (target.kind !== "PROJECT_CHANNEL") throw new Error("MATTERMOST_CORPORATE_TARGET_UNSUPPORTED");
  const profile = input.profile;
  if (
    profile.schemaVersion !== "mattermost-profile@1.0.0" ||
    profile.workspaceId !== input.workspaceId ||
    profile.projectId !== input.projectId ||
    !["DEVELOPMENT", "TEST"].includes(String(profile.environmentClass)) ||
    profile.productionDenied !== true ||
    !Array.isArray(profile.channelBindings)
  )
    throw new Error("MATTERMOST_CORPORATE_PROFILE_INVALID");
  const bindings = profile.channelBindings.filter(
    (value): value is Record<string, unknown> =>
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      (value as Record<string, unknown>).purpose === target.purpose,
  );
  if (bindings.length !== 1) throw new Error("MATTERMOST_CORPORATE_CHANNEL_AMBIGUOUS");
  const binding = bindings[0]!;
  if (
    typeof binding.channelId !== "string" ||
    !/^[A-Za-z0-9_-]{1,128}$/u.test(binding.channelId) ||
    !["PUBLIC", "PRIVATE"].includes(String(binding.channelKind)) ||
    !["QA_PROJECT_MEMBERS", "QA_LEADS"].includes(String(binding.audience))
  )
    throw new Error("MATTERMOST_CORPORATE_CHANNEL_INVALID");
  if (
    !defaultClassificationCatalog.permits(
      defaultClassificationCatalog.reference(String(binding.classificationCeiling)),
      defaultClassificationCatalog.reference(input.classificationKey),
    )
  )
    throw new Error("MATTERMOST_CORPORATE_CLASSIFICATION_DENIED");
  if (!Array.isArray(profile.templates)) throw new Error("MATTERMOST_CORPORATE_TEMPLATE_REQUIRED");
  const templates = profile.templates.filter(
    (value): value is Record<string, unknown> =>
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      (value as Record<string, unknown>).templateRef === "qa.intake.confirmed@1",
  );
  if (
    templates.length !== 1 ||
    typeof templates[0]!.templateHash !== "string" ||
    !/^sha256:[a-f0-9]{64}$/u.test(templates[0]!.templateHash) ||
    !Array.isArray(templates[0]!.audiences) ||
    !templates[0]!.audiences.includes(binding.audience) ||
    !defaultClassificationCatalog.permits(
      defaultClassificationCatalog.reference(String(templates[0]!.classificationCeiling)),
      defaultClassificationCatalog.reference(input.classificationKey),
    )
  )
    throw new Error("MATTERMOST_CORPORATE_TEMPLATE_REQUIRED");
  return binding.channelId;
}
