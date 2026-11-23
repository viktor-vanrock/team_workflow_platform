import { Controller, Get, Inject, Optional, Res } from "@nestjs/common";

import {
  DEPLOYMENT_READINESS,
  type DeploymentReadinessRuntime,
  ReadinessService,
} from "@awp/platform-runtime-nest";

const readiness = new ReadinessService(process.env.AWP_RUNTIME_PROFILE ?? "unset");
@Controller("health")
export class HealthController {
  constructor(
    @Optional()
    @Inject(DEPLOYMENT_READINESS)
    private readonly deployment?: DeploymentReadinessRuntime,
  ) {}
  @Get("live") live() {
    return readiness.liveness();
  }
  @Get("ready") async ready(@Res({ passthrough: true }) response: { status(code: number): void }) {
    const deployment = this.deployment
      ? await this.deployment
          .readiness()
          .catch(() => ({ ready: false, reasonCode: "DEPLOYMENT_INPUT_UNAVAILABLE" }))
      : { ready: false, reasonCode: "DEPLOYMENT_STARTUP_REQUIRED" };
    response.status(deployment.ready ? 200 : 503);
    return { ...readiness.liveness(), status: deployment.ready ? "UP" : "DOWN", deployment };
  }
}
