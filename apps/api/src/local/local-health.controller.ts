import { Controller, Get, Inject, Res } from "@nestjs/common";
import type { DataSource } from "typeorm";

import { localReadinessReport } from "@awp/runtime-composition";

import { LOCAL_PERSONA_DATA_SOURCE } from "./local-persona.controller.ts";

@Controller("health")
export class LocalHealthController {
  constructor(@Inject(LOCAL_PERSONA_DATA_SOURCE) private readonly dataSource: DataSource) {}
  @Get("live") live() {
    return { status: "UP", runtime: { profile: "local" } };
  }
  @Get("ready") async ready(@Res({ passthrough: true }) response: { status(code: number): void }) {
    const report = await localReadinessReport(this.dataSource);
    response.status(report.status === "UP" ? 200 : 503);
    return report;
  }
}
