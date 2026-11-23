import { describe, expect, it } from "vitest";

import { JiraController } from "../../../apps/mock-hub/src/jira/jira.controller.ts";
import {
  InMemoryJiraRepository,
  JiraMockService,
} from "../../../apps/mock-hub/src/jira/jira.repository.ts";
import { JiraScenarioController } from "../../../apps/mock-hub/src/jira/jira-scenarios.ts";

describe("Mock Hub Jira wire surface", () => {
  it("supplies the initial workflow status for new and legacy issues without overriding transitions", async () => {
    const repository = new InMemoryJiraRepository();
    const service = new JiraMockService(repository);
    const controller = new JiraController(service, new JiraScenarioController());
    const input = { projectId: "100", issueTypeId: "10001", fields: { summary: "QA" } };
    const created = await service.createIssue(input);
    expect((await repository.issue(created.id))?.fields.status).toEqual({ id: "1", name: "Open" });
    const legacy = await repository.createIssue(input);
    expect(await controller.issue(legacy.id)).toMatchObject({
      fields: { status: { id: "1", name: "Open" } },
    });
    await service.updateIssueFields(legacy.id, { status: { id: "2", name: "Done" } });
    expect(await controller.issue(legacy.id)).toMatchObject({
      fields: { status: { id: "2", name: "Done" } },
    });
  });

  it("supports metadata, issues, search, properties, links, comments and webhooks", async () => {
    const repository = new InMemoryJiraRepository();
    const service = new JiraMockService(repository);
    const created = await service.createIssue({
      projectId: "100",
      issueTypeId: "200",
      fields: { summary: "QA" },
      marker: "effect-1",
    });
    expect(await service.issue(created.id)).toMatchObject({ id: created.id });
    expect(await service.searchByMarker("effect-1")).toHaveLength(1);
    await service.putProperty(created.id, "awp.effect", "effect-1");
    await service.addLink(created.id, "900", "10002", "OUTWARD");
    await service.addComment(created.id, "marker:comment", "done");
    expect((await service.issue(created.id)).links).toHaveLength(1);
    expect((await service.issue(created.id)).comments).toHaveLength(1);
    expect(service.metadata()).toHaveProperty("rateHeaders");
  });

  it("accepts and exposes the official Jira Cloud/DC issue-link document", async () => {
    const repository = new InMemoryJiraRepository();
    const controller = new JiraController(
      new JiraMockService(repository),
      new JiraScenarioController(),
    );
    const outward = await controller.create({
      fields: { project: { id: "100" }, issuetype: { id: "10001" }, summary: "Central" },
    });
    const inward = await controller.create({
      fields: { project: { id: "200" }, issuetype: { id: "10002" }, summary: "Source" },
    });

    await controller.link({
      type: { id: "10000" },
      outwardIssue: { id: outward.id },
      inwardIssue: { id: inward.id },
    });

    expect(await controller.issue(outward.id)).toMatchObject({
      id: outward.id,
      fields: {
        issuelinks: [
          {
            type: { id: "10000", name: "Relates", outward: "relates to", inward: "relates to" },
            outwardIssue: { id: inward.id },
          },
        ],
      },
    });
    expect(await controller.issue(inward.id)).toMatchObject({
      id: inward.id,
      fields: {
        issuelinks: [
          {
            type: { id: "10000" },
            inwardIssue: { id: outward.id },
          },
        ],
      },
    });
    expect(repository.effectCalls.filter(({ operation }) => operation === "LINK")).toEqual([
      expect.objectContaining({
        requestBody: {
          type: { id: "10000" },
          outwardIssue: { id: outward.id },
          inwardIssue: { id: inward.id },
        },
      }),
    ]);
  });
});
