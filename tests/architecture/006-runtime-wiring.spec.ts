import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const read = (path: string): string =>
  existsSync(resolve(root, path)) ? readFileSync(resolve(root, path), "utf8") : "";
const dynamicLoading =
  /\beval\s*\(|\bnew\s+Function\s*\(|\bcreateRequire\s*\(|\brequire\s*\(|import\s*\(\s*(?:`|[^"'])/u;

describe("Feature 006 static runtime wiring", () => {
  it("registers the queue composition, migrations and entities through named static exports", () => {
    const queue = read("packages/runtime-composition/src/queue/composition.ts");
    const runtime = read("packages/runtime-composition/src/index.ts");
    const migrations = read("packages/runtime-composition/src/migrations/composition.ts");
    const entities = read("packages/runtime-composition/src/persistence/entity-composition.ts");
    expect(queue).toMatch(/queue.*(?:provider|repository|composition)/iu);
    expect(runtime).toMatch(/queue\/composition/iu);
    expect(migrations).toMatch(/0130|0135|0140|2070/u);
    expect(entities).toMatch(/queueManagementEntities|qaQueue/iu);
    expect(`${queue}\n${runtime}\n${migrations}\n${entities}`).not.toMatch(dynamicLoading);
  });

  it("wires API and worker modules without creating a new service boundary", () => {
    const api = read("apps/api/src/app.module.ts");
    const worker = read("apps/worker/src/app.module.ts");
    const packages = read("pnpm-workspace.yaml");
    expect(api).toMatch(/queue/iu);
    expect(worker).toMatch(/queue/iu);
    expect(`${api}\n${worker}`).not.toMatch(dynamicLoading);
    expect(packages).not.toMatch(/queue-(?:service|microservice)/iu);
  });

  it("keeps PostgreSQL as the only delivery authority", () => {
    const runtime = [
      "packages/runtime-composition/src/queue/projection-worker.ts",
      "packages/runtime-composition/src/queue/temporal-transition-worker.ts",
      "packages/runtime-composition/src/queue/bootstrap.ts",
    ]
      .map(read)
      .join("\n");
    expect(runtime).toMatch(/PostgreSQL|repository|due|cursor/iu);
    expect(runtime).not.toMatch(/(?:broker|memory).*(?:authoritative|source.of.truth)/iu);
  });
});
