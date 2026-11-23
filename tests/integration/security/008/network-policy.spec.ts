import { createServer } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import { JiraRestClient } from "../../../../packages/connector-jira/src/http/jira-rest-client.ts";
import {
  type OutboundNetworkPolicy,
  PinnedNetworkTransport,
} from "../../../../packages/runtime-composition/src/pilot/network-policy.ts";

const ref = { id: "network-policy", version: 1, contentHash: `sha256:${"a".repeat(64)}` as const };
const corporate = (cidrs = ["10.20.0.0/16"]): OutboundNetworkPolicy => ({
  ref,
  mode: "CORPORATE",
  validUntil: new Date(Date.now() + 60_000).toISOString(),
  deadlineMs: 200,
  maximumRequestBytes: 1024,
  maximumResponseBytes: 4096,
  endpoints: [
    {
      origin: "https://provider.example",
      addressRanges: cidrs,
      routes: [{ path: "/api/", match: "PREFIX", methods: ["GET", "POST"], queryKeys: ["page"] }],
    },
  ],
});
describe("008 pinned network boundaries", () => {
  let server: ReturnType<typeof createServer> | undefined;
  afterEach(async () => {
    server?.closeAllConnections();
    await new Promise<void>((resolve) => {
      if (server) {
        server.close(() => resolve());
      } else {
        resolve();
      }
    });
    server = undefined;
  });
  it("retains explicitly approved private networks and denies every mixed DNS answer set", async () => {
    const transport = new PinnedNetworkTransport(corporate(), {
      resolve: async () => ["10.20.1.2"],
    });
    expect(await transport.authorizeEndpoint("https://provider.example/api/status", "GET")).toBe(
      true,
    );
    for (const addresses of [["10.21.1.2"], ["10.20.1.2", "169.254.169.254"], [], ["garbage"]])
      expect(
        await new PinnedNetworkTransport(corporate(), {
          resolve: async () => addresses,
        }).authorizeEndpoint("https://provider.example/api/status", "GET"),
      ).toBe(false);
  });
  it.each([
    "127.0.0.1",
    "::1",
    "0.0.0.0",
    "169.254.169.254",
    "168.63.129.16",
    "100.100.100.200",
    "fd00:ec2::254",
    "::ffff:127.0.0.1",
    "::ffff:a9fe:a9fe",
    "fe80::1",
    "224.0.0.1",
    "ff02::1",
    "64:ff9b::a9fe:a9fe",
  ])("denies protected destination %s even inside a broad allowlist", async (address) => {
    const transport = new PinnedNetworkTransport(corporate(["0.0.0.0/0", "::/0"]), {
      resolve: async () => [address],
    });
    expect(await transport.authorizeEndpoint("https://provider.example/api/status", "GET")).toBe(
      false,
    );
  });
  it.each([
    ["https://other.example/api/status", "GET"],
    ["http://provider.example/api/status", "GET"],
    ["https://user:pass@provider.example/api/status", "GET"],
    ["https://provider.example/api/status#fragment", "GET"],
    ["https://provider.example/private", "GET"],
    ["https://provider.example/api/status", "DELETE"],
    ["https://provider.example/api/status?redirect=https://other.example", "GET"],
    ["https://provider.example/api/%252e%252e/private", "GET"],
    ["https://provider.example/api/a%2f..%2fprivate", "GET"],
  ])("denies URL/method policy mismatch %s", async (url, method) => {
    const transport = new PinnedNetworkTransport(corporate(), {
      resolve: async () => ["10.20.1.2"],
    });
    expect(await transport.authorizeEndpoint(url, method)).toBe(false);
  });
  it("bounds DNS, rechecks every operation, and rejects expired policy", async () => {
    let address = "10.20.1.2";
    const transport = new PinnedNetworkTransport(corporate(), { resolve: async () => [address] });
    expect(await transport.authorizeEndpoint("https://provider.example/api/status", "GET")).toBe(
      true,
    );
    address = "127.0.0.1";
    await expect(transport.fetch("https://provider.example/api/status")).rejects.toThrow(
      "NETWORK_REQUEST_DENIED",
    );
    const slow = new PinnedNetworkTransport(
      { ...corporate(), deadlineMs: 30 },
      { resolve: async () => new Promise(() => {}) },
    );
    const start = performance.now();
    expect(await slow.authorizeEndpoint("https://provider.example/api/status", "GET")).toBe(false);
    expect(performance.now() - start).toBeLessThan(500);
    expect(
      () => new PinnedNetworkTransport({ ...corporate(), validUntil: "2000-01-01T00:00:00Z" }),
    ).toThrow("NETWORK_POLICY_INVALID");
  });
  it("pins the actual HTTP connection, forbids redirects and bounds streamed responses and requests", async () => {
    const seen: { path: string; host: string }[] = [];
    let resolutions = 0;
    server = createServer((request, response) => {
      seen.push({ path: request.url!, host: request.headers.host! });
      if (request.url === "/api/redirect") {
        response.writeHead(302, { location: "http://169.254.169.254/" }).end();
        return;
      }
      if (request.url === "/api/large") {
        response.writeHead(200);
        response.write("x".repeat(3000));
        response.end("x".repeat(3000));
        return;
      }
      if (request.url === "/api/hang") return;
      response.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
    });
    await new Promise<void>((resolve) => {
      server!.listen(0, "127.0.0.1", resolve);
    });
    const port = (server.address() as { port: number }).port;
    const policy: OutboundNetworkPolicy = {
      ...corporate(),
      mode: "LOCAL_FIXTURE",
      endpoints: [
        {
          ...corporate().endpoints[0]!,
          origin: `http://fixture.example:${port}`,
          addressRanges: ["127.0.0.1/32"],
        },
      ],
    };
    const transport = new PinnedNetworkTransport(policy, {
      resolve: async () => {
        resolutions++;
        return resolutions === 1 ? ["127.0.0.1"] : ["169.254.169.254"];
      },
    });
    expect(
      await (await transport.fetch(`http://fixture.example:${port}/api/status`)).json(),
    ).toEqual({ ok: true });
    expect(resolutions).toBe(1);
    expect(seen[0]!.host).toBe(`fixture.example:${port}`);
    await expect(transport.fetch(`http://fixture.example:${port}/api/status`)).rejects.toThrow();
    expect(seen).toHaveLength(1);
    const local = new PinnedNetworkTransport(policy, { resolve: async () => ["127.0.0.1"] });
    for (const path of ["redirect", "large", "hang"])
      await expect(local.fetch(`http://fixture.example:${port}/api/${path}`)).rejects.toThrow(
        "NETWORK_REQUEST_DENIED",
      );
    const previous = seen.length;
    await expect(
      local.fetch(`http://fixture.example:${port}/api/status`, {
        method: "POST",
        body: "x".repeat(1025),
      }),
    ).rejects.toThrow();
    await expect(
      local.fetch(`http://fixture.example:${port}/api/status`, {
        headers: { host: "attacker.example" },
      }),
    ).rejects.toThrow();
    expect(seen).toHaveLength(previous);
    const jira = new JiraRestClient({
      baseUrl: `http://fixture.example:${port}`,
      environment: "LOCAL",
      allowedOrigins: [`http://fixture.example:${port}`],
      allowedLocalHostnames: ["fixture.example"],
      transport: local.fetch,
    });
    expect(await (await jira.request({ method: "GET", path: "/api/status" })).json()).toEqual({
      ok: true,
    });
  });
});
