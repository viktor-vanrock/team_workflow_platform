import { coreMigrationRegistry, migrationClasses } from "@awp/platform-persistence-typeorm";

export const coreOnlyMigrationRegistry = coreMigrationRegistry;
export const coreOnlyMigrations = migrationClasses(coreOnlyMigrationRegistry);
