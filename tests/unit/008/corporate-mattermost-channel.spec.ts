import { describe, expect, it } from "vitest";
import { resolveCorporateMattermostChannel } from "../../../packages/runtime-composition/src/mattermost/corporate-channel.ts";

describe("corporate Mattermost channel", () => {
  const profile = {
    schemaVersion: "mattermost-profile@1.0.0",
    workspaceId: "workspace",
    projectId: "project",
    environmentClass: "DEVELOPMENT",
    productionDenied: true,
    templates: [
      {
        templateRef: "qa.intake.confirmed@1",
        templateHash: `sha256:${"a".repeat(64)}`,
        audiences: ["QA_PROJECT_MEMBERS"],
        classificationCeiling: "INTERNAL",
      },
    ],
    channelBindings: [
      {
        channelId: "channel",
        channelKind: "PRIVATE",
        purpose: "REQUEST_STATUS",
        audience: "QA_PROJECT_MEMBERS",
        classificationCeiling: "INTERNAL",
      },
    ],
  };
  const input = {
    workspaceId: "workspace",
    projectId: "project",
    target: { kind: "PROJECT_CHANNEL" as const, purpose: "REQUEST_STATUS" },
    classificationKey: "INTERNAL",
    profile,
  };
  it("resolves the project channel from the profile", () =>
    expect(resolveCorporateMattermostChannel(input)).toBe("channel"));
  it("rejects cross-project, production, missing and ambiguous channel bindings", () => {
    expect(() => resolveCorporateMattermostChannel({ ...input, projectId: "other" })).toThrow(
      "MATTERMOST_CORPORATE_PROFILE_INVALID",
    );
    expect(() =>
      resolveCorporateMattermostChannel({
        ...input,
        profile: { ...profile, environmentClass: "PRODUCTION" },
      }),
    ).toThrow("MATTERMOST_CORPORATE_PROFILE_INVALID");
    expect(() =>
      resolveCorporateMattermostChannel({ ...input, profile: { ...profile, channelBindings: [] } }),
    ).toThrow("MATTERMOST_CORPORATE_CHANNEL_AMBIGUOUS");
    expect(() =>
      resolveCorporateMattermostChannel({
        ...input,
        profile: {
          ...profile,
          channelBindings: [...profile.channelBindings, ...profile.channelBindings],
        },
      }),
    ).toThrow("MATTERMOST_CORPORATE_CHANNEL_AMBIGUOUS");
  });
  it("rejects confidential content and unimplemented private destinations", () => {
    expect(() =>
      resolveCorporateMattermostChannel({ ...input, classificationKey: "CONFIDENTIAL" }),
    ).toThrow("MATTERMOST_CORPORATE_CLASSIFICATION_DENIED");
    expect(() =>
      resolveCorporateMattermostChannel({
        ...input,
        target: { kind: "PRINCIPAL_DM", principalId: "person" },
      }),
    ).toThrow("MATTERMOST_CORPORATE_TARGET_UNSUPPORTED");
  });
});
