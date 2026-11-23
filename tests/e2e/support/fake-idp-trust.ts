import { createHash, X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const fakeIdpCertificatePath = resolve(
  import.meta.dirname,
  "../../../infra/compose/certs/generated/fake-idp.pem",
);

export function fakeIdpChromiumTrustArguments(
  certificatePath = fakeIdpCertificatePath,
): readonly string[] {
  let certificate: X509Certificate;
  try {
    certificate = new X509Certificate(readFileSync(certificatePath));
  } catch (error) {
    throw new Error(
      `Fake IdP certificate is unavailable; run local:up first (${certificatePath})`,
      { cause: error },
    );
  }
  const spki = certificate.publicKey.export({ type: "spki", format: "der" });
  const pin = createHash("sha256").update(spki).digest("base64");
  return Object.freeze([`--ignore-certificate-errors-spki-list=${pin}`]);
}
