import { afterEach, describe, expect, it, vi } from "vitest";

import { renderMattermostNotification } from "../../../packages/connector-mattermost/src/notifications/mattermost-notification.ts";
import { designContractRegistry, sha256 } from "../../../packages/platform-contracts/src/index.ts";
import { InMemoryDurableCommandStore } from "../../../packages/platform-core/src/commanding/connector-command.ts";
import {
  createCorporateMattermostTemplateAuthority,
  qaConfirmedTemplateHash,
  qaConfirmedTemplateRef,
} from "../../../packages/runtime-composition/src/mattermost/corporate-template-authority.ts";

afterEach(() => vi.restoreAllMocks());
describe("corporate notification template evidence", () => {
  it("requires exact template, validated variables and matching render hash", async () => {
    const target = { kind: "PROJECT_CHANNEL" as const, purpose: "REQUEST_STATUS" };
    const variables = { title: "Request" },
      payload = { template: "QA_REQUEST_CONFIRMED", variables };
    const schemaRef = { id: "schema", version: 1, digest: `sha256:${"a".repeat(64)}` as const };
    const renderHash = sha256(
      new TextDecoder().decode(
        renderMattermostNotification({ target, template: "QA_REQUEST_CONFIRMED", variables }).bytes,
      ),
    );
    const evidence = {
      templateRef: qaConfirmedTemplateRef,
      templateHash: qaConfirmedTemplateHash,
      variablesSchemaRef: schemaRef,
      variablesHash: sha256(variables),
      renderHash,
    };
    const command = {
      ...InMemoryDurableCommandStore.readyFixture().command(),
      target,
      payload,
      source: { notificationIntentId: "intent" },
    };
    const query = vi.fn(async () => [
      {
        template_evidence: evidence,
        target_hash: command.targetHash,
        payload_hash: command.payloadHash,
        render_hash: renderHash,
      },
    ]);
    vi.spyOn(designContractRegistry, "validate").mockReturnValue(variables);
    const authority = createCorporateMattermostTemplateAuthority({
      isInitialized: true,
      query,
    } as never);
    const profile = {
      templates: [
        {
          templateRef: qaConfirmedTemplateRef,
          templateHash: qaConfirmedTemplateHash,
          variablesSchemaRef: schemaRef,
        },
      ],
    };
    expect(await authority.verify(command as never, profile)).toBe(true);
    expect(
      await authority.verify(
        { ...command, payload: { ...payload, variables: { title: "changed" } } } as never,
        profile,
      ),
    ).toBe(false);
    query.mockResolvedValue([
      {
        template_evidence: undefined,
        target_hash: command.targetHash,
        payload_hash: command.payloadHash,
        render_hash: renderHash,
      },
    ] as never);
    expect(await authority.verify(command as never, profile)).toBe(false);
  });
});
