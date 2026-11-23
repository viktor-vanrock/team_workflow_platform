import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");

async function files(directory: string): Promise<string[]> {
  if (!existsSync(directory)) return [];
  return (
    await Promise.all(
      (await readdir(directory, { withFileTypes: true })).map(async (entry) => {
        const path = resolve(directory, entry.name);
        return entry.isDirectory()
          ? files(path)
          : /\.(?:ts|tsx|mts)$/u.test(entry.name)
            ? [path]
            : [];
      }),
    )
  ).flat();
}

async function source(directory: string): Promise<string> {
  return (
    await Promise.all(
      (await files(resolve(root, directory))).map(async (file) => readFile(file, "utf8")),
    )
  ).join("\n");
}

const dynamicLoading =
  /\beval\s*\(|\bnew\s+Function\s*\(|\bcreateRequire\s*\(|\brequire\s*\(|import\s*\(\s*(?:`|[^"'])/u;

describe("Feature 006 queue ownership boundaries", () => {
  it("keeps pure Core queue reducers independent of QA, connectors, frameworks and models", async () => {
    const core = await source("packages/platform-core/src/work-management");
    expect(core).toMatch(/queue-stage|queue-order|queue-policy|capacity|sla/iu);
    expect(core).not.toMatch(
      /@awp\/competency-qa|@awp\/connector-|typeorm|@nestjs\/|react|bullmq|ModelProposal|Hermes/iu,
    );
    expect(core).not.toMatch(dynamicLoading);
  });

  it("keeps QA ownership limited to typed facts, manifests and UI without Core DDL", async () => {
    const qa = `${await source("packages/competency-qa/src/application")}\n${await source("packages/competency-qa/src/persistence")}\n${await source("packages/competency-qa/src/ui")}`;
    expect(qa).toMatch(/QaQueueFacts|qa_queue_fact/iu);
    expect(qa).not.toMatch(
      /CREATE\s+TABLE\s+(?:workspace_queue_|queue_entry_|sla_|capacity_|work_item_queue_control)/iu,
    );
    expect(qa).not.toMatch(/@awp\/connector-|bullmq/iu);
  });

  it("keeps cross-package UoWs and workers in runtime composition", async () => {
    const runtime = await source("packages/runtime-composition/src/queue");
    expect(runtime).toMatch(/projection|qa.fact|admission|rebuild/iu);
    expect(runtime).not.toMatch(/https?:\/\/|gitlab\.com|atlassian\.net|mattermost\.com/iu);
    expect(runtime).not.toMatch(dynamicLoading);
  });

  it("keeps deployable API/UI shells free of direct persistence and Connector authority", async () => {
    const api = await source("apps/api/src/extensions/queue");
    const web = await source("apps/web/src/routes/qa");
    expect(api).toMatch(/queue/iu);
    expect(web).toMatch(/queue/iu);
    expect(`${api}\n${web}`).not.toMatch(/typeorm|@awp\/connector-|SELECT\s|INSERT\s|UPDATE\s/iu);
  });
});
