import type { Clock } from "../shared/primitives.ts";
import type { ConnectorBroker, ConnectorChainResolver } from "./connector-broker.ts";
import type { DurableCommandStore } from "./connector-command.ts";

export class EffectReconciliationService {
  constructor(
    private readonly store: DurableCommandStore,
    private readonly broker: ConnectorBroker,
    private readonly chains: ConnectorChainResolver,
    private readonly clock: Clock,
  ) {}
  async reconcile(): Promise<"CONFIRMED" | "RETRY"> {
    const command = this.store.command();
    const chain = await this.chains.resolve(command, { allowRetired: true });
    const operation = this.broker.operationFor(command, chain);
    const found = operation?.lookup
      ? await operation.lookup(command.effectIdempotencyKey)
      : undefined;
    if (found !== undefined) {
      this.store.confirm(found, this.clock.now());
      return "CONFIRMED";
    }
    this.store.recover(this.clock.now());
    return "RETRY";
  }
}
