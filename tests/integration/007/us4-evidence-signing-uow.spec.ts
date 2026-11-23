import { describe, expect, it } from "vitest";

import { InMemoryEvidenceSigningUnitOfWork } from "../../../packages/competency-qa/src/persistence/evidence-signing.uow.ts";
import { manifestInput } from "../../support/007-evidence-fixture.ts";

describe("US4 signing UoW", () => {
  it("commits manifest+signature+session atomically with CAS/idempotency", async () => {
    const uow = new InMemoryEvidenceSigningUnitOfWork(1);
    const result = await uow.commitCandidate(manifestInput(), { signatureId: "sig" }, 1, "key");
    expect(result.replayed).toBe(false);
    expect(
      (await uow.commitCandidate(manifestInput(), { signatureId: "sig" }, 1, "key")).replayed,
    ).toBe(true);
    await expect(
      uow.commitCandidate(
        { ...manifestInput(), manifestRevisionId: "other" },
        { signatureId: "sig2" },
        1,
        "key",
      ),
    ).rejects.toThrow("EVIDENCE_SIGNING_IDEMPOTENCY_CONFLICT");
    expect(uow.sessionVersion).toBe(2);
  });
});
