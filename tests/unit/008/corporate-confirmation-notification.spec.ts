import { describe, expect, it } from "vitest";
import { designContractRegistry, sha256 } from "../../../packages/platform-contracts/src/index.ts";
import { buildCorporateQaConfirmationNotification } from "../../../packages/runtime-composition/src/mattermost/corporate-confirmation-notification.ts";
import {
  qaConfirmedTemplateHash,
  qaConfirmedTemplateRef,
} from "../../../packages/runtime-composition/src/mattermost/corporate-template-authority.ts";

describe("corporate QA confirmation notification", () => {
  const schemaId = "urn:awp:schemas:004:qa-intake-partial-content:v1";
  const profile = {
    schemaVersion: "mattermost-profile@1.0.0",
    workspaceId: "workspace",
    projectId: "project",
    environmentClass: "DEVELOPMENT",
    productionDenied: true,
    channelBindings: [
      {
        channelId: "channel",
        channelKind: "PRIVATE",
        purpose: "REQUEST_STATUS",
        audience: "QA_PROJECT_MEMBERS",
        classificationCeiling: "INTERNAL",
      },
    ],
    templates: [
      {
        templateRef: qaConfirmedTemplateRef,
        templateHash: qaConfirmedTemplateHash,
        classificationCeiling: "INTERNAL",
        audiences: ["QA_PROJECT_MEMBERS"],
        variablesSchemaRef: {
          id: schemaId,
          version: 1,
          digest: designContractRegistry.digest(schemaId),
        },
      },
    ],
  };
  const input = {
    workspaceId: "workspace",
    projectId: "project",
    draftId: "draft",
    confirmationVersion: 1,
    notificationId: "intent",
    commandId: "command",
    eventId: "event",
    title: "Request",
    classificationKey: "INTERNAL",
    profile,
    expiresAt: new Date("2099-01-01T00:00:00Z"),
  };
  it("creates exact template, variable and render commitments", () => {
    const result = buildCorporateQaConfirmationNotification(input);
    expect(result.intent.payloadHash).toBe(sha256(result.payload));
    expect(result.intent.templateEvidence).toMatchObject({
      templateRef: qaConfirmedTemplateRef,
      templateHash: qaConfirmedTemplateHash,
      variablesHash: sha256(result.payload.variables),
      renderHash: result.intent.renderHash,
    });
    expect(result.intent.target).toEqual({ kind: "PROJECT_CHANNEL", purpose: "REQUEST_STATUS" });
  });
  it("rejects unapproved templates and arbitrary mention content", () => {
    expect(() => buildCorporateQaConfirmationNotification({ ...input, title: "@all" })).toThrow(
      "CORPORATE_NOTIFICATION_INPUT_INVALID",
    );
    expect(() =>
      buildCorporateQaConfirmationNotification({
        ...input,
        profile: {
          ...profile,
          templates: [{ ...profile.templates[0], templateHash: `sha256:${"f".repeat(64)}` }],
        },
      }),
    ).toThrow("CORPORATE_NOTIFICATION_TEMPLATE_UNAPPROVED");
  });
});
