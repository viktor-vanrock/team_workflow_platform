import { describe, expect, it } from "vitest";

import {
  ExternalPrincipalBinding,
  OperationalImportAggregate,
} from "../../../packages/platform-core/src/index.ts";

describe("verified external identity and import convergence", () => {
  it("accepts only verified opaque human subjects and never email matches", () => {
    const binding = ExternalPrincipalBinding.verify({
      workspaceId: "w",
      connectionHeaderId: "c",
      providerNamespace: "jira",
      externalPrincipalId: "account:opaque",
      externalPrincipalKind: "EXTERNAL_HUMAN",
      principalId: "principal-1",
      evidenceHash: "sha256:e",
      verifiedBy: "admin",
      verifiedAt: new Date("2026-01-01"),
    });
    expect(binding.resolve("account:opaque")).toBe("principal-1");
    expect(() => binding.resolve("person@example.test")).toThrow("EXTERNAL_SUBJECT_NOT_VERIFIED");
  });

  it("converges create, webhook and reconciliation on one authority identity", () => {
    const aggregate = new OperationalImportAggregate("c:OPERATIONAL_REQUEST:10001");
    expect(aggregate.discover("WEBHOOK", "sha256:one").id).toBe(
      aggregate.discover("IMPORT_RECONCILIATION", "sha256:one").id,
    );
    expect(() => aggregate.discover("WEBHOOK", "sha256:different")).toThrow(
      "IMPORT_IDENTITY_HASH_CONFLICT",
    );
  });
});
