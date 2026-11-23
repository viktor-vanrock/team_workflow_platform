import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { verify004Contracts } from "../../../tools/contracts/verify-004-contracts.mts";

describe("interaction presentation AEAD contract", () => {
  it("binds every plaintext/AAD/ciphertext byte and hash", () =>
    expect(verify004Contracts(resolve(import.meta.dirname, "../../..")).status).toBe("PASS"));
});
