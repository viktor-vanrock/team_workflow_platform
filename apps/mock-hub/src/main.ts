import "reflect-metadata";

import { NestFactory } from "@nestjs/core";

import { MockHubAppModule } from "./app.module.ts";
import { MockHubService } from "./mock-hub.controller.ts";
import { MockOperationalService } from "./operational/operational.controller.ts";
import { TypeOrmMockOperationalRepository } from "./operational/operational.repository.ts";
import { createMockHubDataSource } from "./persistence/data-source.ts";
import { migrateMockHub } from "./persistence/migration-runner.ts";
import { TypeOrmMockStateRepository } from "./persistence/mock-state.repository.ts";

export async function bootstrapMockHub(): Promise<void> {
  const url = process.env.MOCK_HUB_DATABASE_URL;
  if (!url) throw new Error("MOCK_HUB_DATABASE_URL is required");
  const source = createMockHubDataSource(url);
  await migrateMockHub(source);
  const scenarios = new TypeOrmMockStateRepository(source);
  const service = new MockHubService(scenarios);
  const operational = new MockOperationalService(
    new TypeOrmMockOperationalRepository(source),
    scenarios,
  );
  const app = await NestFactory.create(MockHubAppModule.configured(service, operational, source));
  app.enableShutdownHooks();
  const shutdown = async () => {
    await app.close();
    if (source.isInitialized) await source.destroy();
  };
  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());
  await app.listen(Number(process.env.PORT ?? 4010), "0.0.0.0");
}
if (import.meta.url === `file://${process.argv[1]}`) await bootstrapMockHub();
