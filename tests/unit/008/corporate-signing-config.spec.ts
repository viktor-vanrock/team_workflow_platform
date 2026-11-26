import { describe, expect, it } from "vitest";

import { parseCorporateSigningHostConfig } from "../../../apps/api/src/extensions/onboarding/corporate-signing-config.ts";
import { pilotContentHash } from "../../../packages/platform-core/src/index.ts";

const ref = { id: "evidence:1", version: 1, contentHash: `sha256:${"a".repeat(64)}` as const };
const policy = { workspaceId: "workspace", projectIds: ["project"], signingPolicyRef: ref };
const environment = {
  profile: "non-local",
  environmentScope: "NON_PROD",
  deployment: policy,
} as never;
const publications = [{ kind: "SIGNING_POLICY", ref }] as never;
const config = {
  schemaVersion: 1,
  deploymentPolicyHash: pilotContentHash(policy),
  publicKeyHistoryDirectory: "/data/public-keys",
  projects: [
    {
      grant: {
        configuration: {
          workspaceId: "workspace",
          projectId: "project",
          servicePrincipalId: "service",
          mount: "transit",
          keyName: "evidence",
          keyVersion: 1,
          kid: "evidence:1",
          publicKeyRef: ref,
          signingPolicyRef: ref,
        },
        serviceIdentity: {
          issuer: "https://issuer.example",
          subject: "service",
          serviceKey: "signer",
        },
        permission: "evidence.sign",
      },
      redactionPolicyRef: ref,
      exportPolicyRef: ref,
      trustedPublicKeys: [ref],
    },
  ],
};

describe("corporate signing host configuration", () => {
  it("pins project signing and public key references to the deployment", () => {
    expect(
      parseCorporateSigningHostConfig(config, environment, publications).projects,
    ).toHaveLength(1);
    expect(() =>
      parseCorporateSigningHostConfig(
        { ...config, deploymentPolicyHash: "wrong" },
        environment,
        publications,
      ),
    ).toThrow("CORPORATE_SIGNING_CONFIG_INVALID");
  });
  it("rejects private material, cross-project signing and untrusted keys", () => {
    const privateMaterial = structuredClone(config);
    Object.assign(privateMaterial.projects[0]!.grant.serviceIdentity, { privateKey: "forbidden" });
    expect(() =>
      parseCorporateSigningHostConfig(privateMaterial, environment, publications),
    ).toThrow("CORPORATE_SIGNING_CONFIG_INVALID");
    const otherProject = structuredClone(config);
    otherProject.projects[0]!.grant.configuration.projectId = "foreign";
    expect(() => parseCorporateSigningHostConfig(otherProject, environment, publications)).toThrow(
      "CORPORATE_SIGNING_CONFIG_INVALID",
    );
    const otherKey = structuredClone(config);
    otherKey.projects[0]!.trustedPublicKeys[0] = { ...ref, version: 2 };
    expect(() => parseCorporateSigningHostConfig(otherKey, environment, publications)).toThrow(
      "CORPORATE_SIGNING_CONFIG_INVALID",
    );
  });
});
