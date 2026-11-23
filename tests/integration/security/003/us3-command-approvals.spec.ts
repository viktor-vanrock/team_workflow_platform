import { describe, expect, it } from "vitest";

import { createOperationalActionApprovalSubject } from "../../../../packages/platform-core/src/approval/external-command-approval.ts";

describe("US3 command approval subject", () => {
  it("binds command, expected state and every ordered pin", () => {
    const first = createOperationalActionApprovalSubject({
      commandId: "c",
      operation: "request.assign",
      expectedState: { revision: "r1" },
      pins: [
        { sequence: 0, contentHash: "h1" },
        { sequence: 1, contentHash: "h2" },
      ],
      expiresAt: "2026-09-01T00:00:00Z",
    });
    const changed = createOperationalActionApprovalSubject({
      commandId: "c",
      operation: "request.assign",
      expectedState: { revision: "r1" },
      pins: [
        { sequence: 0, contentHash: "h1" },
        { sequence: 1, contentHash: "other" },
      ],
      expiresAt: "2026-09-01T00:00:00Z",
    });
    expect(first).not.toBe(changed);
  });
});
