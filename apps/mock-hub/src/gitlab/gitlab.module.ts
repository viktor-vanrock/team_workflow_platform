import { type DynamicModule, Module } from "@nestjs/common";
import type { DataSource, MigrationInterface } from "typeorm";

import { GitLabMockProjectState00601700000002060 } from "../persistence/migrations/0060-gitlab-state.ts";
import { GitLabMockPipelineArtifacts00611700000002061 } from "../persistence/migrations/0061-gitlab-results-artifacts.ts";
import { GitLabMockWebhookFaultAudit00621700000002062 } from "../persistence/migrations/0062-gitlab-effects-faults-webhooks.ts";
import {
  assertGitLabMockProtocolOperation,
  GitLabController,
  gitLabMockProtocolSurface,
} from "./api/gitlab.controller.ts";
import {
  authorizeGitLabMockControl,
  GitLabControlController,
  GitLabMockControlPolicy,
} from "./control/gitlab-control.controller.ts";
import {
  gitLabDeterministicTerminalFixtures,
  gitLabFoundationScenarioIds,
  gitLabScenarioCatalog,
  gitLabUs1ScenarioIds,
  gitLabUs2ScenarioIds,
  gitLabUs3ScenarioIds,
  gitLabUs4ScenarioIds,
} from "./scenarios/gitlab-scenarios.ts";
import { gitLabMockEntities } from "./state/gitlab.entities.ts";
import { seedGitLabRepository, TypeOrmGitLabRepository } from "./state/gitlab.repository.ts";
import { GitLabWebhookEmitter } from "./webhooks/gitlab-webhook-emitter.ts";

export {
  assertGitLabMockProtocolOperation,
  authorizeGitLabMockControl,
  gitLabDeterministicTerminalFixtures,
  gitLabFoundationScenarioIds,
  gitLabMockEntities,
  gitLabMockProtocolSurface,
  gitLabScenarioCatalog,
  gitLabUs1ScenarioIds,
  gitLabUs2ScenarioIds,
  gitLabUs3ScenarioIds,
  gitLabUs4ScenarioIds,
  seedGitLabRepository,
  TypeOrmGitLabRepository,
};

export const gitLabMockMigrations: readonly (new () => MigrationInterface)[] = Object.freeze([
  GitLabMockProjectState00601700000002060,
  GitLabMockPipelineArtifacts00611700000002061,
  GitLabMockWebhookFaultAudit00621700000002062,
]);

export interface GitLabModuleOptions {
  readonly controlKey?: string;
  readonly allowedControlProjectIds?: readonly number[];
}

@Module({})
export class GitLabModule {
  static configured(source: DataSource, options: GitLabModuleOptions = {}): DynamicModule {
    return {
      module: GitLabModule,
      controllers: [GitLabController, GitLabControlController],
      providers: [
        { provide: TypeOrmGitLabRepository, useFactory: () => new TypeOrmGitLabRepository(source) },
        { provide: GitLabWebhookEmitter, useFactory: () => new GitLabWebhookEmitter(source) },
        {
          provide: GitLabMockControlPolicy,
          useValue: new GitLabMockControlPolicy(
            options.controlKey ?? "local-gitlab-control",
            options.allowedControlProjectIds ?? [5001],
          ),
        },
      ],
      exports: [TypeOrmGitLabRepository, GitLabWebhookEmitter],
    };
  }
}

void gitLabMockEntities;
