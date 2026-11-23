import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  GenericContainer,
  Network,
  type StartedNetwork,
  type StartedTestContainer,
  Wait,
} from "testcontainers";
import { afterAll, expect, it } from "vitest";

const image = process.env.AWP_TEST_WORKSPACE_IMAGE;
let network: StartedNetwork | undefined,
  postgres: StartedTestContainer | undefined,
  app: StartedTestContainer | undefined,
  hermes: StartedTestContainer | undefined;
afterAll(async () => {
  await app?.stop();
  await hermes?.stop();
  await postgres?.stop();
  await network?.stop();
});
it.skipIf(!image)(
  "image migrates an empty database and serves the corporate SPA with ready health",
  async () => {
    network = await new Network().start();
    postgres = await new GenericContainer("postgres:18.6-bookworm")
      .withNetwork(network)
      .withNetworkAliases("database")
      .withEnvironment({
        POSTGRES_DB: "awp_test",
        POSTGRES_USER: "awp_test",
        POSTGRES_PASSWORD: "fixture-only",
      })
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/u, 2))
      .start();
    const hermesToken = randomBytes(32).toString("base64url");
    hermes = await new GenericContainer(image!)
      .withNetwork(network)
      .withNetworkAliases("hermes")
      .withCommand(["pnpm", "--filter", "@awp/hermes", "start"])
      .withEnvironment({ PORT: "3020", AWP_HERMES_TOKEN_PATH: "/tmp/hermes-token" })
      .withCopyContentToContainer([{ content: hermesToken, target: "/tmp/hermes-token" }])
      .withExposedPorts(3020)
      .withWaitStrategy(Wait.forHttp("/health/ready", 3020).forStatusCode(200))
      .start();
    const database = {
      AWP_WORKSPACE_DATABASE_URL: "postgresql://awp_test:fixture-only@database:5432/awp_test",
      AWP_WORKSPACE_DATABASE_TLS: "disable",
    };
    await new GenericContainer(image!)
      .withNetwork(network)
      .withEnvironment(database)
      .withCommand(["pnpm", "deploy:workspace:bootstrap"])
      .withWaitStrategy(Wait.forOneShotStartup())
      .start();
    const config = JSON.parse(readFileSync("infra/deploy/workspace.config.example.json", "utf8"));
    config.session.policyRef.contentHash = `sha256:${"a".repeat(64)}`;
    config.network.ref.contentHash = `sha256:${"b".repeat(64)}`;
    config.network.validUntil = new Date(Date.now() + 600_000).toISOString();
    config.network.endpoints[0].addressRanges = ["10.0.0.1/32"];
    config.session.stepUp.acrValues = ["urn:fixture:mfa"];
    // Startup deliberately needs no OIDC call. Real login behavior is tested against the signed fixture separately.
    let output = "";
    app = await new GenericContainer(image!)
      .withNetwork(network)
      .withEnvironment({
        ...database,
        AWP_HERMES_URL: "http://hermes:3020",
        AWP_HERMES_TOKEN_PATH: "/tmp/hermes-token",
        AWP_WORKSPACE_CONFIG_PATH: "/tmp/workspace.json",
        AWP_SESSION_KEYS_PATH: "/tmp/keys.json",
      })
      .withCopyContentToContainer([
        { content: hermesToken, target: "/tmp/hermes-token" },
        { content: JSON.stringify(config), target: "/tmp/workspace.json" },
        {
          content: JSON.stringify({ "qa-session-1": randomBytes(32).toString("base64") }),
          target: "/tmp/keys.json",
        },
      ])
      .withLogConsumer((stream) => {
        stream.on("data", (line) => {
          output += String(line);
        });
      })
      .withExposedPorts(3000)
      .withWaitStrategy(Wait.forHttp("/health/ready", 3000).forStatusCode(200))
      .start()
      .catch((error: unknown) => {
        throw new Error(`Workspace image failed: ${output.slice(-4000)}`, { cause: error });
      });
    const origin = `http://${app.getHost()}:${app.getMappedPort(3000)}`;
    for (const path of [
      "/",
      "/access",
      "/admin/users",
      "/projects",
      "/projects/new",
      "/projects/hermes",
      "/projects/77777777-7777-4777-8777-777777777777/edit",
    ]) {
      const response = await fetch(`${origin}${path}`);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
      expect(await response.text()).toContain('id="root"');
    }
    expect((await fetch(`${origin}/api/v1/auth/session`)).status).toBe(401);
    expect((await fetch(`${origin}/api/v1/missing`)).status).toBe(404);
    expect((await fetch(`${origin}/local/persona/personas`)).status).toBe(404);
    // A second bootstrap must finish successfully while the application serves the same workspace.
    await new GenericContainer(image!)
      .withNetwork(network)
      .withEnvironment(database)
      .withCommand(["pnpm", "deploy:workspace:bootstrap"])
      .withWaitStrategy(Wait.forOneShotStartup())
      .start();
    expect((await fetch(`${origin}/health/ready`)).status).toBe(200);
  },
  120000,
);
