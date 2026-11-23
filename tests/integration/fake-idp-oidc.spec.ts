import { createPublicKey, createVerify } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { FakeOidcService } from "../../apps/fake-idp/src/oidc.controller.ts";

describe("T130 HTTPS Fake IdP OIDC surface", () => {
  it("publishes an exact issuer, signs tokens and retains the previous JWKS key through rotation", () => {
    const oidc = new FakeOidcService();
    expect(oidc.discovery()).toMatchObject({
      issuer: "https://fake-idp:4443/oidc",
      jwks_uri: "https://fake-idp:4443/oidc/jwks",
      token_endpoint: "https://fake-idp:4443/oidc/token",
    });
    const token = oidc.issue("requester.alpha").access_token;
    const [header, payload, signature] = token.split(".");
    const parsedHeader = JSON.parse(Buffer.from(header!, "base64url").toString("utf8")) as {
      kid: string;
    };
    const parsedPayload = JSON.parse(Buffer.from(payload!, "base64url").toString("utf8")) as {
      iss: string;
      sub: string;
      aud: string;
    };
    const key = oidc.jwks().keys.find((candidate) => candidate.kid === parsedHeader.kid);
    const verifier = createVerify("SHA256").update(`${header}.${payload}`).end();
    expect(
      verifier.verify(
        { key: createPublicKey({ key: key!, format: "jwk" }), dsaEncoding: "ieee-p1363" },
        Buffer.from(signature!, "base64url"),
      ),
    ).toBe(true);
    expect(parsedPayload).toMatchObject({
      iss: "https://fake-idp:4443/oidc",
      sub: "requester.alpha",
      aud: "awp-local",
    });

    const rotation = oidc.rotate();
    expect(oidc.jwks().keys.map((candidate) => candidate.kid)).toEqual([
      rotation.activeKid,
      rotation.retainedKid,
    ]);
  });

  it("rejects unknown subjects", () => {
    const oidc = new FakeOidcService();
    expect(() => oidc.issue("forged.admin")).toThrow("FAKE_IDP_SUBJECT_UNKNOWN");
  });
  it("issues explicit development step-up without upgrading ordinary sessions", () => {
    const oidc = new FakeOidcService();
    const payload = (token: string) =>
      JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString()) as Record<
        string,
        unknown
      >;
    expect(payload(oidc.issue("owner.local").access_token)).not.toHaveProperty("amr");
    try {
      vi.stubEnv("AWP_RUNTIME_PROFILE", "local");
      const token = oidc.issueDevelopmentStepUp("owner.local").access_token;
      expect(payload(token)).toMatchObject({
        sub: "owner.local",
        amr: ["development", "mfa"],
        auth_time: expect.any(Number),
      });
      const [header, body, signature] = token.split(".");
      expect(
        createVerify("SHA256")
          .update(`${header}.${body}`)
          .end()
          .verify(
            {
              key: createPublicKey({ key: oidc.jwks().keys[0]!, format: "jwk" }),
              dsaEncoding: "ieee-p1363",
            },
            Buffer.from(signature!, "base64url"),
          ),
      ).toBe(true);
      vi.stubEnv("AWP_RUNTIME_PROFILE", "non-local");
      expect(() => oidc.issueDevelopmentStepUp("owner.local")).toThrow(
        "FAKE_IDP_LOCAL_PROFILE_REQUIRED",
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
