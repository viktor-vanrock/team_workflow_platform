import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const workspace = resolve(import.meta.dirname, "../..");
const confirmationArgs = process.argv.slice(2).filter((value) => value !== "--");
const result = spawnSync(
  process.execPath,
  [resolve(import.meta.dirname, "local.mts"), "reset", ...confirmationArgs],
  { cwd: workspace, stdio: "inherit", env: process.env },
);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
