import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  qaCompetencyManifestV12,
  qaCompetencyManifestV13,
  qaValidationWorkTypeDefinitionV12,
  qaValidationWorkTypeDefinitionV13,
} from "../../../packages/competency-qa/src/index.ts";
import { schemaDocuments } from "../../../packages/platform-contracts/src/index.ts";

const serializedDigest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const expectedEvents = Object.freeze({
  "qa.automation-attempt.created": "urn:awp:schemas:005:events:automation-attempt-created:v1",
  "qa.automation-attempt.status-observed":
    "urn:awp:schemas:005:events:automation-attempt-status-observed:v1",
  "qa.automation-attempt.completed": "urn:awp:schemas:005:events:automation-attempt-completed:v1",
  "qa.automation-artifact.registered":
    "urn:awp:schemas:005:events:automation-artifact-registered:v1",
  "qa.automation-retry.decided": "urn:awp:schemas:005:events:automation-retry-decided:v1",
  "qa.automation-quarantine.changed": "urn:awp:schemas:005:events:automation-quarantine-changed:v1",
  "qa.triage-assessment.created": "urn:awp:schemas:004:events:qa-triage-assessment-created:v1",
  "qa.triage-assessment.stale": "urn:awp:schemas:004:events:qa-triage-assessment-stale:v1",
  "qa.automated-session.ready": "urn:awp:schemas:qa:event-payload:automated-session-ready:v1",
  "qa.queue-facts.changed": "urn:awp:schemas:006:qa-queue-facts-changed:v1",
});

describe("Feature 006 QA manifest v1.3 compatibility", () => {
  it("keeps the published V12 objects byte-identical", () => {
    expect(serializedDigest(qaCompetencyManifestV12)).toBe(
      "c087b061bcd5b636398dce6fabcf937a4f236c0bb9a28c328b4dc22e1bd4a2b8",
    );
    expect(serializedDigest(qaValidationWorkTypeDefinitionV12)).toBe(
      "4e6865397d0ae2d8b492e96a0d4b9892afd107e32f29d8ff98fe8a74dd8871b2",
    );
  });

  it("publishes distinct frozen competency-qa and qa.validation V13 identities", () => {
    expect(qaCompetencyManifestV13.metadata).toMatchObject({
      key: "competency-qa",
      version: "1.3.0",
    });
    expect(qaValidationWorkTypeDefinitionV13).toMatchObject({
      key: "qa.validation",
      definitionVersion: "1.3.0",
    });
    expect(qaCompetencyManifestV13.workTypes).toEqual([qaValidationWorkTypeDefinitionV13]);
    expect(Object.isFrozen(qaCompetencyManifestV13)).toBe(true);
    expect(Object.isFrozen(qaValidationWorkTypeDefinitionV13)).toBe(true);
  });

  it("corrects six inherited automation refs and appends four exact events with registry JCS digests", () => {
    const events = new Map(
      qaCompetencyManifestV13.events.map((event) => [event.eventType as string, event]),
    );
    expect(new Set(qaCompetencyManifestV13.events.map(({ eventType }) => eventType)).size).toBe(
      qaCompetencyManifestV13.events.length,
    );
    for (const [eventType, id] of Object.entries(expectedEvents)) {
      const document = schemaDocuments.find((schema) => schema.id === id);
      expect(events.get(eventType)?.payloadSchemaRef).toEqual({
        id,
        version: 1,
        digest: document?.digest,
      });
      expect(events.get(eventType)?.payloadSchemaRef.id).not.toBe("urn:awp:schemas:qa:events:v1");
    }
  });

  it("adds only the queue Work Item UI action and preserves connector requirements", () => {
    expect(qaValidationWorkTypeDefinitionV13.capabilityRequirements).toEqual(
      qaValidationWorkTypeDefinitionV12.capabilityRequirements,
    );
    expect(qaValidationWorkTypeDefinitionV13.uiContributions).toEqual([
      ...qaValidationWorkTypeDefinitionV12.uiContributions,
      {
        slot: "WORK_ITEM_ACTION",
        routeSegment: "queue",
        componentRef: "qa.ui.queue-work-item-action",
      },
    ]);
  });
});
