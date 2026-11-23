import "reflect-metadata";

import { DataSource, type EntitySchema, type MigrationInterface } from "typeorm";

export interface PlatformDataSourceOptions {
  readonly url: string;
  readonly entities: readonly EntitySchema[];
  readonly migrations: readonly (new () => MigrationInterface)[];
  readonly logging?: boolean;
}

export function createPlatformDataSource(options: PlatformDataSourceOptions): DataSource {
  return new DataSource({
    type: "postgres",
    url: options.url,
    entities: [...options.entities],
    migrations: [...options.migrations],
    migrationsTableName: "typeorm_migrations",
    migrationsRun: false,
    migrationsTransactionMode: "all",
    synchronize: false,
    logging: options.logging ?? false,
  });
}
