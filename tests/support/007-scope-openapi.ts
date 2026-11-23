import { readFileSync } from "node:fs";

import { Ajv2020 } from "ajv/dist/2020.js";
import { expect } from "vitest";
import { parse } from "yaml";

type Document = Record<string, unknown>;
const spec = parse(
  readFileSync(
    new URL(
      "../../specs/007-project-onboarding-evidence-security/contracts/openapi/project-reads-api.v1.yaml",
      import.meta.url,
    ),
    "utf8",
  ),
) as { paths: Record<string, { get: Document }>; components: { schemas: Document } };
const id = "urn:awp:tests:project-reads:1",
  ajv = new Ajv2020({ strict: false, allErrors: true });
ajv.addFormat("uuid", /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/iu);
ajv.addFormat("date-time", (v) => Number.isFinite(Date.parse(v)) && /^\d{4}-\d\d-\d\dT/u.test(v));
const rewrite = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(rewrite)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.entries(v).map(([k, c]) => [
            k,
            k === "$ref" && typeof c === "string"
              ? c.replace("#/components/schemas/", `${id}#/$defs/`)
              : rewrite(c),
          ]),
        )
      : v;
ajv.addSchema({ $id: id, $defs: rewrite(spec.components.schemas) });
export function assertScopedReadResponse(
  path: string,
  response: { status: number; body: Document; headers: Record<string, string> },
) {
  const route = Object.entries(spec.paths).find(([pattern]) =>
    new RegExp(`^/api${pattern.replace(/\{[^}]+\}/gu, "[^/]+")}$`).test(path.split("?")[0]!),
  );
  if (!route) return;
  const responses = route[1].get.responses as Record<
      string,
      { content: Record<string, { schema: Document }> }
    >,
    definition = responses[String(response.status)] ?? responses.default!;
  const [media, content] = Object.entries(definition.content)[0]!,
    validate = ajv.compile(rewrite(content.schema) as Document);
  expect(validate(response.body), JSON.stringify(validate.errors)).toBe(true);
  expect(response.headers["content-type"]).toContain(media);
  expect(response.headers["cache-control"]).toBe("private, no-store");
}
