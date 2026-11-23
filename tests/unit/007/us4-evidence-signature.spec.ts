import { describe, expect, it } from "vitest";

import { buildEvidenceManifestV2 } from "../../../packages/competency-qa/src/application/evidence-manifest-builder-v2.ts";
import {
  LocalEd25519EvidenceSigner,
  LocalEvidenceSigningKeyStore,
} from "../../../packages/runtime-composition/src/security/evidence-signing.ts";
import { manifestInput } from "../../support/007-evidence-fixture.ts";
import { onboardingFixture } from "../../support/007-onboarding-fixture.ts";

describe("US4 detached EdDSA", () => {
  it("verifies exact key and rejects tamper/revocation", async () => {
    const keys = new LocalEvidenceSigningKeyStore([onboardingFixture.signingKey]);
    const signer = new LocalEd25519EvidenceSigner(keys);
    const manifest = buildEvidenceManifestV2(manifestInput());
    const envelope = await signer.signManifest(manifest, "signing-policy");
    expect(await signer.verifyManifest(manifest, envelope)).toBe("VALID");
    expect(await signer.verifyManifest({ ...manifest, workItemId: "tampered" }, envelope)).toBe(
      "INVALID",
    );
    keys.revoke(envelope.protectedHeader.kid);
    expect(await signer.verifyManifest(manifest, envelope)).toBe("KEY_UNAVAILABLE");
  });
});
