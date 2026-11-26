import { runSafeRuntimeEntrypoint } from "@awp/platform-runtime-nest";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { startCorporateWorkerHost } from "./corporate-host.ts";

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href &&
  !(await runSafeRuntimeEntrypoint("worker", async () => {
    await startCorporateWorkerHost();
  }))
)
  process.exitCode = 1;
