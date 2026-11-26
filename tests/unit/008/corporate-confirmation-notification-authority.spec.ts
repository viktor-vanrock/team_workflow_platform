import { afterEach, describe, expect, it, vi } from "vitest";

import { InMemoryDurableCommandStore } from "../../../packages/platform-core/src/commanding/connector-command.ts";
import { DenyByDefaultAuthorizationPolicy } from "../../../packages/platform-core/src/identity-access/authorization-policy.ts";
import { TypeOrmScopedAccessRepository } from "../../../packages/platform-persistence-typeorm/src/index.ts";
import { createCorporateQaConfirmationNotificationAuthority } from "../../../packages/runtime-composition/src/mattermost/corporate-confirmation-authority.ts";

afterEach(() => vi.restoreAllMocks());
describe("corporate notification authorization", () => {
  const environment = {
    profile: "non-local",
    environmentScope: "NON_PROD",
    deployment: { workspaceId: "workspace", projectIds: ["project"] },
  };
  const fixture = () => ({
    ...InMemoryDurableCommandStore.readyFixture().command(),
    workspaceId: "workspace",
    projectId: "project",
    actor: { kind: "HUMAN" as const, principalId: "person", issuer: "issuer", subject: "subject" },
    capability: {
      key: "messaging.notify",
      operation: "notification.send",
      exactContractVersion: "1.0.0",
      logicalRole: "PILOT_MESSAGING",
    },
    payload: {
      template: "QA_REQUEST_CONFIRMED",
      variables: { schemaVersion: 1, title: "Request" },
    },
    source: { notificationIntentId: "intent" },
    dataClassificationKey: "INTERNAL",
  });
  it("reauthorizes the same requester after verifying the confirmed request", async () => {
    const command = fixture();
    const query = vi.fn(async () => [{ title: "Request" }]);
    vi.spyOn(TypeOrmScopedAccessRepository.prototype, "getProject").mockResolvedValue({
      state: "ACTIVE",
    } as never);
    vi.spyOn(TypeOrmScopedAccessRepository.prototype, "authorizationFacts").mockResolvedValue(
      {} as never,
    );
    const basis = { kind: "PROJECT" };
    const decide = vi
      .spyOn(DenyByDefaultAuthorizationPolicy.prototype, "decide")
      .mockReturnValue({ allowed: true, basis } as never);
    const authority = createCorporateQaConfirmationNotificationAuthority(
      { isInitialized: true, query } as never,
      environment as never,
    );
    expect((await authority.revalidate(command as never)).authorizationBasis).toBe(basis);
    expect(decide.mock.calls[0]?.[0].permission).toBe("qa.request.confirm");
    expect(query.mock.calls.length).toBe(1);
  });
  it("rejects other templates and mismatched request titles", async () => {
    const command = fixture();
    const query = vi.fn(async () => [{ title: "Different" }]);
    const authority = createCorporateQaConfirmationNotificationAuthority(
      { isInitialized: true, query } as never,
      environment as never,
    );
    await expect(
      authority.revalidate({
        ...command,
        payload: { template: "DELIVERY_HEALTH", variables: {} },
      } as never),
    ).rejects.toThrow("CORPORATE_NOTIFICATION_TYPE_DENIED");
    await expect(authority.revalidate(command as never)).rejects.toThrow(
      "CORPORATE_NOTIFICATION_CONFIRMATION_REQUIRED",
    );
    await expect(
      authority.revalidate({
        ...command,
        payload: { template: "QA_REQUEST_CONFIRMED", variables: { title: "Request" } },
      } as never),
    ).rejects.toThrow("CORPORATE_NOTIFICATION_TYPE_DENIED");
    await expect(
      authority.revalidate({
        ...command,
        payload: {
          template: "QA_REQUEST_CONFIRMED",
          variables: { title: "@all\nhttps://example.com" },
        },
      } as never),
    ).rejects.toThrow("CORPORATE_NOTIFICATION_TYPE_DENIED");
  });
});
