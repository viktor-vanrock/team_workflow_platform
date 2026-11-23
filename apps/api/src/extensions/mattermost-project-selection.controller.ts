import { Body, Controller, HttpCode, Inject, Post, Req, UseGuards } from "@nestjs/common";

import { QaSessionGuard } from "./qa-api-authorization.ts";

export const MATTERMOST_PROJECT_SELECTION = Symbol("MATTERMOST_PROJECT_SELECTION");
export interface MattermostProjectSelectionPort {
  issue(request: object): Promise<Readonly<{ items: readonly unknown[] }>>;
  consume(
    request: object,
    body: Readonly<{ intentId: string; intentToken: string; requestKey: string }>,
  ): Promise<Readonly<{ draft: unknown; replayed: boolean }>>;
}

@Controller("api/v1/intake/mattermost")
@UseGuards(QaSessionGuard)
export class MattermostProjectSelectionController {
  constructor(
    @Inject(MATTERMOST_PROJECT_SELECTION)
    private readonly selections: MattermostProjectSelectionPort,
  ) {}

  @Post("project-option-sets")
  async options(@Req() request: object) {
    return this.selections.issue(request);
  }

  @Post("project-selections")
  @HttpCode(201)
  async select(
    @Req() request: object,
    @Body() body: Readonly<{ intentId: string; intentToken: string; requestKey: string }>,
  ) {
    return this.selections.consume(request, body);
  }
}
