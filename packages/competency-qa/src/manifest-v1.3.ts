import type { CompetencyPackManifest, WorkTypeDefinition } from "@awp/competency-sdk";
import type { SchemaReference } from "@awp/platform-contracts";

import { qaCompetencyManifestV12, qaValidationWorkTypeDefinitionV12 } from "./manifest-v1.2.ts";

const exactEventSchemas = Object.freeze({
  "qa.automation-attempt.created": Object.freeze({
    id: "urn:awp:schemas:005:events:automation-attempt-created:v1",
    version: 1,
    digest: "sha256:07101908cc07a63d2194ea3f3df52cccb4738835ea0b4fd2ad41b7a8dafb1faa",
  }),
  "qa.automation-attempt.status-observed": Object.freeze({
    id: "urn:awp:schemas:005:events:automation-attempt-status-observed:v1",
    version: 1,
    digest: "sha256:f239157329bf9ec812c482866c1e0276c3bbab58826b58a78cacc829a304ba82",
  }),
  "qa.automation-attempt.completed": Object.freeze({
    id: "urn:awp:schemas:005:events:automation-attempt-completed:v1",
    version: 1,
    digest: "sha256:2a451d898d26a0c07e7de186531cd76623e2727591977d9ce81ab60c873d6d5c",
  }),
  "qa.automation-artifact.registered": Object.freeze({
    id: "urn:awp:schemas:005:events:automation-artifact-registered:v1",
    version: 1,
    digest: "sha256:94f6ac23995addb0d3fa5dd669382e1ae0dc9507c62580d04f6d86905d9f8dc6",
  }),
  "qa.automation-retry.decided": Object.freeze({
    id: "urn:awp:schemas:005:events:automation-retry-decided:v1",
    version: 1,
    digest: "sha256:8873dbc4628de33dd5c5e4a6dff3a8fdeb87a3cde27d0623cb8981c41aea2f0b",
  }),
  "qa.automation-quarantine.changed": Object.freeze({
    id: "urn:awp:schemas:005:events:automation-quarantine-changed:v1",
    version: 1,
    digest: "sha256:cac8ae1b67aac952be1123b4cf1c331ab469c2e9aa0099742ecfaaffa09717b4",
  }),
  "qa.triage-assessment.created": Object.freeze({
    id: "urn:awp:schemas:004:events:qa-triage-assessment-created:v1",
    version: 1,
    digest: "sha256:9f6611fa9da4b54f6291619366e40a77f6e0a955bdf6b7614374cf7c677033b2",
  }),
  "qa.triage-assessment.stale": Object.freeze({
    id: "urn:awp:schemas:004:events:qa-triage-assessment-stale:v1",
    version: 1,
    digest: "sha256:d8410b634c06addac3a4a69371440acb4357f2906a8b4bc0590694715d4657bf",
  }),
  "qa.automated-session.ready": Object.freeze({
    id: "urn:awp:schemas:qa:event-payload:automated-session-ready:v1",
    version: 1,
    digest: "sha256:bae78a03a4505087921f17fc06ac6533b46c2a78597b6e24e02be1ec2a2d628e",
  }),
  "qa.queue-facts.changed": Object.freeze({
    id: "urn:awp:schemas:006:qa-queue-facts-changed:v1",
    version: 1,
    digest: "sha256:73db51fe616e5c5e332dfd50dafa1442823ff3c5f7638991e68994c51cdfb0ca",
  }),
} as const satisfies Readonly<Record<string, SchemaReference>>);

export const qaValidationWorkTypeDefinitionV13 = Object.freeze({
  ...qaValidationWorkTypeDefinitionV12,
  definitionVersion: "1.3.0",
  uiContributions: Object.freeze([
    ...qaValidationWorkTypeDefinitionV12.uiContributions,
    Object.freeze({
      slot: "WORK_ITEM_ACTION",
      routeSegment: "queue",
      componentRef: "qa.ui.queue-work-item-action",
    }),
  ]),
} as const satisfies WorkTypeDefinition);

const correctedEvents = qaCompetencyManifestV12.events.map((event) => {
  const exact = exactEventSchemas[event.eventType as keyof typeof exactEventSchemas];
  return exact === undefined ? event : Object.freeze({ ...event, payloadSchemaRef: exact });
});
const additiveEventTypes = Object.freeze([
  "qa.triage-assessment.created",
  "qa.triage-assessment.stale",
  "qa.automated-session.ready",
  "qa.queue-facts.changed",
] as const);

export const qaCompetencyManifestV13 = Object.freeze({
  ...qaCompetencyManifestV12,
  metadata: Object.freeze({
    ...qaCompetencyManifestV12.metadata,
    version: "1.3.0",
    displayName: "QA Competency Pack with queue planning facts",
  }),
  workTypes: Object.freeze([qaValidationWorkTypeDefinitionV13]),
  events: Object.freeze([
    ...correctedEvents,
    ...additiveEventTypes.map((eventType) =>
      Object.freeze({
        eventType,
        payloadVersion: 1,
        payloadSchemaRef: exactEventSchemas[eventType],
      }),
    ),
  ]),
} as const satisfies CompetencyPackManifest);
