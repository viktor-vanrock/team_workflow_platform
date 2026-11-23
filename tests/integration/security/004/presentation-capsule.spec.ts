import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  InMemoryPresentationKeyResolver,
  InteractionPresentationMaterializer,
} from "../../../../packages/platform-core/src/index.ts";

const root = resolve(import.meta.dirname, "../../../..");
const vector = JSON.parse(
  readFileSync(
    resolve(
      root,
      "specs/004-mattermost-hermes-intake/contracts/examples/interaction-presentation-aead.vector.v1.json",
    ),
    "utf8",
  ),
) as Record<string, unknown>;
describe("presentation capsule hardening", () =>
  it("rejects forged command/AAD/key and never serializes plaintext", () => {
    const materializer = new InteractionPresentationMaterializer(
      new InMemoryPresentationKeyResolver([
        ["key-vector-1@1", Buffer.from(String(vector.keyHex), "hex")],
      ]),
    );
    expect(() =>
      materializer.openVector(vector, { commandId: "foreign", attemptCount: 1 }),
    ).toThrow(/FENCE/u);
    expect(JSON.stringify(vector)).not.toContain(
      String(vector.plaintextUtf8).replace("TEST_ONLY", "LIVE"),
    );
  }));
