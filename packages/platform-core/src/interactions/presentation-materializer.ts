import { createDecipheriv, createHash } from "node:crypto";

import { canonicalize, type JsonValue } from "@awp/platform-contracts";

export interface CommandExecutionFence {
  readonly commandId: string;
  readonly attemptCount: number;
}
export interface SensitiveValue {
  utf8(): string;
  bytes(): Uint8Array;
}
export interface OneShotSensitiveLease {
  readonly fence: CommandExecutionFence;
  use<T>(consumer: (value: SensitiveValue) => T): T;
}
function createOneShotSensitiveLease(
  bytes: Uint8Array,
  fence: CommandExecutionFence,
): OneShotSensitiveLease {
  let consumed = false;
  const secret = new Uint8Array(bytes);
  return Object.freeze({
    fence: Object.freeze({ ...fence }),
    use<T>(consumer: (value: SensitiveValue) => T): T {
      if (consumed) throw new Error("SENSITIVE_LEASE_CONSUMED");
      consumed = true;
      try {
        return consumer(
          Object.freeze({
            utf8: () => new TextDecoder().decode(secret),
            bytes: () => new Uint8Array(secret),
          }),
        );
      } finally {
        secret.fill(0);
      }
    },
  });
}

export interface PresentationKeyResolver {
  resolve(keyId: string, version: number): Uint8Array;
}
export class InMemoryPresentationKeyResolver implements PresentationKeyResolver {
  readonly #keys = new Map<string, Uint8Array>();
  constructor(entries: readonly (readonly [string, Uint8Array])[]) {
    for (const [key, value] of entries) this.#keys.set(key, new Uint8Array(value));
  }
  resolve(keyId: string, version: number): Uint8Array {
    const value = this.#keys.get(`${keyId}@${version}`);
    if (!value) throw new Error("PRESENTATION_KEY_NOT_FOUND");
    return new Uint8Array(value);
  }
}

const hash = (value: Uint8Array): string =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
export class InteractionPresentationMaterializer {
  constructor(private readonly keys: PresentationKeyResolver) {}
  openVector(value: Record<string, unknown>, fence: CommandExecutionFence): OneShotSensitiveLease {
    const aad = value.aad as Record<string, unknown>;
    const capsule = aad.capsule as Record<string, unknown>;
    if (capsule.presentationCommandId !== fence.commandId)
      throw new Error("PRESENTATION_COMMAND_FENCE_MISMATCH");
    if (!Number.isInteger(fence.attemptCount) || fence.attemptCount < 1)
      throw new Error("PRESENTATION_ATTEMPT_FENCE_INVALID");
    const keyRef = capsule.encryptionKeyVersionRef as Record<string, unknown>;
    const key = this.keys.resolve(String(keyRef.keyId), Number(keyRef.version));
    const nonce = Buffer.from(String(value.aeadNonceHex), "hex");
    const ciphertext = Buffer.from(String(value.ciphertextHex), "hex");
    const tag = Buffer.from(String(value.authTagHex), "hex");
    const aadBytes = Buffer.from(canonicalize(aad as JsonValue), "utf8");
    if (hash(aadBytes) !== value.aadHash || hash(ciphertext) !== value.ciphertextHash)
      throw new Error("PRESENTATION_COMMITMENT_MISMATCH");
    const decipher = createDecipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 });
    decipher.setAAD(aadBytes);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    if (hash(plaintext) !== value.tokenHash) {
      plaintext.fill(0);
      throw new Error("PRESENTATION_TOKEN_HASH_MISMATCH");
    }
    return createOneShotSensitiveLease(plaintext, fence);
  }
}
