import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parse, stringify } from "../../node_modules/yaml/dist/index.js";
import {
  GenericContainer,
  Wait,
} from "../../packages/platform-testkit/node_modules/testcontainers/build/index.js";

/** Independent real Collector with an ephemeral test CA; never a corporate input. */
export async function startCollectorFixture() {
  const directory = mkdtempSync(join(tmpdir(), "awp-008-collector-"));
  const openssl = (...args: string[]) =>
    execFileSync("openssl", args, { cwd: directory, stdio: "ignore" });
  try {
    openssl(
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      "ca.key",
      "-out",
      "ca.crt",
      "-subj",
      "/CN=AWP-008-TEST-CA",
      "-days",
      "1",
    );
    for (const kind of ["server", "client"] as const) {
      openssl(
        "req",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        `${kind}.key`,
        "-out",
        `${kind}.csr`,
        "-subj",
        `/CN=AWP-008-TEST-${kind}`,
      );
      writeFileSync(
        join(directory, `${kind}.ext`),
        `basicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=${kind === "server" ? "serverAuth" : "clientAuth"}\nsubjectAltName=IP:127.0.0.1,DNS:localhost\n`,
      );
      openssl(
        "x509",
        "-req",
        "-in",
        `${kind}.csr`,
        "-CA",
        "ca.crt",
        "-CAkey",
        "ca.key",
        "-CAcreateserial",
        "-out",
        `${kind}.crt`,
        "-days",
        "1",
        "-extfile",
        `${kind}.ext`,
      );
    }
    const configuration = parse(
      readFileSync(
        new URL("../../infra/observability/otel-collector.yaml", import.meta.url),
        "utf8",
      ),
    ) as { receivers: Record<string, unknown>; exporters: Record<string, unknown> };
    configuration.receivers = {
      otlp: {
        protocols: {
          http: {
            endpoint: "0.0.0.0:4318",
            tls: {
              cert_file: "/fixture/server.crt",
              key_file: "/fixture/server.key",
              client_ca_file: "/fixture/ca.crt",
            },
          },
        },
      },
    };
    configuration.exporters = { debug: { verbosity: "detailed" } };
    const copies = ["server.crt", "server.key", "ca.crt"].map((name) => ({
      content: readFileSync(join(directory, name)),
      target: `/fixture/${name}`,
    }));
    const container = await new GenericContainer(
      "otel/opentelemetry-collector-contrib:0.135.0@sha256:89107a3a8f4636a396927edf7025bb9614b8da2d92f4cc3f43109e8d115736e2",
    )
      .withCopyContentToContainer([
        ...copies,
        { content: stringify(configuration), target: "/fixture/collector.yaml" },
      ])
      .withCommand(["--config=/fixture/collector.yaml"])
      .withExposedPorts(4318)
      .withWaitStrategy(Wait.forLogMessage(/Everything is ready/u))
      .start();
    const chunks: string[] = [];
    const stream = await container.logs();
    stream.on("data", (chunk: Buffer) => chunks.push(chunk.toString()));
    const host = container.getHost() === "localhost" ? "127.0.0.1" : container.getHost();
    return {
      origin: `https://${host}:${container.getMappedPort(4318)}`,
      agentOptions: {
        ca: readFileSync(join(directory, "ca.crt")),
        cert: readFileSync(join(directory, "client.crt")),
        key: readFileSync(join(directory, "client.key")),
      },
      output: () => chunks.join(""),
      stop: async () => {
        stream.destroy();
        await container.stop();
        rmSync(directory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}
