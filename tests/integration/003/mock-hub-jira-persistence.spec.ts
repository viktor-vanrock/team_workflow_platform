import { describe, expect, it } from "vitest";

import { MockHubAppModule } from "../../../apps/mock-hub/src/app.module.ts";
import { JiraModule } from "../../../apps/mock-hub/src/jira/jira.module.ts";
import { JiraMockService } from "../../../apps/mock-hub/src/jira/jira.repository.ts";
import { MockHubService } from "../../../apps/mock-hub/src/mock-hub.controller.ts";
import { MockOperationalService } from "../../../apps/mock-hub/src/operational/operational.controller.ts";
import { TypeOrmMockOperationalRepository } from "../../../apps/mock-hub/src/operational/operational.repository.ts";
import { createMockHubDataSource } from "../../../apps/mock-hub/src/persistence/data-source.ts";
import { migrateMockHub } from "../../../apps/mock-hub/src/persistence/migration-runner.ts";
import { TypeOrmMockStateRepository } from "../../../apps/mock-hub/src/persistence/mock-state.repository.ts";
import { startPostgres } from "../../../packages/platform-testkit/src/index.ts";

interface NestProvider {
  readonly provide?: unknown;
  readonly useFactory?: () => unknown;
  readonly useValue?: unknown;
}

function moduleMetadata<T>(target: object, key: string): T {
  return (
    Reflect as typeof Reflect & {
      getMetadata(metadataKey: string, metadataTarget: object): unknown;
    }
  ).getMetadata(key, target) as T;
}

function configuredServices(source: ReturnType<typeof createMockHubDataSource>): {
  readonly jira: JiraMockService;
  readonly mock: MockHubService;
  readonly operational: MockOperationalService;
} {
  const scenarios = new TypeOrmMockStateRepository(source);
  const mock = new MockHubService(scenarios);
  const operational = new MockOperationalService(
    new TypeOrmMockOperationalRepository(source),
    scenarios,
  );
  const configured = MockHubAppModule.configured(mock, operational, source);
  const rootProviders = moduleMetadata<readonly NestProvider[]>(configured, "providers");
  expect(rootProviders.find(({ provide }) => provide === MockHubService)?.useValue).toBe(mock);
  expect(rootProviders.find(({ provide }) => provide === MockOperationalService)?.useValue).toBe(
    operational,
  );

  const imports = moduleMetadata<readonly unknown[]>(configured, "imports");
  const jiraModule = imports.find(
    (candidate) =>
      typeof candidate === "object" &&
      candidate !== null &&
      (candidate as { readonly module?: unknown }).module === JiraModule,
  ) as { readonly providers?: readonly NestProvider[] } | undefined;
  const jiraFactory = jiraModule?.providers?.find(
    ({ provide }) => provide === JiraMockService,
  )?.useFactory;
  if (!jiraFactory) throw new Error("JIRA_PERSISTENT_RUNTIME_PROVIDER_MISSING");
  const jira = jiraFactory();
  if (!(jira instanceof JiraMockService)) throw new Error("JIRA_RUNTIME_PROVIDER_INVALID");
  return { jira, mock, operational };
}

describe("Feature 003 Mock Hub Jira runtime persistence", () => {
  it("uses the existing Mock Hub DataSource and survives a runtime restart", async () => {
    const postgres = await startPostgres();
    let source = createMockHubDataSource(postgres.url);
    try {
      await migrateMockHub(source);
      const { jira } = configuredServices(source);
      const created = await jira.createIssue({
        projectId: "100",
        issueTypeId: "10001",
        fields: { summary: "Persistent QA request" },
        marker: "effect:persistent-runtime",
      });
      expect(
        await source.query("SELECT marker FROM jira_mock_issues WHERE id = $1", [created.id]),
      ).toEqual([{ marker: "effect:persistent-runtime" }]);

      await source.destroy();
      source = createMockHubDataSource(postgres.url);
      await migrateMockHub(source);
      expect(
        await configuredServices(source).jira.searchByMarker("effect:persistent-runtime"),
      ).toEqual([expect.objectContaining({ id: created.id, key: created.key })]);
    } finally {
      if (source.isInitialized) await source.destroy();
      await postgres.stop();
    }
  }, 120_000);
});
