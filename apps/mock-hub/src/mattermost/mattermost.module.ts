import { type DynamicModule, Module } from "@nestjs/common";
import type { DataSource, MigrationInterface } from "typeorm";

import { MattermostState00501700000002050 } from "../persistence/migrations/0050-mattermost-state.ts";
import { MattermostFaults00511700000002051 } from "../persistence/migrations/0051-mattermost-faults.ts";
import { MattermostEffectAudit00521700000002052 } from "../persistence/migrations/0052-mattermost-effect-audit.ts";
import { MattermostController } from "./api/mattermost.controller.ts";
import { MattermostControlController } from "./control/mattermost-control.controller.ts";
import { mattermostMockEntities } from "./state/mattermost.entities.ts";
import { TypeOrmMattermostRepository } from "./state/mattermost.repository.ts";

export { mattermostMockEntities } from "./state/mattermost.entities.ts";
export const mattermostMockMigrations: readonly (new () => MigrationInterface)[] = Object.freeze([
  MattermostState00501700000002050,
  MattermostFaults00511700000002051,
  MattermostEffectAudit00521700000002052,
]);

@Module({})
export class MattermostModule {
  static configured(source: DataSource): DynamicModule {
    return {
      module: MattermostModule,
      controllers: [MattermostController, MattermostControlController],
      providers: [
        {
          provide: TypeOrmMattermostRepository,
          useFactory: () => new TypeOrmMattermostRepository(source),
        },
      ],
      exports: [TypeOrmMattermostRepository],
    };
  }
}

void mattermostMockEntities;
