import { describe, expect, it } from "vitest";

import {
  recoveryAuditHash008,
  type RecoveryInventory008,
  verifyRecoveryInventory008,
} from "../../../packages/runtime-composition/src/recovery/verify.ts";

const fixture = (): RecoveryInventory008 => {
  const first = { id: "audit-1", previousHash: null, body: { action: "created" } },
    firstHash = recoveryAuditHash008(first.id, first.previousHash, first.body),
    second = { id: "audit-2", previousHash: firstHash, body: { action: "signed" } },
    secondHash = recoveryAuditHash008(second.id, second.previousHash, second.body);
  return {
    schemaPins: { core: 185, qa: 2100 },
    expectedSchemaPins: { core: 185, qa: 2100 },
    bindings: [{ id: "jira", expectedHash: "binding-hash", actualHash: "binding-hash" }],
    audit: [
      { ...first, contentHash: firstHash },
      { ...second, contentHash: secondHash },
    ],
    signatures: [
      { id: "signature-old", publicKeyRef: "key-v1", status: "VALID" },
      { id: "signature-new", publicKeyRef: "key-v2", status: "VALID" },
    ],
    artifacts: [
      {
        id: "required",
        required: true,
        state: "AVAILABLE",
        metadataHash: "metadata-1",
        bytesHash: "bytes-1",
      },
      { id: "expired", required: false, state: "EXPIRED", metadataHash: "metadata-2" },
    ],
    secretStoreOwnerEvidenceRef: "fixture:secret-store-owner",
  };
};
describe("008 restored evidence integrity", () => {
  it("accepts historical signatures across key rotation, intact bindings/audit and expired metadata", () =>
    expect(verifyRecoveryInventory008(fixture())).toMatchObject({
      status: "PASS",
      measurements: { signatures: 2, expiredArtifactsWithMetadata: 1 },
    }));
  it.each(["signature", "binding", "audit", "required-artifact", "secret-owner"])(
    "fails restored %s integrity loss",
    (fault) => {
      let value = fixture();
      if (fault === "signature")
        value = {
          ...value,
          signatures: [
            { ...value.signatures[0]!, status: "KEY_UNAVAILABLE" },
            ...value.signatures.slice(1),
          ],
        };
      if (fault === "binding")
        value = { ...value, bindings: [{ ...value.bindings[0]!, actualHash: "drift" }] };
      if (fault === "audit")
        value = {
          ...value,
          audit: [value.audit[0]!, { ...value.audit[1]!, previousHash: "drift" }],
        };
      if (fault === "required-artifact")
        value = {
          ...value,
          artifacts: [
            { id: "required", required: true, state: "AVAILABLE", metadataHash: "metadata-1" },
            value.artifacts[1]!,
          ],
        };
      if (fault === "secret-owner") value = { ...value, secretStoreOwnerEvidenceRef: null };
      expect(verifyRecoveryInventory008(value)).toMatchObject({ status: "FAIL" });
    },
  );
});
