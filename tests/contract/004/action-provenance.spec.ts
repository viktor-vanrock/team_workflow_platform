import { describe, expect, it } from "vitest";

import {
  OfflineSchemaRegistry,
  schemaDocuments,
} from "../../../packages/platform-contracts/src/index.ts";

describe("ActionProvenance schema parity", () => {
  it("closes actor/subject/effect/configuration combinations", () => {
    const registry = new OfflineSchemaRegistry(schemaDocuments);
    expect(() =>
      registry.validateById("urn:awp:schemas:004:action-provenance:v1", {
        schemaVersion: "action-provenance@1.0.0",
        actionProvenanceId: "a",
        workspaceId: "w",
        projectId: "p",
        actor: { kind: "MODEL", principalId: "m" },
      }),
    ).toThrow();
  });
});
