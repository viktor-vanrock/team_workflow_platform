import { createServer } from "node:http";

import type { ConnectorCommand } from "../../packages/platform-core/src/index.ts";
import type {
  QaCompletionEffectConfirmation,
  QaCompletionEffectPort,
} from "../../packages/runtime-composition/src/pilot/completion-worker.ts";

/** Controlled HTTP effect ledger, deliberately not a corporate Jira conformance adapter. */
export async function start008CompletionProvider(
  confirmationFor: (command: ConnectorCommand) => QaCompletionEffectConfirmation,
) {
  const effects = new Map<string, QaCompletionEffectConfirmation>();
  let posts = 0;
  let reads = 0;
  let visibility: "FOUND" | "UNKNOWN" | "ABSENT" | "MULTIPLE" = "FOUND";
  let pending: ConnectorCommand | undefined;
  const server = createServer((request, response) => {
    if (request.method === "POST" && request.url === "/effects" && pending) {
      posts++;
      const effect = confirmationFor(pending);
      effects.set(pending.effectIdempotencyKey, effect);
      request.resume();
      response.destroy(); // The provider committed; the caller never receives its response.
      return;
    }
    if (request.method === "GET" && request.url?.startsWith("/effects/")) {
      reads++;
      const effect = effects.get(decodeURIComponent(request.url.slice("/effects/".length)));
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify(
          visibility === "FOUND" && effect
            ? {
                state: "FOUND",
                confirmation: {
                  ...effect,
                  observation: { ...effect.observation, source: "RECONCILIATION_READ" },
                },
              }
            : { state: visibility === "FOUND" ? "ABSENT" : visibility },
        ),
      );
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("COMPLETION_TEST_HTTP_ADDRESS");
  const url = `http://127.0.0.1:${address.port}`;
  const port: QaCompletionEffectPort = {
    execute: async (command) => {
      pending = command;
      const response = await fetch(`${url}/effects`, {
        method: "POST",
        body: JSON.stringify(command.payload),
        signal: AbortSignal.timeout(5000),
      });
      return (await response.json()) as QaCompletionEffectConfirmation;
    },
    lookup: async (command) => {
      const response = await fetch(
        `${url}/effects/${encodeURIComponent(command.effectIdempotencyKey)}`,
        { signal: AbortSignal.timeout(5000) },
      );
      return (await response.json()) as Awaited<ReturnType<QaCompletionEffectPort["lookup"]>>;
    },
  };
  return {
    port,
    get posts() {
      return posts;
    },
    get reads() {
      return reads;
    },
    visibility: (value: typeof visibility) => {
      visibility = value;
    },
    stop: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}
