import { createPlatformDataSource } from "@awp/platform-persistence-typeorm";

import { loadEnvironment } from "../config/environment.ts";
import { qaJiraGitLabLocalEntities, qaJiraGitLabLocalMigrations } from "../gitlab/composition.ts";
import {
  qaJiraGitLabMattermostLocalEntities,
  qaJiraGitLabMattermostLocalMigrations,
} from "../mattermost/gitlab-composition.ts";
import { localMigrations } from "../migrations/composition.ts";
import { localEntities } from "../persistence/entity-composition.ts";
import {
  ensureLocalSeedProjectOnboarding,
  ensurePilotDevelopmentProjects,
} from "../pilot/development-seed.ts";
import {
  qaJiraLocalEntities,
  qaJiraLocalMigrations,
  qaJiraMattermostLocalEntities,
  qaJiraMattermostLocalMigrations,
  qaLocalEntities,
  qaLocalMigrations,
  selectRuntimeComposition,
} from "../qa/composition.ts";
import { LOCAL_SEED_KEY, LOCAL_SEED_VERSION, runLocalSeed } from "../seed/local-seed.ts";
import { runOwnerProjectRegistrarLocalSeed } from "../seed/owner-project-registrar-seed.ts";
import { runPlatformAccessLocalSeed } from "../seed/platform-access-seed.ts";
import { runProjectMetadataLocalSeed } from "../seed/project-metadata-seed.ts";
import {
  QA_JIRA_GITLAB_LOCAL_SEED_KEY,
  QA_JIRA_GITLAB_LOCAL_SEED_VERSION,
  runQaJiraGitLabLocalSeed,
} from "../seed/qa-jira-gitlab-local-seed.ts";
import {
  QA_JIRA_GITLAB_MATTERMOST_QUEUE_LOCAL_SEED_KEY,
  QA_JIRA_GITLAB_MATTERMOST_QUEUE_LOCAL_SEED_VERSION,
  runQaJiraGitLabMattermostQueueLocalSeed,
} from "../seed/qa-jira-gitlab-mattermost-queue-local-seed.ts";
import {
  QA_JIRA_LOCAL_SEED_KEY,
  QA_JIRA_LOCAL_SEED_VERSION,
  runQaJiraLocalSeed,
} from "../seed/qa-jira-local-seed.ts";
import {
  QA_JIRA_MATTERMOST_LOCAL_SEED_KEY,
  QA_JIRA_MATTERMOST_LOCAL_SEED_VERSION,
  runQaJiraMattermostLocalSeed,
} from "../seed/qa-jira-mattermost-local-seed.ts";
import { QA_LOCAL_SEED_KEY, QA_LOCAL_SEED_VERSION, runQaLocalSeed } from "../seed/qa-local-seed.ts";
import { runTechWritingLocalSeed } from "../seed/tech-writing-local-seed.ts";

const environment = loadEnvironment();
if (environment.profile !== "local") throw new Error("LOCAL_SEED_PROFILE_REQUIRED");
const composition = selectRuntimeComposition(process.env, environment);
const gitLabComposition =
  composition === "qa-jira-gitlab-local" || composition === "qa-jira-gitlab-mattermost-local";
const qaComposition =
  composition === "qa-local" ||
  composition === "qa-jira-local" ||
  composition === "qa-jira-mattermost-local" ||
  gitLabComposition;
const source = createPlatformDataSource({
  url: environment.databaseUrl,
  entities:
    composition === "qa-jira-gitlab-mattermost-local"
      ? qaJiraGitLabMattermostLocalEntities
      : composition === "qa-jira-gitlab-local"
        ? qaJiraGitLabLocalEntities
        : composition === "qa-jira-mattermost-local"
          ? qaJiraMattermostLocalEntities
          : composition === "qa-jira-local"
            ? qaJiraLocalEntities
            : composition === "qa-local"
              ? qaLocalEntities
              : localEntities,
  migrations:
    composition === "qa-jira-gitlab-mattermost-local"
      ? qaJiraGitLabMattermostLocalMigrations
      : composition === "qa-jira-gitlab-local"
        ? qaJiraGitLabLocalMigrations
        : composition === "qa-jira-mattermost-local"
          ? qaJiraMattermostLocalMigrations
          : composition === "qa-jira-local"
            ? qaJiraLocalMigrations
            : composition === "qa-local"
              ? qaLocalMigrations
              : localMigrations,
});
try {
  await source.initialize();
  // Base identity upgrades must run even when the selected pack seed is current.
  await runLocalSeed(source);
  const markerTables = (await source.query(
    "SELECT to_regclass('public.local_seed_markers') AS table_name",
  )) as readonly { table_name: string | null }[];
  const queueComposition =
    composition === "qa-jira-gitlab-mattermost-local" &&
    process.env.AWP_QUEUE_STATIC_CONTOUR === "true";
  const seedKey = queueComposition
    ? QA_JIRA_GITLAB_MATTERMOST_QUEUE_LOCAL_SEED_KEY
    : gitLabComposition
      ? QA_JIRA_GITLAB_LOCAL_SEED_KEY
      : composition === "qa-jira-mattermost-local"
        ? QA_JIRA_MATTERMOST_LOCAL_SEED_KEY
        : composition === "qa-jira-local"
          ? QA_JIRA_LOCAL_SEED_KEY
          : qaComposition
            ? QA_LOCAL_SEED_KEY
            : LOCAL_SEED_KEY;
  const seedVersion = queueComposition
    ? QA_JIRA_GITLAB_MATTERMOST_QUEUE_LOCAL_SEED_VERSION
    : gitLabComposition
      ? QA_JIRA_GITLAB_LOCAL_SEED_VERSION
      : composition === "qa-jira-mattermost-local"
        ? QA_JIRA_MATTERMOST_LOCAL_SEED_VERSION
        : composition === "qa-jira-local"
          ? QA_JIRA_LOCAL_SEED_VERSION
          : qaComposition
            ? QA_LOCAL_SEED_VERSION
            : LOCAL_SEED_VERSION;
  const markers = markerTables[0]?.table_name
    ? ((await source.query("SELECT version FROM local_seed_markers WHERE key=$1", [
        seedKey,
      ])) as readonly { version: number }[])
    : [];
  if (Number(markers[0]?.version) === seedVersion) {
    console.log(`${composition} seed unchanged`);
    process.exitCode = 0;
  } else {
    const result = queueComposition
      ? await runQaJiraGitLabMattermostQueueLocalSeed(source, environment)
      : gitLabComposition
        ? await runQaJiraGitLabLocalSeed(source, environment)
        : composition === "qa-jira-mattermost-local"
          ? await runQaJiraMattermostLocalSeed(source, environment)
          : composition === "qa-jira-local"
            ? await runQaJiraLocalSeed(source, environment)
            : composition === "qa-local"
              ? await runQaLocalSeed(source)
              : await runLocalSeed(source);
    console.log(`${composition} seed ${result}`);
  }
  console.log(`tech-writing seed ${await runTechWritingLocalSeed(source)}`);
  await runPlatformAccessLocalSeed(source, environment.identityIssuer);
  await runOwnerProjectRegistrarLocalSeed(source, environment.identityIssuer);
  await runProjectMetadataLocalSeed(source, environment.identityIssuer);
  if (process.env.AWP_PILOT_ADAPTER_MODE === "development")
    await ensurePilotDevelopmentProjects(source, environment);
  else await ensureLocalSeedProjectOnboarding(source, environment);
} finally {
  if (source.isInitialized) await source.destroy();
}
