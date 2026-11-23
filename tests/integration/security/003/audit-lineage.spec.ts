import { describe, expect, it } from "vitest";

import { buildJiraAuditLineage } from "../../../../packages/connector-jira/src/observability.ts";

describe("003 audit lineage", () => {
  it("reconstructs human→approval→pins→calls→authoritative confirmation without secrets", () => {
    const lineage = buildJiraAuditLineage({
      actorId: "human",
      approvalId: "approval",
      commandId: "command",
      pins: [
        { sequence: 0, contentHash: "h1" },
        { sequence: 1, contentHash: "h2" },
      ],
      calls: [{ operation: "PUT", safePathTemplate: "/issue/{id}", receiptHash: "r" }],
      confirmation: { observationId: "o", authorityFieldsHash: "a" },
    });
    expect(lineage.steps.map(({ kind }) => kind)).toEqual([
      "ACTOR",
      "APPROVAL",
      "COMMAND",
      "CONFIGURATION_PIN",
      "CONFIGURATION_PIN",
      "PROVIDER_CALL",
      "AUTHORITATIVE_CONFIRMATION",
    ]);
    expect(JSON.stringify(lineage)).not.toMatch(/authorization|cookie|secret/iu);
  });
});
