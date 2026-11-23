import { createPublicKey, verify } from "node:crypto";

import { expect, it } from "vitest";

import { startPilotFixture } from "../../support/008-pilot-fixture.ts";

it("independently observes lost-response effects, delayed lookup, identity rotation and telemetry", async () => {
  const fixture = await startPilotFixture();
  try {
    fixture.fail("jira", "lost-response");
    await expect(
      fetch(`${fixture.origin}/jira/effects`, {
        method: "POST",
        body: JSON.stringify({ marker: "one" }),
      }),
    ).rejects.toThrow();
    expect(fixture.effects()).toHaveLength(1);
    fixture.visible(0);
    expect(await (await fetch(`${fixture.origin}/jira/effects`)).json()).toEqual([]);
    fixture.visible(1);
    expect(await (await fetch(`${fixture.origin}/jira/effects`)).json()).toHaveLength(1);
    const token = fixture.token();
    fixture.rotate();
    const jwks = (await (await fetch(`${fixture.origin}/identity/jwks`)).json()) as {
      keys: JsonWebKey[];
    };
    const [header, payload, signature] = token.split(".");
    expect(jwks.keys).toHaveLength(2);
    expect(
      verify(
        null,
        Buffer.from(`${header}.${payload}`),
        createPublicKey({ key: jwks.keys[0]!, format: "jwk" }),
        Buffer.from(signature!, "base64url"),
      ),
    ).toBe(true);
    fixture.fail("secrets", "unavailable");
    expect(
      (await fetch(`${fixture.origin}/secrets/resolve`, { method: "POST", body: "{}" })).status,
    ).toBe(503);
    await fetch(`${fixture.origin}/telemetry/v1/traces`, {
      method: "POST",
      body: Buffer.from([1, 2, 3]),
    });
    expect(fixture.telemetryReceipts()).toBe(1);
  } finally {
    await fixture.stop();
  }
});
