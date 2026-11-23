export interface MattermostSecretResolver {
  resolve(ref: string): Promise<string>;
}
export interface MattermostCredentialLease {
  use<T>(consumer: (credential: string) => Promise<T>): Promise<T>;
}
export class ShortLivedMattermostCredentialLease implements MattermostCredentialLease {
  #used = false;
  constructor(
    private readonly ref: string,
    private readonly resolver: MattermostSecretResolver,
  ) {}
  async use<T>(consumer: (credential: string) => Promise<T>): Promise<T> {
    if (this.#used) throw new Error("MATTERMOST_CREDENTIAL_LEASE_CONSUMED");
    this.#used = true;
    const credential = await this.resolver.resolve(this.ref);
    if (!credential) throw new Error("MATTERMOST_CREDENTIAL_NOT_FOUND");
    try {
      return await consumer(credential);
    } finally {
      /* immutable JS strings cannot be zeroed; no reference is retained */
    }
  }
  toJSON(): never {
    throw new Error("MATTERMOST_CREDENTIAL_SERIALIZATION_FORBIDDEN");
  }
}
