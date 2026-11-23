import { connect, createServer, type Server } from "node:net";

const routes = Object.freeze([
  { listen: 3000, host: "api", port: 3000 },
  { listen: 3010, host: "worker", port: 3010 },
  { listen: 4010, host: "mock-hub", port: 4010 },
  { listen: 4443, host: "fake-idp", port: 4443 },
  { listen: 5173, host: "web", port: 5173 },
] as const);

const servers: Server[] = [];
await Promise.all(
  routes.map(
    async (route) =>
      await new Promise<void>((resolve, reject) => {
        const server = createServer((incoming) => {
          const outgoing = connect({ host: route.host, port: route.port });
          incoming.pipe(outgoing);
          outgoing.pipe(incoming);
          incoming.once("error", () => outgoing.destroy());
          outgoing.once("error", () => incoming.destroy());
        });
        servers.push(server);
        server.once("error", reject);
        server.listen(route.listen, "0.0.0.0", () => {
          server.off("error", reject);
          console.log(`Local edge 127.0.0.1:${route.listen} -> ${route.host}:${route.port}`);
          resolve();
        });
      }),
  ),
);

const shutdown = () => {
  for (const server of servers) server.close();
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
