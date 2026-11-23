import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { OfflineSchemaRegistry } from "../../packages/platform-contracts/src/index.ts";
import { requiredFixture } from "../support/fixture-value.ts";

const root = resolve(import.meta.dirname, "../..");
const examples = resolve(root, "specs/002-qa-manual-walking-skeleton/contracts/examples");
const registry = new OfflineSchemaRegistry();

const schema = Object.freeze({
  finding: "urn:awp:schemas:qa:finding:v1",
  findingReview: "urn:awp:schemas:qa:finding-review-revision:v1",
  defectProposal: "urn:awp:schemas:qa:defect-draft-proposal:v1",
  defectDraft: "urn:awp:schemas:qa:defect-draft:v1",
  defectLink: "urn:awp:schemas:qa:defect-link:v1",
  evidenceManifest: "urn:awp:schemas:qa:evidence-manifest:v1",
  evidenceRevision: "urn:awp:schemas:qa:evidence-manifest-revision:v1",
  postCloseMarker: "urn:awp:schemas:qa:post-close-correction-marker:v1",
  verdict: "urn:awp:schemas:qa:verdict:v1",
  verdictSignature: "urn:awp:schemas:qa:verdict-signature:v1",
  dod: "urn:awp:schemas:qa:dod-assessment:v1",
  completion: "urn:awp:schemas:qa:completion-candidate:v1",
  finalClose: "urn:awp:schemas:qa:final-close-confirmation:v1",
  completionDefect:
    "urn:awp:schemas:operational-work-item:completion-summary:v1#/$defs/DefectReference",
  events: "urn:awp:schemas:qa:events:v1",
});

type JsonObject = Record<string, unknown>;

async function fixture(path: string): Promise<JsonObject> {
  return JSON.parse(await readFile(resolve(examples, path), "utf8")) as JsonObject;
}

function expectValid(schemaId: string, value: unknown): void {
  expect(() => registry.validateById(schemaId, value)).not.toThrow();
}

function expectInvalid(schemaId: string, value: unknown): void {
  expect(() => registry.validateById(schemaId, value)).toThrow();
}

interface EvidenceOpenApi {
  readonly paths: Readonly<
    Record<
      string,
      Readonly<{
        post: Readonly<{
          parameters: readonly unknown[];
          responses: Readonly<
            Record<
              string,
              Readonly<{
                headers: Readonly<Record<string, unknown>>;
                content: Readonly<
                  Record<
                    string,
                    Readonly<{
                      schema: Readonly<{ required: readonly string[] }>;
                    }>
                  >
                >;
              }>
            >
          >;
        }>;
      }>
    >
  >;
}

interface EventSchemaDefinition {
  readonly allOf?: readonly Readonly<{ $ref?: string }>[];
  readonly unevaluatedProperties?: boolean;
}

interface EventSchemaDocument {
  readonly oneOf: readonly Readonly<{ $ref: string }>[];
  readonly $defs: Readonly<Record<string, EventSchemaDefinition>>;
}

