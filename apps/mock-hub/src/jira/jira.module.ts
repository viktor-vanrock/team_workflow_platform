import { type DynamicModule, Module } from "@nestjs/common";
import type { DataSource } from "typeorm";

import { JiraController } from "./jira.controller.ts";
import { JiraMockService, TypeOrmJiraRepository } from "./jira.repository.ts";
import { JiraScenarioController, TypeOrmJiraScenarioRepository } from "./jira-scenarios.ts";

@Module({})
export class JiraModule {
  static configured(source: DataSource): DynamicModule {
    return {
      module: JiraModule,
      controllers: [JiraController],
      providers: [
        {
          provide: JiraMockService,
          useFactory: () => new JiraMockService(new TypeOrmJiraRepository(source)),
        },
        {
          provide: JiraScenarioController,
          useFactory: () => new JiraScenarioController(new TypeOrmJiraScenarioRepository(source)),
        },
      ],
      exports: [JiraMockService, JiraScenarioController],
    };
  }
}
