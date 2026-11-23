import { describe, expect, it } from "vitest";

import { renderMattermostNotification } from "../../../packages/connector-mattermost/src/notifications/mattermost-notification.ts";
import { classifyMattermostReconciliation } from "../../../packages/connector-mattermost/src/reconciliation/mattermost-reconciliation.ts";

describe("Mattermost connector conformance", () => {
  it("renders only logical targets/templates", () =>
    expect(
      renderMattermostNotification({
        target: { kind: "PROJECT_CHANNEL", purpose: "QA_UPDATES" },
        template: "QA_REQUEST_CONFIRMED",
        variables: { title: "Safe" },
      }),
    ).toMatchObject({ capture: "SUPPRESSED" }));
  it("never turns zero/multiple/unsupported lookup into resend", () => {
    expect(classifyMattermostReconciliation({ supported: true, matches: [] }).outcome).toBe(
      "AMBIGUOUS",
    );
    expect(
      classifyMattermostReconciliation({
        supported: true,
        matches: [{ kind: "MESSAGE", opaqueId: "1" }],
      }).outcome,
    ).toBe("DELIVERED");
    expect(classifyMattermostReconciliation({ supported: false, matches: [] }).outcome).toBe(
      "AMBIGUOUS",
    );
  });
});
