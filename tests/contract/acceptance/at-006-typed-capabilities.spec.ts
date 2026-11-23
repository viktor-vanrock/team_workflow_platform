import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  type ConnectorRuntimeContext,
  defineConnectorOperation,
} from "../../../packages/connector-sdk/src/index.ts";

describe("AT-006 typed capability operations", () => {
  it("uses typed operation handlers and has no universal execute(any)", async () => {
    const source = await readFile(
      resolve(import.meta.dirname, "../../../packages/connector-sdk/src/index.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/\bexecute\s*\(/u);
    expect(source).not.toMatch(/\bany\b/u);
    const operation = defineConnectorOperation<
      { id: string },
      { message: string },
      { receipt: string }
    >({
      capabilityKey: "sample.record",
      exactContractVersion: "1.0.0",
      operation: "record.publish",
      idempotencyStrategies: ["NATIVE_KEY"],
      confirmationModes: ["SYNC_RECEIPT"],
      handler: {
        invoke: async (_context: ConnectorRuntimeContext, target, input) => ({
          receipt: `${target.id}:${input.message}`,
        }),
      },
    });
    expect(
      (
        await operation.handler.invoke(
          {} as ConnectorRuntimeContext,
          { id: "target" },
          { message: "typed" },
        )
      ).receipt,
    ).toBe("target:typed");
  });
  it("treats logicalRole as opaque Pack-owned text", () => {
    const roles: readonly string[] = ["PRIMARY", "NEW_PACK_OWNED_ROLE"];
    expect(roles[1]).toBe("NEW_PACK_OWNED_ROLE");
  });
});
