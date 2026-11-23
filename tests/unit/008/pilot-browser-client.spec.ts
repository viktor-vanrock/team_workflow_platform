import { describe, expect, it, vi } from "vitest";

import { PilotBrowserClient } from "../../../apps/web/src/routes/pilot/pilot-client.ts";

const scope = {
  workspaceId: "10000000-0000-4000-8000-000000000001",
  projectId: "10000000-0000-4000-8000-000000000002",
  deploymentId: "10000000-0000-4000-8000-000000000003",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
describe("pilot browser HTTP boundary", () => {
  it("uses same-origin cookies without browser-held provider tokens and clears unauthenticated sessions", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(reply({}, 401))
      .mockResolvedValueOnce(
        reply({
          principalId: "human",
          subject: "alice",
          csrfToken: "a".repeat(43),
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        }),
      );
    const client = new PilotBrowserClient(fetcher);
    expect(await client.session()).toBeUndefined();
    const session = await client.session();
    expect(session?.subject).toBe("alice");
    for (const [url, init] of fetcher.mock.calls) {
      expect(url).toBe("/api/v1/auth/session");
      expect(init).toMatchObject({ credentials: "same-origin", cache: "no-store" });
      expect(new Headers(init?.headers).has("authorization")).toBe(false);
    }
  });
  it("binds logout and step-up to the current CSRF value; denies unsafe login locations", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        reply({ authorizationUrl: "https://identity.example/authorize?state=opaque" }),
      );
    const client = new PilotBrowserClient(fetcher);
    expect(await client.beginLogin("/pilot/readiness", "b".repeat(43))).toBe(
      "https://identity.example/authorize?state=opaque",
    );
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]!.body))).toEqual({
      returnPath: "/pilot/readiness",
      stepUp: true,
    });
    expect(new Headers(fetcher.mock.calls[0]![1]!.headers).get("x-csrf-token")).toBe(
      "b".repeat(43),
    );
    fetcher.mockResolvedValue(new Response(null, { status: 204 }));
    await client.logout("b".repeat(43));
    expect(fetcher.mock.calls[1]![0]).toBe("/api/v1/auth/logout");
    for (const authorizationUrl of [
      "javascript:alert(1)",
      "https://user:secret@identity.example/authorize",
      "http://untrusted.example/authorize",
      "https://identity.example/#fragment",
    ]) {
      fetcher.mockResolvedValue(reply({ authorizationUrl }));
      await expect(client.beginLogin("/pilot/readiness")).rejects.toThrow("PILOT_RESPONSE_INVALID");
    }
    await expect(client.beginLogin("//untrusted.example")).rejects.toThrow("PILOT_SCOPE_INVALID");
  });
  it("rejects scope substitution and raw server errors without forwarding their bodies", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(reply({ ...scope, projectId: "foreign", capabilities: [] }));
    const client = new PilotBrowserClient(fetcher);
    await expect(client.health(scope)).rejects.toThrow("PILOT_RESPONSE_INVALID");
    for (const [status, code] of [
      [401, "PILOT_LOGIN_REQUIRED"],
      [403, "PILOT_ACCESS_DENIED"],
      [404, "PILOT_RESOURCE_MISSING"],
      [500, "PILOT_UNAVAILABLE"],
    ] as const) {
      fetcher.mockResolvedValue(reply({ detail: "PRIVATE_PROVIDER_CANARY" }, status));
      await expect(client.health(scope)).rejects.toThrow(new RegExp(`^${code}$`, "u"));
    }
    fetcher.mockClear();
    await expect(client.health({ ...scope, projectId: "../foreign" })).rejects.toThrow(
      "PILOT_SCOPE_INVALID",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
});
