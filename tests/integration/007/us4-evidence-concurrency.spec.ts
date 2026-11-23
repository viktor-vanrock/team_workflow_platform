import { describe, expect, it } from "vitest";

import { InMemoryEvidenceSigningUnitOfWork } from "../../../packages/competency-qa/src/persistence/evidence-signing.uow.ts";
import { manifestInput } from "../../support/007-evidence-fixture.ts";

describe("US4 concurrency", () => {
  it("allows one completion and no partial signed state", async () => {
    const uow = new InMemoryEvidenceSigningUnitOfWork(1);
    const settled = await Promise.allSettled([
      uow.commitCandidate(manifestInput(), { signatureId: "s1" }, 1, "a"),
      uow.commitCandidate(manifestInput(), { signatureId: "s2" }, 1, "b"),
    ]);
    expect(settled.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(uow.manifests).toHaveLength(1);
    expect(uow.signatures).toHaveLength(1);
  });
});
