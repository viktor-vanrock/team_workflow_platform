import { createPublicKey, verify as verifySignature } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import {
  assertEvidenceProtectedHeader,
  canonicalEvidenceBytes,
  evidenceContentHash,
  type EvidenceManifestVerifierPort,
  type EvidenceSignatureEnvelope,
  type ImmutablePublicKeyResolverPort,
  type QaEvidenceManifestRevisionV2,
} from "@awp/competency-qa";
import {
  assertExactRevisionRef,
  type ExactRevisionRef,
  freezePilotValue,
  type ProjectScope,
} from "@awp/platform-core";

export function evidenceJwsInput(
  header: EvidenceSignatureEnvelope["protectedHeader"],
  canonicalPayload: string,
): Buffer {
  return Buffer.from(
    `${Buffer.from(canonicalEvidenceBytes(header)).toString("base64url")}.${Buffer.from(canonicalPayload).toString("base64url")}`,
  );
}
function validatePublicKey(kid: string, version: number, publicJwk: JsonWebKey): void {
  const declaredKid = (publicJwk as JsonWebKey & { kid?: string }).kid;
  if (
    kid !== `${kid.split(":")[0]}:${version}` ||
    !Number.isSafeInteger(version) ||
    version < 1 ||
    publicJwk.kty !== "OKP" ||
    publicJwk.crv !== "Ed25519" ||
    !/^[A-Za-z0-9_-]{43}$/u.test(publicJwk.x ?? "") ||
    Object.keys(publicJwk).some(
      (key) => !["kty", "crv", "x", "kid", "alg", "use", "key_ops"].includes(key),
    ) ||
    (declaredKid !== undefined && declaredKid !== kid) ||
    (publicJwk.alg !== undefined && publicJwk.alg !== "EdDSA") ||
    (publicJwk.use !== undefined && publicJwk.use !== "sig") ||
    publicJwk.key_ops?.some((operation) => operation !== "verify")
  )
    throw new Error("EVIDENCE_PUBLIC_KEY_INVALID");
  try {
    assertEvidenceProtectedHeader({ alg: "EdDSA", kid, typ: "application/awp-evidence+json" });
    if (createPublicKey({ key: publicJwk, format: "jwk" }).asymmetricKeyType !== "ed25519")
      throw new Error();
  } catch {
    throw new Error("EVIDENCE_PUBLIC_KEY_INVALID");
  }
}
interface PublicKeyRecord extends ProjectScope {
  readonly kid: string;
  readonly version: number;
  readonly publicJwk: JsonWebKey;
  readonly contentHash: string;
}

