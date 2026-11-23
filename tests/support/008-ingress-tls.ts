import { execFileSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ingressRawHash,
  type ProviderIngressRequest,
} from "../../packages/runtime-composition/src/pilot/trusted-ingress.ts";

export function ingressTlsFixture() {
  const directory = mkdtempSync(join(tmpdir(), "awp-008-ingress-tls-"));
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
      "/CN=AWP-INGRESS-TEST-CA",
      "-days",
      "1",
    );
    for (const kind of ["server", "client", "other"] as const) {
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
        `/CN=AWP-INGRESS-TEST-${kind}`,
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
    const read = (file: string) => readFileSync(join(directory, file));
    return {
      fingerprint: ingressRawHash(
        new X509Certificate(read("client.crt")).raw,
      ) as `sha256:${string}`,
      server: {
        key: read("server.key"),
        cert: read("server.crt"),
        ca: read("ca.crt"),
        requestCert: true,
        rejectUnauthorized: true,
      },
      async post(
        origin: string,
        input: ProviderIngressRequest,
        certificate: "client" | "other" | "none" = "client",
      ) {
        return await new Promise<{ status: number; body: unknown }>((resolve, reject) => {
          const call = request(
            `${origin}${input.route}`,
            {
              method: input.method,
              ca: read("ca.crt"),
              ...(certificate === "none"
                ? {}
                : { key: read(`${certificate}.key`), cert: read(`${certificate}.crt`) }),
              headers: { ...input.headers, "content-type": input.contentType },
            },
            (response) => {
              let body = "";
              response.setEncoding("utf8");
              response.on("data", (chunk: string) => {
                body += chunk;
              });
              response.on("end", () =>
                resolve({ status: response.statusCode!, body: JSON.parse(body) as unknown }),
              );
            },
          );
          call.on("error", reject);
          call.end(input.rawBody);
        });
      },
      stop: () => rmSync(directory, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}
