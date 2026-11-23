import { type MessagingLogicalTarget, validateMessagingTarget } from "@awp/connector-sdk";

import { renderMattermostPresentation } from "../presentation/mattermost-presentation.ts";

const templates = Object.freeze({
  QA_REQUEST_CONFIRMED: (v: Readonly<Record<string, unknown>>) =>
    `QA request confirmed: ${String(v.title ?? "")}`,
  CANDIDATE_DISCOVERED: (v: Readonly<Record<string, unknown>>) =>
    `QA candidate: ${String(v.title ?? "")}`,
  DELIVERY_HEALTH: (v: Readonly<Record<string, unknown>>) =>
    `Delivery status: ${String(v.status ?? "")}`,
});
export function renderMattermostNotification(input: {
  target: MessagingLogicalTarget;
  template: keyof typeof templates;
  variables: Readonly<Record<string, unknown>>;
}) {
  validateMessagingTarget(input.target);
  if (Object.keys(input.variables).some((key) => /token|secret|url|channelId/iu.test(key)))
    throw new Error("MATTERMOST_NOTIFICATION_VARIABLE_FORBIDDEN");
  return renderMattermostPresentation({
    target: input.target,
    title: "AWP QA",
    body: templates[input.template](input.variables),
  });
}

export function classifyMattermostNotificationFailure(
  error: unknown,
  invocationMarked: boolean,
): Readonly<{ outcome: "FAILED_RETRYABLE" | "FAILED_FINAL" | "LOOKUP_REQUIRED"; code: string }> {
  const code = error instanceof Error ? error.message : "MATTERMOST_DELIVERY_FAILED";
  if (invocationMarked) return Object.freeze({ outcome: "LOOKUP_REQUIRED", code });
  if (/401|403|AUTHENTICATION|PERMISSION|SCHEMA|POLICY/iu.test(code))
    return Object.freeze({ outcome: "FAILED_FINAL", code });
  return Object.freeze({ outcome: "FAILED_RETRYABLE", code });
}
