import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface SessionEncryptionKeys {
  /** Resolver owns the key lifetime and must permit only approved key IDs. */
  withKey<T>(keyId: string, use: (key: Uint8Array) => T): Promise<T>;
}
export interface SessionStateCodec {
  seal(value: unknown, context: string): Promise<string>;
  open(value: string, context: string): Promise<unknown>;
}

export class AesGcmSessionStateCodec implements SessionStateCodec {
  constructor(
    private readonly activeKeyId: string,
    private readonly keys: SessionEncryptionKeys,
  ) {
    if (!/^[a-zA-Z0-9_-]{1,64}$/u.test(activeKeyId)) throw new Error("SESSION_KEY_INVALID");
  }
  async seal(value: unknown, context: string): Promise<string> {
    const bytes = Buffer.from(JSON.stringify(value));
    try {
      if (bytes.length > 32768) throw new Error();
      return await this.keys.withKey(this.activeKeyId, (key) => {
        if (key.length !== 32) throw new Error();
        const iv = randomBytes(12);
        const cipher = createCipheriv("aes-256-gcm", key, iv);
        cipher.setAAD(Buffer.from(`${context}:${this.activeKeyId}`));
        const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
        return `1.${this.activeKeyId}.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ciphertext.toString("base64url")}`;
      });
    } catch {
      throw new Error("SESSION_STATE_INVALID");
    } finally {
      bytes.fill(0);
    }
  }
  async open(value: string, context: string): Promise<unknown> {
    try {
      if (
        value.length > 45000 ||
        !/^1\.[a-zA-Z0-9_-]{1,64}\.[a-zA-Z0-9_-]{16}\.[a-zA-Z0-9_-]{22}\.[a-zA-Z0-9_-]+$/u.test(
          value,
        )
      )
        throw new Error();
      const [, keyId, iv, tag, ciphertext] = value.split(".");
      return await this.keys.withKey(keyId!, (key) => {
        if (key.length !== 32) throw new Error();
        const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv!, "base64url"));
        decipher.setAAD(Buffer.from(`${context}:${keyId}`));
        decipher.setAuthTag(Buffer.from(tag!, "base64url"));
        const bytes = Buffer.concat([
          decipher.update(Buffer.from(ciphertext!, "base64url")),
          decipher.final(),
        ]);
        try {
          return JSON.parse(bytes.toString("utf8")) as unknown;
        } finally {
          bytes.fill(0);
        }
      });
    } catch {
      throw new Error("SESSION_STATE_INVALID");
    }
  }
}
