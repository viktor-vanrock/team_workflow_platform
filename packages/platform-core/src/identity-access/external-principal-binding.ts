export type ExternalPrincipalKind = "EXTERNAL_HUMAN" | "EXTERNAL_SERVICE";
export type ExternalPrincipalBindingState = "PENDING" | "VERIFIED" | "REVOKED" | "CONFLICT";

export interface VerifiedExternalPrincipalInput {
  readonly workspaceId: string;
  readonly connectionHeaderId: string;
  readonly providerNamespace: string;
  readonly externalPrincipalId: string;
  readonly externalPrincipalKind: ExternalPrincipalKind;
  readonly principalId: string;
  readonly evidenceHash: string;
  readonly verifiedBy: string;
  readonly verifiedAt: Date;
}

export class ExternalPrincipalBinding {
  #state: ExternalPrincipalBindingState = "VERIFIED";
  private constructor(readonly value: VerifiedExternalPrincipalInput) {
    if (
      !value.externalPrincipalId ||
      value.externalPrincipalId.includes("@") ||
      !value.evidenceHash.startsWith("sha256:")
    )
      throw new Error("EXTERNAL_SUBJECT_VERIFICATION_INVALID");
  }
  static verify(input: VerifiedExternalPrincipalInput): ExternalPrincipalBinding {
    return new ExternalPrincipalBinding(Object.freeze({ ...input }));
  }
  get state(): ExternalPrincipalBindingState {
    return this.#state;
  }
  resolve(externalPrincipalId: string): string {
    if (this.#state !== "VERIFIED" || externalPrincipalId !== this.value.externalPrincipalId)
      throw new Error("EXTERNAL_SUBJECT_NOT_VERIFIED");
    return this.value.principalId;
  }
  revoke(): void {
    if (this.#state !== "VERIFIED") throw new Error("EXTERNAL_SUBJECT_STATE_INVALID");
    this.#state = "REVOKED";
  }
}
