import type { SafeProviderReference } from "@awp/connector-sdk";

export function classifyMattermostReconciliation(input: {
  supported: boolean;
  matches: readonly SafeProviderReference[];
}): Readonly<
  | { outcome: "DELIVERED"; providerRef: SafeProviderReference }
  | { outcome: "AMBIGUOUS"; code: string }
> {
  if (input.supported && input.matches.length === 1)
    return Object.freeze({ outcome: "DELIVERED", providerRef: input.matches[0]! });
  return Object.freeze({
    outcome: "AMBIGUOUS",
    code: input.supported
      ? input.matches.length === 0
        ? "ZERO_MATCHES"
        : "MULTIPLE_MATCHES"
      : "LOOKUP_UNSUPPORTED",
  });
}
export interface MattermostReconciliationPort {
  lookupPendingId(id: string): Promise<readonly SafeProviderReference[]>;
  lookupEffectMarker(hash: string): Promise<readonly SafeProviderReference[]>;
}
export class MattermostReconciliationExecutor {
  constructor(private readonly port: MattermostReconciliationPort) {}
  async execute(
    selector: Readonly<{ kind: "PENDING_MESSAGE" | "EFFECT_MARKER"; opaqueId: string }>,
    supported = true,
  ) {
    const matches =
      selector.kind === "PENDING_MESSAGE"
        ? await this.port.lookupPendingId(selector.opaqueId)
        : await this.port.lookupEffectMarker(selector.opaqueId);
    return classifyMattermostReconciliation({ supported, matches });
  }
}
export const mattermostReconciliationAuthorizesResend = (): false => false;
