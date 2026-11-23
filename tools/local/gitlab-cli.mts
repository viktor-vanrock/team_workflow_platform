const command = process.argv[2] ?? "status";
const allowed = new Set(["up", "status", "migrate", "seed", "down", "reset"]);
if (!allowed.has(command)) throw new Error(`GITLAB_LOCAL_COMMAND_UNKNOWN:${command}`);
process.env.AWP_COMPOSITION =
  process.env.AWP_GITLAB_WITH_MATTERMOST === "true"
    ? "qa-jira-gitlab-mattermost-local"
    : "qa-jira-gitlab-local";
await import("./local.mts");
