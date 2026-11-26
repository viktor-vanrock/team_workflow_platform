import { loadEnvironment } from "../config/environment.ts";
import { createRuntimeDataSource } from "../pilot/composition.ts";
import { bootstrapQaJiraProject } from "../seed/qa-jira-project-bootstrap.ts";

const environment = loadEnvironment();
const [workspaceId, projectId, projectDiscriminator, authorityScopeKey] = process.argv.slice(2);
if (
  !workspaceId ||
  !projectId ||
  !projectDiscriminator ||
  !authorityScopeKey ||
  process.argv.length !== 6
)
  throw new Error(
    "USAGE: qa-jira-project-bootstrap <workspace-id> <project-id> <project-discriminator> <authority-scope-key>",
  );
const source = createRuntimeDataSource(environment);
try {
  await source.initialize();
  const refs = await bootstrapQaJiraProject(source, {
    workspaceId,
    projectId,
    projectDiscriminator,
    authorityScopeKey,
  });
  process.stdout.write(`${JSON.stringify(refs, null, 2)}\n`);
} finally {
  if (source.isInitialized) await source.destroy();
}
