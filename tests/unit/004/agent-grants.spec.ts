import { describe, expect, it } from "vitest";

import { deriveAgentGrants } from "../../../packages/platform-core/src/index.ts";

describe("Agent grants", () =>
  it("is a non-expanding service∩skill∩human intersection", () => {
    const subject = {
      kind: "DRAFT" as const,
      id: "d",
      version: 1,
      contentHash: "h",
      aggregateSnapshotHash: "a",
    };
    const grants = deriveAgentGrants({
      subject,
      serviceCeiling: ["read", "write"],
      skillAllowlist: [
        { action: "read", effectClass: "READ_ONLY" },
        { action: "admin", effectClass: "DRAFT_MUTATION" },
      ],
      humanAllowedActions: ["read", "admin"],
      classificationCeiling: "INTERNAL",
    });
    expect(grants.map(({ action }) => action)).toEqual(["read"]);
  }));
