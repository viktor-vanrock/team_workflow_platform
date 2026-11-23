import { describe, expect, it, vi } from "vitest";

import { InMemoryDurableCommandStore } from "../../../packages/platform-core/src/index.ts";
import type { RuntimeEnvironment } from "../../../packages/runtime-composition/src/config/environment.ts";
import { selectRuntimeComposition } from "../../../packages/runtime-composition/src/qa/composition.ts";
import {
  CapabilityCommandRouter,
  defineWorkerContribution,
} from "../../../packages/runtime-composition/src/worker/contributions.ts";

const localEnvironment = Object.freeze({
  profile: "local",
  environmentScope: "LOCAL",
  externalNetworkMode: "deny",
  mockHubUrl: "http://mock-hub:4010",
} as RuntimeEnvironment);

describe("Feature 005 additive worker and composition routing", () => {
  it("preserves every prior composition selector", () => {
    expect(selectRuntimeComposition({}, localEnvironment)).toBe("foundation");
    for (const selector of ["qa-local", "qa-jira-local", "qa-jira-mattermost-local"] as const) {
      expect(selectRuntimeComposition({ AWP_COMPOSITION: selector }, localEnvironment)).toBe(
        selector,
      );
    }

    const { mockHubUrl: _mockHub, ...nonLocalBase } = localEnvironment;
    void _mockHub;
    const nonProdEnvironment = Object.freeze({
      ...nonLocalBase,
      profile: "non-local",
      environmentScope: "NON_PROD",
      externalNetworkMode: "allowlisted",
    } as RuntimeEnvironment);
    for (const selector of ["qa-jira-nonprod", "qa-jira-mattermost-nonprod"] as const) {
      expect(selectRuntimeComposition({ AWP_COMPOSITION: selector }, nonProdEnvironment)).toBe(
        selector,
      );
    }
  });

  it("keeps manual work commandless and routes Jira independently of GitLab", async () => {
    const jiraHandle = vi.fn(async () => "jira");
    const gitLabHandle = vi.fn(async () => "gitlab");
    const router = new CapabilityCommandRouter([
      defineWorkerContribution({
        key: "jira",
        capabilityKeys: ["operational-work-item"],
        recovery: { markedEffectPolicy: "LOOKUP_ONLY" },
        handle: jiraHandle,
      }),
      defineWorkerContribution({
        key: "gitlab",
        capabilityKeys: ["source-context.read", "test-executor.trigger-status", "artifact.ci-read"],
        recovery: { markedEffectPolicy: "LOOKUP_ONLY" },
        handle: gitLabHandle,
      }),
    ]);
    const jiraCommand = {
      ...InMemoryDurableCommandStore.readyFixture().command(),
      capability: {
        key: "operational-work-item",
        exactContractVersion: "1.0.0",
        operation: "request.create",
        logicalRole: "QA_REQUEST_AUTHORITY",
      },
    };

    await expect(router.route(jiraCommand)).resolves.toBe("jira");
    expect(jiraHandle).toHaveBeenCalledOnce();
    expect(gitLabHandle).not.toHaveBeenCalled();
    expect(router.capabilities()).not.toContain("manual");
  });
});
