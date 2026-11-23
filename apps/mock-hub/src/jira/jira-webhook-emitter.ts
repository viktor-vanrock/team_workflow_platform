export interface JiraWebhookDelivery {
  readonly deliveryId: string;
  readonly retryNumber: number;
  readonly body: Uint8Array;
  readonly signature: string;
}
export class JiraWebhookEmitter {
  #sequence = 0;
  emit(payload: unknown, secret = "local-hmac"): JiraWebhookDelivery {
    const body = new TextEncoder().encode(JSON.stringify(payload));
    return Object.freeze({
      deliveryId: `jira-delivery-${++this.#sequence}`,
      retryNumber: 0,
      body,
      signature: `local:${secret.length}:${body.byteLength}`,
    });
  }
}
