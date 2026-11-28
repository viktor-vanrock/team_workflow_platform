import { readFileSync } from "node:fs";

import { Ajv } from "ajv/dist/ajv.js";
import { describe, expect, it } from "vitest";

import { publishDevRuntimeBundle } from "../../../tools/deploy/dev-runtime-bootstrap.mts";

describe("dev runtime bootstrap template", () => {
  it("rejects execution outside dev and non-production before accessing the database", async () => {
    await expect(
      publishDevRuntimeBundle({} as never, {}, { AWP_ENVIRONMENT: "NON_PROD" }),
    ).rejects.toThrow("DEV_RUNTIME_BOOTSTRAP_ENVIRONMENT_DENIED");
    await expect(
      publishDevRuntimeBundle(
        {} as never,
        {},
        { AWP_ENVIRONMENT: "PLATFORM_PROD", AWP_SUPERADMIN_ENVIRONMENT: "dev" },
      ),
    ).rejects.toThrow("DEV_RUNTIME_BOOTSTRAP_ENVIRONMENT_DENIED");
  });
  it("conforms to the versioned envelope schema while leaving deployment values as placeholders", () => {
    const schema = JSON.parse(
      readFileSync(
        new URL("../../../tools/deploy/dev-runtime-bootstrap.schema.json", import.meta.url),
        "utf8",
      ),
    ) as object;
    const template: unknown = JSON.parse(
      readFileSync(
        new URL(
          "../../../docs/deployment/worker-vault-values/runtime-bootstrap.example.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    expect(new Ajv().validate(schema, template)).toBe(true);
    expect(JSON.stringify(template)).toContain("<DEPLOYMENT_POLICY>");
  });
});
