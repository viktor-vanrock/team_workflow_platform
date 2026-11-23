import { type MessagingLogicalTarget, validateMessagingTarget } from "@awp/connector-sdk";
import { sha256 } from "@awp/platform-contracts";

export interface MattermostPresentation {
  readonly target: MessagingLogicalTarget;
  readonly message: string;
  readonly actions: readonly Readonly<{ id: string; label: string }>[];
  readonly bytes: Uint8Array;
  readonly capture: "SUPPRESSED";
}
export function renderMattermostPresentation(input: {
  target: MessagingLogicalTarget;
  title: string;
  body: string;
  actions?: readonly Readonly<{ id: string; label: string }>[];
}): MattermostPresentation {
  validateMessagingTarget(input.target);
  if (JSON.stringify(input).match(/response_url|channelId|https?:\/\//iu))
    throw new Error("MATTERMOST_PRESENTATION_PROVIDER_ROUTE_FORBIDDEN");
  const actions = input.actions ?? [];
  if (actions.length > 8 || new Set(actions.map(({ id }) => id)).size !== actions.length)
    throw new Error("MATTERMOST_PRESENTATION_ACTION_SET_INVALID");
  const message = `${input.title.trim()}\n\n${input.body.trim()}`;
  if (message.length > 16_383) throw new Error("MATTERMOST_PRESENTATION_TOO_LARGE");
  const dto = { message, actions: actions.map(({ id, label }) => ({ id, label })) };
  return Object.freeze({
    target: structuredClone(input.target),
    message,
    actions: Object.freeze([...actions]),
    bytes: new TextEncoder().encode(JSON.stringify(dto)),
    capture: "SUPPRESSED",
  });
}

export class MattermostPresentationLease {
  readonly bytesHash: string;
  #bytes: Uint8Array;
  #leased = false;
  constructor(bytes: Uint8Array) {
    this.#bytes = Uint8Array.from(bytes);
    this.bytesHash = sha256([...this.#bytes]);
  }
  acquire(): Uint8Array {
    if (this.#leased || this.#bytes.byteLength === 0)
      throw new Error("MATTERMOST_PRESENTATION_LEASE_CONSUMED");
    this.#leased = true;
    return this.#bytes;
  }
  purge(): void {
    this.#bytes.fill(0);
    this.#bytes = new Uint8Array();
  }
}
