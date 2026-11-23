import "reflect-metadata";

import { DataSource, type MigrationInterface } from "typeorm";

import { gitLabMockMigrations } from "../gitlab/gitlab.module.ts";
import { mattermostMockMigrations } from "../mattermost/mattermost.module.ts";
import { mockHubEntities } from "./entities.ts";
import { MockState00011700000001000 } from "./migrations/0001-mock-state.ts";
import { OperationalRequests00201700000002000 } from "./migrations/0020-operational-requests.ts";
import { OperationalRequestReady00211700000002001 } from "./migrations/0021-operational-request-ready.ts";
import { OperationalDefects00221700000002002 } from "./migrations/0022-operational-defects.ts";
import { OperationalCompletion00301700000002030 } from "./migrations/0030-operational-completion.ts";
import { JiraState00401700000002040 } from "./migrations/0040-jira-state.ts";
import { JiraFaultScenarios00411700000002041 } from "./migrations/0041-jira-fault-scenarios.ts";
import { JiraEffectCallAudit00421700000002042 } from "./migrations/0042-jira-effect-call-audit.ts";

export const mockHubMigrations = Object.freeze([
  MockState00011700000001000,
  OperationalRequests00201700000002000,
  OperationalRequestReady00211700000002001,
  OperationalDefects00221700000002002,
  OperationalCompletion00301700000002030,
  JiraState00401700000002040,
  JiraFaultScenarios00411700000002041,
  JiraEffectCallAudit00421700000002042,
  ...mattermostMockMigrations,
  ...gitLabMockMigrations,
]);
type MockHubMigration = new () => MigrationInterface;

export function createMockHubDataSource(
  url: string,
  migrations: readonly MockHubMigration[] = mockHubMigrations,
): DataSource {
  return new DataSource({
    type: "postgres",
    url,
    entities: [...mockHubEntities],
    migrations: [...migrations],
    migrationsTableName: "mock_hub_migrations",
    migrationsRun: false,
    migrationsTransactionMode: "all",
    synchronize: false,
  });
}