describe("Feature 002 outcome and event design contracts", () => {
  it("preserves Finding classification/disposition and exact Defect draft/link provenance", async () => {
    const classified = await fixture("positive/finding-review-classified.valid.json");
    const duplicate = await fixture("positive/finding-review-duplicate.valid.json");
    const waivedFinding = await fixture("positive/finding-header-waived.valid.json");
    const proposal = await fixture("positive/defect-draft-proposal.valid.json");
    const rejected = await fixture("positive/defect-draft-rejected.valid.json");
    const invalidatedReady = await fixture("positive/defect-draft-invalidated-ready.valid.json");
    const rejectedFromReady = await fixture("positive/defect-draft-rejected-from-ready.valid.json");
    const defectLink = await fixture("positive/defect-link.valid.json");

    expectValid(schema.findingReview, classified);
    expectValid(schema.findingReview, duplicate);
    expectValid(schema.finding, waivedFinding);
    expectValid(schema.defectProposal, proposal);
    expectValid(schema.defectDraft, rejected);
    expectValid(schema.defectDraft, invalidatedReady);
    expectValid(schema.defectDraft, rejectedFromReady);
    expectValid(schema.defectLink, defectLink);
    for (const invalidPath of [
      "negative/defect-draft-draft-with-acceptance.invalid.json",
      "negative/defect-draft-rejected-with-delivery-projection.invalid.json",
      "negative/defect-draft-failed-without-effect-key.invalid.json",
      "negative/defect-draft-invalidated-ready-without-acceptance.invalid.json",
      "negative/defect-draft-rejected-from-ready-without-acceptance.invalid.json",
    ]) {
      expectInvalid(schema.defectDraft, await fixture(invalidPath));
    }
  });

  it("keeps evidence adjudicative revisions separate from signed clerical annotations", async () => {
    const manifest = await fixture("positive/evidence-manifest-product-defect-required.valid.json");
    const clerical = await fixture("positive/evidence-manifest-clerical-correction.valid.json");
    const noteOnly = await fixture("positive/evidence-manifest-clerical-note-only.valid.json");
    expectValid(schema.evidenceManifest, manifest);
    expectValid(schema.evidenceRevision, clerical);
    expectValid(schema.evidenceRevision, noteOnly);
    expectInvalid(
      schema.evidenceRevision,
      await fixture("negative/evidence-manifest-initial-with-clerical-annotations.invalid.json"),
    );
    expectInvalid(
      schema.evidenceRevision,
      await fixture("negative/evidence-manifest-display-annotation-without-target.invalid.json"),
    );
    expectInvalid(
      schema.evidenceManifest,
      await fixture("negative/evidence-manifest-stray-accepted-risk-action.invalid.json"),
    );
  });

  it("requires manifest-header If-Match and returns the new resourceVersion through ETag", async () => {
    const api = parse(
      await readFile(
        resolve(root, "specs/002-qa-manual-walking-skeleton/contracts/openapi/qa-pack-api.v1.yaml"),
        "utf8",
      ),
    ) as EvidenceOpenApi;
    const path =
      "/api/v1/workspaces/{workspaceId}/projects/{projectId}/work-items/{workItemId}/qa/sessions/{sessionId}/evidence-manifests/{manifestId}/post-close-corrections";
    const operation = requiredFixture(api.paths[path]).post;
    expect(operation.parameters).toContainEqual({
      $ref: "#/components/parameters/IfMatch",
    });
    expect(requiredFixture(operation.responses["201"]).headers.ETag).toEqual({
      $ref: "#/components/headers/ETag",
    });
    expect(
      requiredFixture(requiredFixture(operation.responses["201"]).content["application/json"])
        .schema.required,
    ).toContain("manifestHeaderResourceVersion");
    expect(
      requiredFixture(requiredFixture(operation.responses["201"]).content["application/json"])
        .schema.required,
    ).toContain("adjudicativePointerChanged");
  });

  it("enforces exact Verdict signatures plus distinct incoming and outgoing supersession lineage", async () => {
    const verdict = await fixture("positive/qa-verdict-signed.valid.json");
    const signature = await fixture("positive/verdict-signature-primary.valid.json");
    expectValid(schema.verdict, verdict);
    expectValid(schema.verdictSignature, signature);
    for (const invalidPath of [
      "negative/qa-verdict-invalidated-state.invalid.json",
      "negative/verdict-medium-partially-signed.invalid.json",
      "negative/verdict-high-signed-one-signature.invalid.json",
      "negative/verdict-superseded-without-preserved-signature.invalid.json",
      "negative/verdict-v1-with-incoming-lineage.invalid.json",
      "negative/verdict-signed-with-orphan-supersession-reason.invalid.json",
    ]) {
      expectInvalid(schema.verdict, await fixture(invalidPath));
    }
    expectInvalid(schema.verdict, {
      ...verdict,
      supersedesVerdictRef: verdict.requiredSessionPlanRef,
      revisionReason: "orphan incoming lineage on v1",
    });
    expectInvalid(schema.verdict, {
      ...verdict,
      supersededByVerdictRef: verdict.requiredSessionPlanRef,
      supersessionReason: "orphan outgoing lineage while still SIGNED",
      supersededAt: "2026-08-27T13:00:00Z",
    });
  });

  it("allows server-derived DoD BLOCKED missing refs and closes READY/SATISFIED projections", async () => {
    const blocked = await fixture("positive/dod-assessment-blocked-missing-inputs.valid.json");
    const ready = await fixture("positive/dod-assessment-ready-to-close.valid.json");
    const satisfied = await fixture("positive/dod-assessment-satisfied.valid.json");
    expectValid(schema.dod, blocked);
    expectValid(schema.dod, ready);
    expectValid(schema.dod, satisfied);
    expect(blocked).not.toHaveProperty("verdictRef");
    expect(blocked).not.toHaveProperty("requiredSessionPlanRef");
    expectInvalid(
      schema.dod,
      await fixture("negative/dod-ready-missing-verdict-and-evidence.invalid.json"),
    );
  });

  it("preserves predecessor state for INVALIDATED/FAILED and keeps CONFIRMED reason-free", async () => {
    const confirmed = await fixture("positive/completion-candidate-confirmed.valid.json");
    const finalClose = await fixture("positive/final-close-confirmation.valid.json");
    const invalidated = await fixture(
      "positive/completion-invalidated-authorized-projection.valid.json",
    );
    const failed = await fixture("positive/completion-failed-dispatch-provenance.valid.json");
    expectValid(schema.completion, confirmed);
    expectValid(schema.finalClose, finalClose);
    expectValid(`${schema.completion}#/$defs/InvalidatedDeliveryProjection`, invalidated);
    expectValid(`${schema.completion}#/$defs/FailedDeliveryProjection`, failed);
    expectInvalid(
      `${schema.completion}#/$defs/ConfirmedDeliveryProjection`,
      await fixture("negative/completion-confirmed-with-terminal-reason.invalid.json"),
    );
    expectInvalid(
      `${schema.completion}#/$defs/InvalidatedDeliveryProjection`,
      await fixture("negative/completion-invalidated-from-dispatched.invalid.json"),
    );
    expectInvalid(
      `${schema.completion}#/$defs/FailedDeliveryProjection`,
      await fixture("negative/completion-failed-without-dispatch-provenance.invalid.json"),
    );
  });

  it("keeps completion-summary defect branches disposition-aware", async () => {
    for (const validPath of [
      "positive/completion-summary-defect-linked.valid.json",
      "positive/completion-summary-defect-rejected.valid.json",
    ]) {
      expectValid(schema.completionDefect, await fixture(validPath));
    }
    for (const invalidPath of [
      "negative/completion-summary-create-defect-linked-without-link.invalid.json",
      "negative/completion-summary-noncreate-with-draft.invalid.json",
      "negative/completion-summary-duplicate-without-exact-existing-defect.invalid.json",
    ]) {
      expectInvalid(schema.completionDefect, await fixture(invalidPath));
    }
  });

  it("requires server-derived HUMAN authorization in post-close marker and full event", async () => {
    const marker = await fixture("positive/post-close-correction-marker.valid.json");
    const event = await fixture("positive/post-close-correction-recorded-event.valid.json");
    expectValid(schema.postCloseMarker, marker);
    expectValid(`${schema.events}#/$defs/PostCloseCorrectionRecordedEvent`, event);
    expectInvalid(schema.postCloseMarker, {
      ...marker,
      requestedBy: { type: "SERVICE", principalId: "worker.local" },
    });
    expectInvalid(`${schema.events}#/$defs/PostCloseCorrectionRecordedEvent`, {
      ...event,
      payload: {
        ...(event.payload as JsonObject),
        authorizationBasisHash: undefined,
      },
    });
  });

  it("defines every QA event as a closed full envelope and validates representative families", async () => {
    const eventNames = [
      "RequestAcceptedEvent",
      "RequestInputRevisedEvent",
      "ReadinessAssessedEvent",
      "ReadinessConfirmedEvent",
      "RequiredSessionPlanPublishedEvent",
      "SessionStateChangedEvent",
      "SessionReviewedEvent",
      "PlanItemResultRecordedEvent",
      "FindingClassifiedEvent",
      "FindingDisposedEvent",
      "DefectLinkedEvent",
      "EvidenceManifestSignedEvent",
      "VerdictSignedEvent",
      "DodAssessedEvent",
      "DodSatisfiedEvent",
      "PostCloseCorrectionRecordedEvent",
    ] as const;
    const document = registry.document(schema.events).schema as unknown as EventSchemaDocument;
    expect(document.oneOf.map(({ $ref }) => $ref)).toEqual(
      eventNames.map((name) => `#/$defs/${name}`),
    );
    for (const name of eventNames) {
      expect(document.$defs[name]?.allOf?.[0]?.$ref).toBe("#/$defs/BaseEnvelope");
      expect(document.$defs[name]?.unevaluatedProperties).toBe(false);
    }

    for (const [name, path] of [
      ["RequestInputRevisedEvent", "positive/request-input-revised-event.valid.json"],
      ["DodSatisfiedEvent", "positive/dod-satisfied-event.valid.json"],
      [
        "PostCloseCorrectionRecordedEvent",
        "positive/post-close-correction-recorded-event.valid.json",
      ],
    ] as const) {
      expectValid(`${schema.events}#/$defs/${name}`, await fixture(path));
    }
    expectInvalid(
      `${schema.events}#/$defs/DodSatisfiedEvent`,
      await fixture("negative/event-missing-project.invalid.json"),
    );
  });
});
