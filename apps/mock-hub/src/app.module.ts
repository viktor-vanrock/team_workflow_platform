import { Controller, Get, Module } from "@nestjs/common";
import type { DataSource } from "typeorm";

import { GitLabModule } from "./gitlab/gitlab.module.ts";
import { JiraModule } from "./jira/jira.module.ts";
import { MattermostModule } from "./mattermost/mattermost.module.ts";
import { MockHubController, MockHubService } from "./mock-hub.controller.ts";
import {
  MockOperationalService,
  OperationalController,
} from "./operational/operational.controller.ts";
import { PilotCapabilitiesController } from "./pilot-capabilities.controller.ts";

@Controller("health")
export class MockHealthController {
  @Get("live") live() {
    return { status: "UP", service: "mock-hub" };
  }
}

@Module({})
export class MockHubAppModule {
  static configured(mock: MockHubService, operational: MockOperationalService, source: DataSource) {
    @Module({
      imports: [
        JiraModule.configured(source),
        MattermostModule.configured(source),
        GitLabModule.configured(source),
      ],
      controllers: [
        MockHealthController,
        MockHubController,
        OperationalController,
        PilotCapabilitiesController,
      ],
      providers: [
        { provide: MockHubService, useValue: mock },
        { provide: MockOperationalService, useValue: operational },
      ],
    })
    class ConfiguredMockHubModule {}
    return ConfiguredMockHubModule;
  }
}
