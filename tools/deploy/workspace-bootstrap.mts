import {
  bootstrapDevSuperadmins,
  devBootstrapSubjects,
} from "../../packages/runtime-composition/src/bootstrap/dev-superadmin.ts";
import { registerQaNonproductionManifest } from "../../packages/runtime-composition/src/bootstrap/qa-nonproduction-manifest.ts";
import { prepareQaWorkspace } from "../../packages/runtime-composition/src/bootstrap/qa-workspace.ts";
import {
  createWorkspaceInstallationDataSource,
  loadWorkspaceInstallationConfig,
} from "../../packages/runtime-composition/src/bootstrap/workspace-installation.ts";

let source: ReturnType<typeof createWorkspaceInstallationDataSource> | undefined;
try {
  source = createWorkspaceInstallationDataSource();
  await source.initialize();
  const runner = source.createQueryRunner();
  await runner.connect();
  try {
    await runner.query(
      "SELECT pg_advisory_lock(hashtextextended('workspace-installation-migrations',0))",
    );
    await source.runMigrations({ transaction: "all" });
    const workspaceId = await prepareQaWorkspace(source);
    if (process.env.AWP_SUPERADMIN_ENVIRONMENT === "dev")
      await registerQaNonproductionManifest(source, process.env.AWP_SUPERADMIN_ENVIRONMENT);
    if (process.env.AWP_SUPERADMIN_ENVIRONMENT !== "dev") {
      console.warn("DEV_SUPERADMIN_BOOTSTRAP_SKIPPED: environment is not dev");
    } else if (process.env.AWP_BOOTSTRAP_SUPERADMIN_SUBJECT) {
      const subjects = devBootstrapSubjects(process.env);
      const missing = await bootstrapDevSuperadmins(
        source,
        loadWorkspaceInstallationConfig().tokens.issuer,
        subjects,
      );
      if (missing)
        console.warn(
          `DEV_SUPERADMIN_IDENTITIES_NOT_FOUND: ${missing}; users must sign in before the next deployment`,
        );
    }
    console.log(
      JSON.stringify({ status: "READY", workspaceId, workspaceKey: "qa", projectsCreated: 0 }),
    );
  } finally {
    await runner.query(
      "SELECT pg_advisory_unlock(hashtextextended('workspace-installation-migrations',0))",
    );
    await runner.release();
  }
} catch (error) {
  const message = error instanceof Error ? error.message : "unknown";
  const safe = message.replace(/postgres(?:ql)?:\/\/\S+/gi, "postgresql://redacted").slice(0, 500);
  console.error(`WORKSPACE_BOOTSTRAP_FAILED: ${safe}`);
  process.exitCode = 1;
} finally {
  if (source?.isInitialized) await source.destroy();
}
