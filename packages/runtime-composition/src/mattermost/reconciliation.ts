import {
  classifyMattermostReconciliation,
  type MattermostReconciliationPort,
} from "@awp/connector-mattermost";

export interface BoundMattermostSelector {
  readonly commandId: string;
  readonly attemptCount: number;
  readonly kind: "PENDING_MESSAGE" | "EFFECT_MARKER";
  readonly opaqueId: string;
}

export class MattermostLookupOnlyReconciliation {
  constructor(private readonly port: MattermostReconciliationPort) {}
  async reconcile(
    selector: BoundMattermostSelector,
    fence: Readonly<{ commandId: string; attemptCount: number }>,
    supported = true,
  ) {
    if (selector.commandId !== fence.commandId || selector.attemptCount !== fence.attemptCount)
      throw new Error("MATTERMOST_RECONCILIATION_FENCE_MISMATCH");
    const matches =
      selector.kind === "PENDING_MESSAGE"
        ? await this.port.lookupPendingId(selector.opaqueId)
        : await this.port.lookupEffectMarker(selector.opaqueId);
    return classifyMattermostReconciliation({ supported, matches });
  }
}
