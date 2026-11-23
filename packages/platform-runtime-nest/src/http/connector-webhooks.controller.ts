import { Controller, Headers, HttpCode, Inject, Param, Post, Req } from "@nestjs/common";

export const CONNECTOR_WEBHOOK_INGRESS = Symbol("CONNECTOR_WEBHOOK_INGRESS");
export interface ConnectorWebhookIngressPort {
  accept(
    input: Readonly<{
      connectorKey: string;
      connectionId: string;
      webhookKey: string;
      contentType: string;
      rawBytes: Uint8Array;
      receivedAt: Date;
      headers: Readonly<Record<string, string>>;
    }>,
  ): Promise<Readonly<{ status: "ACCEPTED" | "DUPLICATE"; receiptId: string }>>;
}
interface RawBodyRequestLike {
  readonly rawBody?: Buffer;
  readonly body?: unknown;
}

@Controller("api/v1/connectors/:connectorKey/connections")
export class ConnectorWebhooksController {
  constructor(
    @Inject(CONNECTOR_WEBHOOK_INGRESS) private readonly ingress: ConnectorWebhookIngressPort,
  ) {}
  @Post(":connectionId/webhooks/:webhookKey")
  @HttpCode(202)
  async receive(
    @Param("connectorKey") connectorKey: string,
    @Param("connectionId") connectionId: string,
    @Param("webhookKey") webhookKey: string,
    @Headers() headers: Record<string, string | undefined>,
    @Req() request: RawBodyRequestLike,
  ) {
    const raw = request.rawBody;
    if (!raw) throw new Error("RAW_WEBHOOK_BODY_REQUIRED");
    return await this.ingress.accept({
      connectorKey,
      connectionId,
      webhookKey,
      contentType: headers["content-type"] ?? "",
      rawBytes: new Uint8Array(raw),
      receivedAt: new Date(),
      headers: Object.freeze(
        Object.fromEntries(
          Object.entries(headers).flatMap(([key, value]) =>
            value === undefined ? [] : [[key, value]],
          ),
        ),
      ),
    });
  }
}