/** Durable public-only archive. The directory belongs in the approved backup/retention inventory. */
export class FilePublicKeyHistory
  implements ImmutablePublicKeyResolverPort, EvidenceManifestVerifierPort
{
  readonly #directory: string;
  readonly #scope: ProjectScope;
  constructor(
    directory: string,
    scope: ProjectScope,
    private readonly isTrusted: (ref: ExactRevisionRef) => boolean = () => true,
  ) {
    if (!scope.workspaceId || !scope.projectId)
      throw new Error("EVIDENCE_PUBLIC_KEY_SCOPE_REQUIRED");
    mkdirSync(directory, { recursive: true });
    this.#scope = Object.freeze({ ...scope });
    this.#directory = join(realpathSync(directory), evidenceContentHash(scope).slice(7));
    if (existsSync(this.#directory) && lstatSync(this.#directory).isSymbolicLink())
      throw new Error("EVIDENCE_PUBLIC_KEY_PATH_DENIED");
    mkdirSync(this.#directory, { recursive: true });
  }
  private path(kid: string, version: number): string {
    if (lstatSync(this.#directory).isSymbolicLink())
      throw new Error("EVIDENCE_PUBLIC_KEY_PATH_DENIED");
    return join(this.#directory, `${evidenceContentHash({ kid, version }).slice(7)}.json`);
  }
  publish(kid: string, version: number, publicJwk: JsonWebKey): ExactRevisionRef {
    validatePublicKey(kid, version, publicJwk);
    const body = { ...this.#scope, kid, version, publicJwk: structuredClone(publicJwk) };
    const record: PublicKeyRecord = { ...body, contentHash: evidenceContentHash(body) };
    const bytes = `${canonicalEvidenceBytes(record)}\n`;
    const path = this.path(kid, version);
    let fd: number | undefined;
    try {
      fd = openSync(
        path,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
        0o600,
      );
      writeFileSync(fd, bytes);
      fsyncSync(fd);
      const directoryFd = openSync(this.#directory, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        fsyncSync(directoryFd);
      } finally {
        closeSync(directoryFd);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST")
        throw new Error("EVIDENCE_PUBLIC_KEY_ARCHIVE_FAILED");
      const current = this.read(kid, version);
      if (canonicalEvidenceBytes(current) !== canonicalEvidenceBytes(record))
        throw new Error("EVIDENCE_PUBLIC_KEY_IMMUTABLE");
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
    return Object.freeze({ id: kid, version, contentHash: evidenceContentHash(publicJwk) });
  }
  private read(kid: string, version: number): PublicKeyRecord | undefined {
    let fd: number | undefined;
    try {
      fd = openSync(this.path(kid, version), constants.O_RDONLY | constants.O_NOFOLLOW);
      if (fstatSync(fd).size > 16384) throw new Error();
      const value = JSON.parse(readFileSync(fd, "utf8")) as PublicKeyRecord;
      const { contentHash, ...body } = value;
      if (
        value.workspaceId !== this.#scope.workspaceId ||
        value.projectId !== this.#scope.projectId ||
        value.kid !== kid ||
        value.version !== version ||
        evidenceContentHash(body) !== contentHash
      )
        throw new Error();
      validatePublicKey(value.kid, value.version, value.publicJwk);
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw new Error("EVIDENCE_PUBLIC_KEY_ARCHIVE_INVALID");
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  }
  async resolve(
    ref: ExactRevisionRef,
  ): Promise<Readonly<{ kid: string; algorithm: "Ed25519"; publicKey: JsonWebKey }> | undefined> {
    assertExactRevisionRef(ref);
    if (!this.isTrusted(ref)) return undefined;
    const value = this.read(ref.id, ref.version);
    if (!value || evidenceContentHash(value.publicJwk) !== ref.contentHash) return undefined;
    return freezePilotValue({
      kid: value.kid,
      algorithm: "Ed25519" as const,
      publicKey: value.publicJwk,
    });
  }
  async verify(
    manifest: QaEvidenceManifestRevisionV2,
    envelope: EvidenceSignatureEnvelope,
  ): Promise<"VALID" | "INVALID" | "KEY_UNAVAILABLE"> {
    try {
      const { contentHash: manifestHash, ...payload } = manifest;
      const { contentHash: envelopeHash, ...envelopeBody } = envelope;
      assertEvidenceProtectedHeader(envelope.protectedHeader);
      if (
        manifest.workspaceId !== this.#scope.workspaceId ||
        manifest.projectId !== this.#scope.projectId ||
        envelope.workspaceId !== manifest.workspaceId ||
        envelope.projectId !== manifest.projectId ||
        envelope.format !== "JWS_DETACHED" ||
        envelope.serialization !== "JCS_RFC8785" ||
        envelope.version !== 1 ||
        evidenceContentHash(payload) !== manifestHash ||
        evidenceContentHash(envelopeBody) !== envelopeHash ||
        envelope.payloadHash !== manifestHash ||
        envelope.manifestRevisionRef.id !== manifest.manifestRevisionId ||
        envelope.manifestRevisionRef.version !== manifest.version ||
        envelope.manifestRevisionRef.contentHash !== manifestHash ||
        envelope.publicKeyRef.id !== envelope.protectedHeader.kid ||
        !/^[A-Za-z0-9_-]{86}$/u.test(envelope.signature)
      )
        return "INVALID";
      let key;
      try {
        key = await this.resolve(envelope.publicKeyRef);
      } catch {
        return "KEY_UNAVAILABLE";
      }
      if (!key) return "KEY_UNAVAILABLE";
      return verifySignature(
        null,
        evidenceJwsInput(envelope.protectedHeader, canonicalEvidenceBytes(payload)),
        createPublicKey({ key: key.publicKey, format: "jwk" }),
        Buffer.from(envelope.signature, "base64url"),
      )
        ? "VALID"
        : "INVALID";
    } catch {
      return "INVALID";
    }
  }
}
