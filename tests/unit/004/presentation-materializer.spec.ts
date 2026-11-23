import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  InMemoryPresentationKeyResolver,
  InteractionPresentationMaterializer,
} from "../../../packages/platform-core/src/interactions/presentation-materializer.ts";
import { verify004Contracts } from "../../../tools/contracts/verify-004-contracts.mts";

const root = resolve(import.meta.dirname, "../../..");
const vector = JSON.parse(
  readFileSync(
    resolve(
      root,
      "specs/004-mattermost-hermes-intake/contracts/examples/interaction-presentation-aead.vector.v1.json",
    ),
    "utf8",
  ),
) as Record<string, unknown>;

describe("presentation materialization", () => {
  it("recomputes the RFC 8785/AES-256-GCM golden vector", () =>
    expect(verify004Contracts(root).aeadVectors).toBe(1));
  it("lends plaintext only once behind the exact fence", () => {
    const resolver = new InMemoryPresentationKeyResolver([
      ["key-vector-1@1", Buffer.from(String(vector.keyHex), "hex")],
    ]);
    const materializer = new InteractionPresentationMaterializer(resolver);
    const lease = materializer.openVector(vector, {
      commandId: "command-vector-1",
      attemptCount: 1,
    });
    expect(lease.use((sensitive) => sensitive.utf8())).toBe(vector.plaintextUtf8);
    expect(() => lease.use(() => "again")).toThrow(/CONSUMED/u);
  });
});
