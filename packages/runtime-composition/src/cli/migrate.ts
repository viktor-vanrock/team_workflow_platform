import { migrateLocalDatabase } from "../bootstrap/local-bootstrap.ts";
import { loadEnvironment } from "../config/environment.ts";
import { createRuntimeDataSource, runtimePersistence } from "../pilot/composition.ts";

const environment = loadEnvironment();
if (environment.profile !== "local") throw new Error("LOCAL_MIGRATE_PROFILE_REQUIRED");
const source = createRuntimeDataSource(environment);
const { expectedVersions } = runtimePersistence(environment.composition);
try {
  await migrateLocalDatabase(source, { profile: environment.profile, expectedVersions });
  console.log(
    `${environment.composition} schema is current (${Object.entries(expectedVersions)
      .map(([namespace, version]) => `${namespace}=${version}`)
      .join(", ")})`,
  );
} finally {
  if (source.isInitialized) await source.destroy();
}
