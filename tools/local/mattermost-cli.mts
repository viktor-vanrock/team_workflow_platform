const command = process.argv[2] ?? "status";
const allowed = new Set(["up", "status", "migrate", "seed", "down", "reset"]);
if (!allowed.has(command)) throw new Error(`MATTERMOST_LOCAL_COMMAND_UNKNOWN:${command}`);
process.env.AWP_COMPOSITION = "qa-jira-mattermost-local";
await import("./local.mts");
