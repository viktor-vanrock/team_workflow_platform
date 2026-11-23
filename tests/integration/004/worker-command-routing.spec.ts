import { describe, expect, it, vi } from "vitest";

import { InMemoryDurableCommandStore } from "../../../packages/platform-core/src/index.ts";
import {
  CapabilityCommandRouter,
  defineWorkerContribution,
} from "../../../packages/runtime-composition/src/worker/contributions.ts";

describe("capability worker routing", () =>
  it("prevents Jira workers claiming Mattermost commands", async () => {
    const jiraHandle = vi.fn();
    const mattermostHandle = vi.fn();
    const jira = defineWorkerContribution({
      key: "jira",
      capabilityKeys: ["operational-work-item"],
      recovery: { markedEffectPolicy: "LOOKUP_ONLY" },
      handle: jiraHandle,
    });
    const mattermost = defineWorkerContribution({
      key: "mattermost",
      capabilityKeys: ["messaging.notify"],
      recovery: { markedEffectPolicy: "LOOKUP_ONLY" },
      handle: mattermostHandle,
    });
    const router = new CapabilityCommandRouter([jira, mattermost]);
    const command = {
      ...InMemoryDurableCommandStore.readyFixture().command(),
      capability: {
        key: "messaging.notify",
        exactContractVersion: "1.0.0",
        operation: "notification.send",
        logicalRole: "NOTIFICATION_MESSAGING",
      },
    };
    await router.route(command);
    expect(jiraHandle).not.toHaveBeenCalled();
    expect(mattermostHandle).toHaveBeenCalledOnce();
  }));
