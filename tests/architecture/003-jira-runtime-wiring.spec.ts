import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const source = async (path: string): Promise<string> => await readFile(resolve(root, path), "utf8");

describe("qa-jira-local runtime wiring", () => {
  it("keeps Jira effects out of the API request and routes them through durable delivery", async () => {
    const apiModule = await source("apps/api/src/app.module.ts");
    const controller = await source("apps/api/src/extensions/qa-pack.controller.ts");

    expect(apiModule).toContain("QA_API_OPERATIONAL_DELIVERY_MODE");
    expect(apiModule).toContain('useValue: "DURABLE_WORKER"');
    expect(apiModule).not.toContain(
      'createQaLocalOperationalBrokerMap({ ...loadEnvironment(), composition: "qa-local" })',
    );
    expect(controller).toContain("new CommandGateway(");
    expect(controller).toContain('deliveryMode === "DURABLE_WORKER"');
  });

  it("uses real worker steps and persistent Jira state", async () => {
    const worker = await source("apps/worker/src/app.module.ts");
    const mockHub = await source("apps/mock-hub/src/jira/jira.module.ts");

    expect(worker).toContain("createQaJiraLocalWorkerSteps");
    const classAt = worker.indexOf("export class QaJiraLocalWorkerAppModule");
    const moduleAt = worker.lastIndexOf("@Module({", classAt);
    expect(worker.slice(moduleAt, classAt)).not.toContain("...loopProviders");
    expect(mockHub).toContain("TypeOrmJiraRepository");
    expect(mockHub).not.toContain("new InMemoryJiraRepository()");
  });
});
