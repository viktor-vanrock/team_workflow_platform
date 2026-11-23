import {
  BadRequestException,
  ConflictException,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from "@nestjs/common";

import {
  type GitLabWebhookIngressInput,
  type GitLabWebhookIngressResult,
  gitLabWebhookVerificationErrorCode,
} from "@awp/runtime-composition";

export const GITLAB_WEBHOOK_INGRESS_API = Symbol("GITLAB_WEBHOOK_INGRESS_API");
export interface GitLabWebhookIngressApiPort {
  accept(input: GitLabWebhookIngressInput): Promise<GitLabWebhookIngressResult>;
}

interface RawRequest {
  readonly rawBody?: Buffer;
}

function mapped(error: unknown): never {
  const code = gitLabWebhookVerificationErrorCode(error);
  if (code !== undefined) {
    if (code.includes("SIGNATURE")) throw new UnauthorizedException({ code });
    throw new BadRequestException({ code });
  }
  throw error;
}

@Controller("api/v1/connectors/gitlab/connections/:connectionId/webhooks")
export class GitLabWebhookController {
  constructor(
    @Inject(GITLAB_WEBHOOK_INGRESS_API) private readonly ingress: GitLabWebhookIngressApiPort,
  ) {}

  @Post()
  @HttpCode(202)
  async receive(
    @Param("connectionId") connectionId: string,
    @Headers() rawHeaders: Readonly<Record<string, string | string[] | undefined>>,
    @Req() request: RawRequest,
  ) {
    if (!request.rawBody)
      throw new BadRequestException({ code: "GITLAB_WEBHOOK_RAW_BODY_REQUIRED" });
    const headers = Object.freeze(
      Object.fromEntries(
        Object.entries(rawHeaders).flatMap(([key, value]) =>
          typeof value === "string" ? [[key.toLowerCase(), value]] : [],
        ),
      ),
    );
    try {
      const result = await this.ingress.accept({
        connectionId,
        rawBody: new Uint8Array(request.rawBody),
        contentType: headers["content-type"] ?? "",
        headers,
        receivedAt: new Date(),
      });
      if (result.status === "SECURITY_CONFLICT")
        throw new ConflictException({
          code: "GITLAB_WEBHOOK_DELIVERY_SECURITY_CONFLICT",
          receiptId: result.receiptId,
        });
      return Object.freeze({ status: result.status, receiptId: result.receiptId });
    } catch (error) {
      return mapped(error);
    }
  }
}
