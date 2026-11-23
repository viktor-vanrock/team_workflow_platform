import type { DataSource } from "typeorm";

export class OneShotMigrationRunner {
  constructor(
    private readonly dataSource: DataSource,
    private readonly namespace: string,
    private readonly expectedVersion: number,
  ) {}

  async run(): Promise<void> {
    if (!this.dataSource.isInitialized) await this.dataSource.initialize();
    await this.dataSource.query("SELECT pg_advisory_lock(hashtext($1))", [
      `awp:migrate:${this.namespace}`,
    ]);
    try {
      await this.dataSource.runMigrations({ transaction: "all" });
      await this.assertCurrentSchema();
    } finally {
      await this.dataSource.query("SELECT pg_advisory_unlock(hashtext($1))", [
        `awp:migrate:${this.namespace}`,
      ]);
    }
  }

  async assertCurrentSchema(): Promise<void> {
    const rows = (await this.dataSource.query(
      "SELECT version FROM platform_schema_versions WHERE namespace = $1",
      [this.namespace],
    )) as readonly { version: number }[];
    if (rows.length !== 1 || Number(rows[0]?.version) !== this.expectedVersion)
      throw new Error(`Schema ${this.namespace} is not current; expected ${this.expectedVersion}`);
  }
}
