import { describe, expect, it } from "vitest";

import {
  classifyMattermostReconciliation,
  mattermostReconciliationAuthorizesResend,
  renderMattermostNotification,
  renderMattermostPresentation,
} from "../../../packages/connector-mattermost/src/index.ts";

describe("US4 notification delivery contract", () => {
  it("separates MESSAGE from bounded INTERACTION_PRESENTATION", () => {
    const message = renderMattermostNotification({
      target: { kind: "PROJECT_CHANNEL", purpose: "QA_COORDINATION" },
      template: "DELIVERY_HEALTH",
      variables: { status: "HEALTHY" },
    });
    const interactive = renderMattermostPresentation({
      target: { kind: "PRINCIPAL_DM", principalId: "person" },
      title: "Candidate",
      body: "Choose",
      actions: [{ id: "create", label: "Create" }],
    });
    expect(message.actions).toEqual([]);
    expect(interactive.actions).toHaveLength(1);
    expect(message.capture).toBe("SUPPRESSED");
  });
  it.each([
    [true, 0, "ZERO_MATCHES"],
    [true, 2, "MULTIPLE_MATCHES"],
    [false, 0, "LOOKUP_UNSUPPORTED"],
  ] as const)("makes lookup supported=%s matches=%s terminal", (supported, count, code) => {
    const outcome = classifyMattermostReconciliation({
      supported,
      matches: Array.from({ length: count }, (_, i) => ({
        kind: "MESSAGE" as const,
        opaqueId: `post-${i}`,
      })),
    });
    expect(outcome).toMatchObject({ outcome: "AMBIGUOUS", code });
    expect(mattermostReconciliationAuthorizesResend()).toBe(false);
  });
});
