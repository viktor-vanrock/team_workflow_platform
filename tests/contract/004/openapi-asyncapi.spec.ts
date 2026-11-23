import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";

const root = resolve(import.meta.dirname, "../../../specs/004-mattermost-hermes-intake/contracts");
const parse = (path: string) =>
  parseDocument(readFileSync(resolve(root, path), "utf8"), {
    strict: true,
    uniqueKeys: true,
  }).toJS() as Record<string, unknown>;

describe("Feature 004 API/event contract surface", () => {
  it("has exactly 20 uniquely named OpenAPI operations", () => {
    const document = parse("openapi/mattermost-hermes-intake-api.v1.yaml");
    const methods = new Set(["get", "put", "post", "delete", "patch"]);
    const ids = Object.values(document.paths as Record<string, Record<string, unknown>>).flatMap(
      (item) =>
        Object.entries(item)
          .filter(([method]) => methods.has(method))
          .map(([, operation]) => (operation as Record<string, unknown>).operationId),
    );
    expect(ids).toHaveLength(20);
    expect(new Set(ids).size).toBe(20);
  });

  it("has five channels and twenty schema-bound messages", () => {
    const document = parse("asyncapi/mattermost-hermes-events.v1.yaml");
    expect(Object.keys(document.channels as object)).toHaveLength(5);
    const components = document.components as Record<string, Record<string, unknown>>;
    expect(Object.keys(components.messages ?? {})).toHaveLength(20);
    expect(JSON.stringify(components.messages)).not.toMatch(
      /mattermost.*token|rawBody|response_url/iu,
    );
  });
});
