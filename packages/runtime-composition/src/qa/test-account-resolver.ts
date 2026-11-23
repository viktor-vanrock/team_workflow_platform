import type { QaTestAccountLease } from "@awp/competency-qa";

export interface RuntimeCredentialAdapter {
  resolve(opaqueAccountRef: string): Promise<Readonly<Record<string, string>> | undefined>;
}

export class TestAccountCredentialResolver {
  constructor(private readonly adapter: RuntimeCredentialAdapter) {}

  async resolve(lease: QaTestAccountLease, now: string): Promise<Readonly<Record<string, string>>> {
    if (lease.state !== "ACTIVE" || Date.parse(lease.expiresAt) <= Date.parse(now))
      throw new Error("ACCOUNT_LEASE_NOT_ACTIVE");
    const credential = await this.adapter.resolve(lease.opaqueAccountRef);
    if (!credential) throw new Error("ACCOUNT_CREDENTIAL_UNAVAILABLE");
    return Object.freeze({ ...credential });
  }
}
