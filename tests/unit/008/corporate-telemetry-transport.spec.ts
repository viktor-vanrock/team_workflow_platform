import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createCorporateTelemetryTransport } from "../../../apps/api/src/extensions/corporate-telemetry-transport.ts";
import type { PinnedNetworkTransport } from "../../../packages/runtime-composition/src/index.ts";

describe("corporate telemetry transport", () => {
  it("loads mTLS files and delegates export authorization to the pinned network", async () => {
    const directory = mkdtempSync(join(tmpdir(), "awp-telemetry-"));
    try {
      const cert = join(directory, "cert");
      const key = join(directory, "key");
      writeFileSync(cert, "test certificate");
      writeFileSync(key, "test key");
      const authorizeEndpoint = vi.fn(async () => false);
      const network = {
        policy: { mode: "CORPORATE" },
        authorizeEndpoint,
      } as unknown as PinnedNetworkTransport;
      const transport = createCorporateTelemetryTransport(network, {
        AWP_TELEMETRY_CLIENT_CERT_PATH: cert,
        AWP_TELEMETRY_CLIENT_KEY_PATH: key,
      });
      const signal = new AbortController().signal;
      expect(await transport.authorizeExport("https://collector.example/v1/traces", signal)).toBe(
        false,
      );
      expect(authorizeEndpoint).toHaveBeenCalledWith(
        "https://collector.example/v1/traces",
        "POST",
        signal,
      );
      expect(await transport.headers(signal)).toEqual({});
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("fails closed when credentials or corporate network policy are missing", () => {
    const network = { policy: { mode: "CORPORATE" } } as unknown as PinnedNetworkTransport;
    expect(() => createCorporateTelemetryTransport(network, {})).toThrow(
      "CORPORATE_TELEMETRY_CREDENTIAL_REQUIRED",
    );
    expect(() =>
      createCorporateTelemetryTransport(network, {
        AWP_TELEMETRY_CLIENT_CERT_PATH: "/missing/cert",
        AWP_TELEMETRY_CLIENT_KEY_PATH: "/missing/key",
      }),
    ).toThrow("CORPORATE_TELEMETRY_CREDENTIAL_INVALID");
  });
});
