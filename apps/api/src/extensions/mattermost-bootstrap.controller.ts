import { Body, Controller, HttpCode, Post } from "@nestjs/common";

import { MattermostBootstrapAdapter } from "@awp/runtime-composition";

@Controller("api/v1/public/mattermost")
export class MattermostBootstrapController {
  readonly #adapter = new MattermostBootstrapAdapter(
    process.env.AWP_MATTERMOST_OIDC_CONTINUATION_URL ??
      "http://localhost:5173/qa/mattermost-intake",
  );
  @Post("awp-bootstrap")
  @HttpCode(200)
  bootstrap(@Body() body: unknown) {
    return this.#adapter.respond(body);
  }
}
