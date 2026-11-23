import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { expect, it } from "vitest";

import {
  designContractRegistry,
  pilotSchemaIds,
  schemaDocuments,
} from "../../../packages/platform-contracts/src/index.ts";

it("preserves every historical schema and adds offline pilot contracts", () => {
  const baseline = JSON.parse(readFileSync("config/pilot/feature-007-baseline.json", "utf8")) as {
    commit: string;
  };
  const previous = execFileSync(
    "git",
    ["show", `${baseline.commit}:packages/platform-contracts/src/generated/schema-documents.ts`],
    { encoding: "utf8", maxBuffer: 5_000_000 },
  );
  const serialized = previous.match(
    /export const schemaDocuments = ([\s\S]*?) as const satisfies/u,
  )?.[1];
  expect(serialized).toBeDefined();
  const entries = JSON.parse(serialized!) as Array<{ id: string }>;
  const historicalIds = new Set(entries.map(({ id }) => id));
  expect(schemaDocuments.filter(({ id }) => historicalIds.has(id))).toEqual(entries);
  expect(
    schemaDocuments
      .filter(({ id, contributionOrder }) => contributionOrder < 800 && !historicalIds.has(id))
      .map(({ id }) => id),
  ).toEqual(["urn:awp:schemas:007:binding-functional-acceptance:v2"]);
  expect(designContractRegistry.ids()).toContain(pilotSchemaIds.gateReport);
  expect(designContractRegistry.ids()).toContain(pilotSchemaIds.event);
});

it("rejects private payload fields and missing scope in pilot events", () => {
  const event = {
    schemaVersion: 1,
    eventId: "e1",
    eventType: "PILOT_FENCE_CHANGED",
    workspaceId: "w1",
    projectId: "p1",
    subjectRef: { id: "f1", version: 1, contentHash: `sha256:${"a".repeat(64)}` },
    actorRef: "owner",
    correlationId: "c1",
    occurredAt: "2026-09-03T00:00:00Z",
    reasonCode: "WINDOW_EXPIRED",
  };
  expect(designContractRegistry.validateById(pilotSchemaIds.event, event)).toEqual(event);
  expect(() =>
    designContractRegistry.validateById(pilotSchemaIds.event, { ...event, accessToken: "private" }),
  ).toThrow();
  expect(() =>
    designContractRegistry.validateById(pilotSchemaIds.event, { ...event, workspaceId: undefined }),
  ).toThrow();
});
