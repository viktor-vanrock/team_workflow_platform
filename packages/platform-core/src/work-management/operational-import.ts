export type OperationalImportDiscoverySource =
  "WEBHOOK" | "IMPORT_RECONCILIATION" | "OPERATOR_REPLAY";
export type OperationalImportState =
  | "DISCOVERED"
  | "ROUTED"
  | "IDENTITY_VERIFIED"
  | "ADOPTED"
  | "AWAITING_CONFIRMATION"
  | "BLOCKED_MAPPING"
  | "FAILED_RETRYABLE"
  | "IGNORED_OUT_OF_SCOPE"
  | "REJECTED_SECURITY";
export interface OperationalImportIntent {
  readonly id: string;
  readonly authorityIdentity: string;
  readonly source: OperationalImportDiscoverySource;
  readonly authoritativeHash: string;
  readonly state: OperationalImportState;
}

export class OperationalImportAggregate {
  #intent?: OperationalImportIntent;
  constructor(readonly authorityIdentity: string) {
    if (!authorityIdentity) throw new Error("IMPORT_AUTHORITY_IDENTITY_REQUIRED");
  }
  discover(
    source: OperationalImportDiscoverySource,
    authoritativeHash: string,
  ): OperationalImportIntent {
    if (this.#intent) {
      if (this.#intent.authoritativeHash !== authoritativeHash)
        throw new Error("IMPORT_IDENTITY_HASH_CONFLICT");
      return this.#intent;
    }
    this.#intent = Object.freeze({
      id: `import:${this.authorityIdentity}`,
      authorityIdentity: this.authorityIdentity,
      source,
      authoritativeHash,
      state: "DISCOVERED",
    });
    return this.#intent;
  }
  advance(state: OperationalImportState): OperationalImportIntent {
    if (!this.#intent) throw new Error("IMPORT_NOT_DISCOVERED");
    const allowed: Record<OperationalImportState, readonly OperationalImportState[]> = {
      DISCOVERED: [
        "ROUTED",
        "AWAITING_CONFIRMATION",
        "BLOCKED_MAPPING",
        "FAILED_RETRYABLE",
        "IGNORED_OUT_OF_SCOPE",
        "REJECTED_SECURITY",
      ],
      ROUTED: [
        "IDENTITY_VERIFIED",
        "AWAITING_CONFIRMATION",
        "BLOCKED_MAPPING",
        "FAILED_RETRYABLE",
        "IGNORED_OUT_OF_SCOPE",
        "REJECTED_SECURITY",
      ],
      IDENTITY_VERIFIED: [
        "ADOPTED",
        "AWAITING_CONFIRMATION",
        "FAILED_RETRYABLE",
        "REJECTED_SECURITY",
      ],
      ADOPTED: [],
      AWAITING_CONFIRMATION: [],
      BLOCKED_MAPPING: [],
      FAILED_RETRYABLE: ["DISCOVERED", "ROUTED", "IDENTITY_VERIFIED"],
      IGNORED_OUT_OF_SCOPE: [],
      REJECTED_SECURITY: [],
    };
    if (!allowed[this.#intent.state].includes(state))
      throw new Error("IMPORT_STATE_TRANSITION_INVALID");
    this.#intent = Object.freeze({ ...this.#intent, state });
    return this.#intent;
  }
}

export interface ExternalConfirmationImportIntent {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly externalEntityId: string;
  readonly verifiedHumanPrincipalId: string;
  readonly exactProfileHash: string;
  readonly authoritativeReadHash: string;
}

export function assertExternalConfirmationImportIntent(
  input: ExternalConfirmationImportIntent,
): void {
  if (
    !input.workspaceId ||
    !input.projectId ||
    !input.externalEntityId ||
    !input.verifiedHumanPrincipalId ||
    !input.exactProfileHash.startsWith("sha256:") ||
    !input.authoritativeReadHash.startsWith("sha256:")
  )
    throw new Error("EXTERNAL_CONFIRMATION_IMPORT_INVALID");
}

export interface OperationalImportAdoption {
  readonly authorityIdentity: string;
  readonly workItemId: string;
  readonly source: string;
  readonly created: boolean;
}
export class OperationalImportConvergence {
  readonly #adoptions = new Map<string, Omit<OperationalImportAdoption, "created">>();
  async adopt(
    input: Readonly<{ authorityIdentity: string; workItemId: string; source: string }>,
  ): Promise<OperationalImportAdoption> {
    const current = this.#adoptions.get(input.authorityIdentity);
    if (current) return Object.freeze({ ...current, created: false });
    const adopted = Object.freeze({ ...input });
    this.#adoptions.set(input.authorityIdentity, adopted);
    return Object.freeze({ ...adopted, created: true });
  }
}
