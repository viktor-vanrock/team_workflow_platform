import { prepareQaWorkspace } from "../../packages/runtime-composition/src/bootstrap/qa-workspace.ts";
import { createWorkspaceInstallationDataSource } from "../../packages/runtime-composition/src/bootstrap/workspace-installation.ts";

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
