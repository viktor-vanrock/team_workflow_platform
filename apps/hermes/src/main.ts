import { loadHermesServiceConfig } from "@awp/runtime-composition";

import { createHermesServer } from "./server.ts";

try {
  const config = loadHermesServiceConfig(),
    server = createHermesServer(config);
  server.on("error", () => {
    console.error("HERMES_LISTEN_FAILED");
    process.exitCode = 1;
  });
  server.listen(config.port, "0.0.0.0", () =>
    console.info(
      JSON.stringify({ service: "hermes", version: 1, mode: config.mode, status: "STARTED" }),
    ),
  );
  const shutdown = () => {
    server.close(() => {
      process.exitCode = 0;
    });
    setTimeout(() => server.closeAllConnections(), 5000).unref();
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
} catch {
  console.error("HERMES_CONFIGURATION_INVALID");
  process.exitCode = 1;
}
