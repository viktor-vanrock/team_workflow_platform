export * from "./auth/mattermost-auth.ts";
export * from "./http/mattermost-rest-client.ts";
export * from "./ingress/callback-auth.ts";
export * from "./ingress/dialog-submission.ts";
export * from "./ingress/post-action.ts";
export * from "./manifest.ts";
export * from "./notifications/mattermost-notification.ts";
export * from "./presentation/mattermost-presentation.ts";
export * from "./profile/mattermost-discovery.ts";
export * from "./profile/mattermost-profile-validator.ts";
export * from "./reconciliation/mattermost-reconciliation.ts";

export const connectorMattermostPackage = Object.freeze({
  key: "mattermost.hermes-intake",
  version: "1.0.0",
});
