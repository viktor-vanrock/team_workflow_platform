import { BadRequestException, Body, Controller, Get, Inject, Post } from "@nestjs/common";

import { parseMattermostFault } from "../scenarios/mattermost-scenarios.ts";
import { TypeOrmMattermostRepository } from "../state/mattermost.repository.ts";

@Controller("mock/mattermost")
export class MattermostControlController {
  constructor(
    @Inject(TypeOrmMattermostRepository) private readonly repository: TypeOrmMattermostRepository,
  ) {}

  @Get("state")
  state() {
    return this.repository.snapshot();
  }

  @Post("fault")
  async setFault(@Body() body: Readonly<Record<string, unknown>>) {
    try {
      await this.repository.setFault(
        parseMattermostFault(body.fault),
        typeof body.remaining === "number" ? body.remaining : 1,
      );
      return Object.freeze({ ok: true });
    } catch (error) {
      throw new BadRequestException({
        code: error instanceof Error ? error.message : "MATTERMOST_MOCK_FAULT_INVALID",
      });
    }
  }

  @Post("callbacks")
  async recordCallback(@Body() body: Readonly<Record<string, unknown>>) {
    const callbackKind = String(body.callbackKind ?? "post-action");
    const connectionId = String(body.connectionId ?? "connection-project-alpha");
    const externalUserId = String(body.externalUserId ?? "mm-user-alex");
    await this.repository.recordCallback({
      callbackKind,
      connectionId,
      externalUserId,
      payload: body,
    });
    return Object.freeze({ ok: true });
  }
}
