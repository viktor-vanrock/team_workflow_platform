import { describe, expect, it } from "vitest";

import {
  MattermostRestClient,
  renderMattermostNotification,
} from "../../../../packages/connector-mattermost/src/index.ts";
import { InMemoryExactWebhookInbox } from "../../../../packages/platform-core/src/events/webhook-ingress.ts";
import {
  createHermesSkillRegistry,
  PromptManifestBuilder,
} from "../../../../packages/runtime-composition/src/index.ts";

describe("004 connector/prompt capture hardening", () => {
  it("rejects redirects, callback replays and unsafe provider routes", async () => {
    const client = new MattermostRestClient({
      baseUrl: "http://127.0.0.1:4010",
      environmentClass: "LOCAL",
      allowedHosts: ["127.0.0.1"],
      credential: {
        use: async <T>(callback: (token: string) => Promise<T>) => await callback("secret"),
      },
      fetcher: async () =>
        new Response(null, { status: 302, headers: { location: "https://evil.invalid" } }),
    });
    await expect(client.get("/api/v4/system/ping")).rejects.toThrow(
      "MATTERMOST_REDIRECT_FORBIDDEN",
    );
    expect(() =>
      renderMattermostNotification({
        target: { kind: "PROJECT_CHANNEL", purpose: "QA" },
        template: "DELIVERY_HEALTH",
        variables: { accessToken: "secret" },
      }),
    ).toThrow("MATTERMOST_NOTIFICATION_VARIABLE_FORBIDDEN");
    const inbox = new InMemoryExactWebhookInbox({ maxBytes: 100, retryHorizonMs: 1000 });
    const receipt = {
      connectionId: "c",
      deliveryId: "d",
      rawBytes: new Uint8Array([1]),
      bodyHash: "h1",
      contentType: "application/json",
      receivedAt: new Date(),
    };
    await inbox.persist(receipt);
    await expect(
      inbox.persist({ ...receipt, rawBytes: new Uint8Array([2]), bodyHash: "h2" }),
    ).rejects.toThrow("DELIVERY_HASH_CONFLICT");
  });
  it("does not retain raw tokens/history/attachments/prompts", () => {
    const subject = {
      kind: "DRAFT" as const,
      id: "d",
      version: 1,
      contentHash: "sha256:d",
      aggregateSnapshotHash: "sha256:s",
    };
    const value = new PromptManifestBuilder().build({
      workspaceId: "w",
      projectId: "p",
      subject,
      skill: createHermesSkillRegistry().resolve("qa-triage", "1.0.0"),
      facts: [
        {
          sourceKind: "DRAFT",
          sourceRef: "d",
          sourceVersion: "1",
          sourceHash: "sha256:d",
          classification: "INTERNAL",
          key: "summary",
          value: "safe",
        },
      ],
      allowedFactKeys: ["summary"],
      maximumClassification: "INTERNAL",
      createdAt: new Date(),
    });
    expect(JSON.stringify(value)).not.toMatch(/token|rawHistory|attachmentBody|renderedPrompt/iu);
  });
});
