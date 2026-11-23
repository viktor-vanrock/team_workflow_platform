import type { DataSource } from "typeorm";

export async function migrateMockHub(dataSource: DataSource): Promise<void> {
  if (!dataSource.isInitialized) await dataSource.initialize();
  await dataSource.runMigrations({ transaction: "all" });
}
