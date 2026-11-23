import { Body, Controller, Headers, HttpCode, Inject, Param, Post, Req } from "@nestjs/common";

import { MattermostIngressService } from "@awp/runtime-composition";

export const MATTERMOST_INGRESS = Symbol("MATTERMOST_INGRESS");
interface RawRequest {
  readonly rawBody?: Buffer;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
}

@Controller("api/v1/connectors/mattermost/connections/:connectionId")
export class MattermostIngressController {
  constructor(@Inject(MATTERMOST_INGRESS) private readonly ingress: MattermostIngressService) {}
  @Post("dialog-submissions")
  @HttpCode(200)
  dialog(
    @Param("connectionId") connectionId: string,
    @Body() body: unknown,
    @Req() request: RawRequest,
    @Headers() headers: Readonly<Record<string, string | undefined>>,
  ) {
    return this.ingress.accept({
      connectionId,
      kind: "DIALOG_SUBMISSION",
      body,
      rawBytes: request.rawBody ?? Buffer.from(JSON.stringify(body)),
      headers,
      receivedAt: new Date(),
    });
  }
  @Post("post-actions")
  @HttpCode(200)
  action(
    @Param("connectionId") connectionId: string,
    @Body() body: unknown,
    @Req() request: RawRequest,
    @Headers() headers: Readonly<Record<string, string | undefined>>,
  ) {
    return this.ingress.accept({
      connectionId,
      kind: "POST_ACTION",
      body,
      rawBytes: request.rawBody ?? Buffer.from(JSON.stringify(body)),
      headers,
      receivedAt: new Date(),
    });
  }
}
