import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { OfflineSchemaRegistry } from "../../packages/platform-contracts/src/index.ts";
import { requiredFixture } from "../support/fixture-value.ts";

const root = resolve(import.meta.dirname, "../..");
const examples = resolve(root, "specs/002-qa-manual-walking-skeleton/contracts/examples");
const registry = new OfflineSchemaRegistry();

const schemas = Object.freeze({
  intake: "urn:awp:schemas:qa:intake:v1",
  context: "urn:awp:schemas:qa:project-context:v1",
  policy: "urn:awp:schemas:qa:risk-review-policy:v1",
  extension: "urn:awp:schemas:qa:request-extension:v1",
  inputRevision: "urn:awp:schemas:qa:request-input-revision:v1",
  inputRevisionCommand: "urn:awp:schemas:qa:request-input-revision:v1#/$defs/RevisionCommand",
  inputHistory: "urn:awp:schemas:qa:request-input-history:v1",
  readiness: "urn:awp:schemas:qa:readiness-assessment:v1",
  waiver: "urn:awp:schemas:qa:waiver:v1",
  waiverKind: "urn:awp:schemas:qa:waiver:v1#/$defs/WaiverKind",
  plan: "urn:awp:schemas:qa:required-session-plan:v1",
  planPublication:
    "urn:awp:schemas:qa:required-session-plan:v1#/$defs/PublicationPredecessorDecision",
  planHistory: "urn:awp:schemas:qa:required-session-plan-history:v1",
  operationalReadiness:
    "urn:awp:schemas:qa:work-item-detail:v1#/$defs/OperationalReadinessProjection",
});

async function fixture<T extends object>(path: string): Promise<T> {
  return JSON.parse(await readFile(resolve(examples, path), "utf8")) as T;
}

function expectValid(schemaId: string, value: unknown): void {
  expect(() => registry.validateById(schemaId, value)).not.toThrow();
}

function expectInvalid(schemaId: string, value: unknown): void {
  expect(() => registry.validateById(schemaId, value)).toThrow();
}

function without(
  value: Readonly<Record<string, unknown>>,
  ...keys: readonly string[]
): Record<string, unknown> {
  const omitted = new Set(keys);
  return Object.fromEntries(
    Object.entries(structuredClone(value)).filter(([key]) => !omitted.has(key)),
  );
}

interface RequiredSessionPlanOpenApi {
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

describe("Feature 002 request and readiness design contracts", () => {
  it("keeps intake, project policy and request projections closed while accepting a DoR-incomplete initial revision", async () => {
    const intake = await fixture<Record<string, unknown>>("positive/qa-intake.valid.json");
    const context = await fixture<Record<string, unknown>>(
      "positive/qa-project-context.valid.json",
    );
    const policy = await fixture<Record<string, unknown>>("positive/risk-review-policy.valid.json");
    const extension = await fixture<Record<string, unknown>>(
      "positive/qa-request-extension.valid.json",
    );
    const revision = await fixture<Record<string, unknown>>(
      "positive/qa-request-input-revision-incomplete.valid.json",
    );

    expectValid(schemas.intake, intake);
    expectValid(schemas.context, context);
    expectValid(schemas.policy, policy);
    expectValid(schemas.extension, extension);
    expectValid(schemas.inputRevision, revision);
    for (const omittedDorFact of [
      "goal",
      "scope",
      "acceptanceOutcome",
      "requestedTarget",
      "requestRisk",
      "businessImpact",
      "desiredDate",
    ]) {
      expect(revision).not.toHaveProperty(omittedDorFact);
    }

    const currentInputRevisionRef = extension.currentRequestInputRevisionRef;
    expectValid(schemas.inputHistory, {
      schemaVersion: 1,
      workspaceId: revision.workspaceId,
      projectId: revision.projectId,
      workItemId: revision.workItemId,
      extensionId: extension.extensionId,
      currentInputRevisionRef,
      resourceVersion: extension.resourceVersion,
      revisions: [revision],
    });
    expectInvalid(schemas.extension, { ...extension, embeddedSessionPlan: {} });
    expectInvalid(schemas.inputRevision, { ...revision, providerWorkflow: "BACKLOG" });
  });

  it("requires a bounded human reason and forbids structural identity in revision commands", async () => {
    const command = await fixture<Record<string, unknown>>(
      "positive/request-input-revision-command-semantic-only.valid.json",
    );
    const drift = await fixture<Record<string, unknown>>(
      "negative/request-input-revision-command-structural-identity-drift.invalid.json",
    );
    const missingReason = await fixture<Record<string, unknown>>(
      "negative/request-input-revision-reason-missing-text.invalid.json",
    );
    const persistedWithoutReason = await fixture<Record<string, unknown>>(
      "negative/request-input-revision-v2-without-reason.invalid.json",
    );

    expectValid(schemas.inputRevisionCommand, command);
    expectInvalid(schemas.inputRevisionCommand, drift);
    expectInvalid(schemas.inputRevisionCommand, without(command, "reason"));
    expectInvalid(
      "urn:awp:schemas:qa:request-input-revision:v1#/$defs/RevisionReason",
      missingReason,
    );
    expectInvalid(schemas.inputRevision, persistedWithoutReason);
  });

  it("enforces INITIAL iff null predecessor and exposes the plan-header ETag/resourceVersion CAS handoff", async () => {
    const initial = await fixture<Record<string, unknown>>(
      "positive/required-session-plan-initial-predecessor.valid.json",
    );
    const revision = await fixture<Record<string, unknown>>(
      "positive/required-session-plan-revision-predecessor.valid.json",
    );
    const initialWithPredecessor = await fixture<Record<string, unknown>>(
      "negative/required-session-plan-initial-with-predecessor.invalid.json",
    );
    const revisionWithoutPredecessor = await fixture<Record<string, unknown>>(
      "negative/required-session-plan-revision-without-predecessor.invalid.json",
    );
    const bootstrap = await fixture<Record<string, unknown>>(
      "positive/required-session-plan-bootstrap-history.valid.json",
    );
    const plan = await fixture<Record<string, unknown>>(
      "positive/required-session-plan.valid.json",
    );

    expectValid(schemas.planPublication, initial);
    expectValid(schemas.planPublication, revision);
    expectInvalid(schemas.planPublication, initialWithPredecessor);
    expectInvalid(schemas.planPublication, revisionWithoutPredecessor);
    expectValid(schemas.planHistory, bootstrap);
    expectValid(schemas.plan, plan);

    const api = parse(
      await readFile(
        resolve(root, "specs/002-qa-manual-walking-skeleton/contracts/openapi/qa-pack-api.v1.yaml"),
        "utf8",
      ),
    ) as RequiredSessionPlanOpenApi;
    const operation = requiredFixture(
      api.paths[
        "/api/v1/workspaces/{workspaceId}/projects/{projectId}/work-items/{workItemId}/qa/required-session-plans"
      ],
    ).post;
    expect(operation.parameters).toContainEqual({
      $ref: "#/components/parameters/IfMatch",
    });
    expect(requiredFixture(operation.responses["201"]).headers.ETag).toEqual({
      $ref: "#/components/headers/ETag",
    });
    expect(
      requiredFixture(requiredFixture(operation.responses["201"]).content["application/json"])
        .schema.required,
    ).toContain("planHeaderResourceVersion");
  });

  it("keeps exact waiver kinds and lifecycle projections mutually exclusive", async () => {
    const approved = await fixture<Record<string, unknown>>("positive/dor-waiver.valid.json");
    const decisionFields = ["decidedBy", "authorizationBasisHash", "decidedAt"] as const;
    const pending = {
      ...without(approved, ...decisionFields),
      state: "PENDING",
    };
    const rejected = { ...approved, state: "REJECTED" };
    const consumed = { ...approved, state: "CONSUMED", consumedAt: "2026-08-27T12:03:00Z" };
    const invalidated = {
      ...pending,
      state: "INVALIDATED",
      invalidationReason: "INPUT_REVISION_ADVANCED",
      invalidatedBy: approved.decidedBy,
      invalidatedAt: "2026-08-27T12:03:00Z",
    };
    const expired = { ...pending, state: "EXPIRED", expiredAt: "2026-08-28T12:00:01Z" };

    for (const value of [approved, pending, rejected, consumed, invalidated, expired]) {
      expectValid(schemas.waiver, value);
    }
    expectInvalid(schemas.waiver, { ...pending, decidedBy: approved.decidedBy });
    expectInvalid(schemas.waiver, { ...consumed, expiredAt: "2026-08-28T12:00:01Z" });
    expectInvalid(schemas.waiver, { ...expired, invalidationReason: "STALE" });
    expectInvalid(schemas.waiverKind, "DOD");
    expectInvalid(schemas.waiver, { ...approved, waiverKind: "PLAN_ITEM" });
  });

  it("validates NEEDS_INFO, READY and exact waived readiness as distinct branches", async () => {
    const needsInfo = await fixture<Record<string, unknown>>(
      "positive/readiness-assessment-needs-info.valid.json",
    );
    const ready = await fixture<Record<string, unknown>>(
      "positive/readiness-assessment-ready.valid.json",
    );
    const waivedWithoutRef = await fixture<Record<string, unknown>>(
      "negative/readiness-waived-registry-without-waiver.invalid.json",
    );
    const nonRegistryWaiver = await fixture<Record<string, unknown>>(
      "negative/dor-nonregistry-waiver.invalid.json",
    );

    expectValid(schemas.readiness, needsInfo);
    expectValid(schemas.readiness, ready);
    expectInvalid(
      "urn:awp:schemas:qa:readiness-assessment:v1#/$defs/ReadyWithWaiverProjectRegistryInput",
      waivedWithoutRef,
    );
    expectInvalid(
      "urn:awp:schemas:qa:readiness-assessment:v1#/$defs/WaivableReadinessBlockerCode",
      nonRegistryWaiver,
    );
    expectInvalid(schemas.readiness, {
      ...ready,
      waiverRef: (await fixture<Record<string, unknown>>("positive/dor-waiver.valid.json"))
        .subjectRef,
    });
  });

  it("implements a closed operational readiness assessment/sync/result/error matrix", async () => {
    const confirmed = await fixture<Record<string, unknown>>(
      "positive/operational-readiness-confirmed-later-state.valid.json",
    );
    const assessmentRef = confirmed.assessmentRef;
    const readinessCommandRef = confirmed.readinessCommandRef;
    const readinessResultRef = confirmed.readinessResultRef;
    const matrix = [
      {
        assessmentRef: null,
        assessmentState: "NOT_EVALUATED",
        normalizedStatus: "NEW",
        syncStage: "NOT_EVALUATED",
      },
      {
        assessmentRef,
        assessmentState: "NEEDS_INFO",
        normalizedStatus: "NEW",
        syncStage: "NEEDS_INFO",
      },
      {
        assessmentRef,
        assessmentState: "READY",
        normalizedStatus: "NEW",
        syncStage: "READY_PENDING_SYNC",
        readinessCommandRef,
      },
      {
        assessmentRef,
        assessmentState: "READY_WITH_WAIVER",
        normalizedStatus: "NEW",
        syncStage: "SYNC_ERROR",
        readinessCommandRef,
        syncErrorCode: "CONNECTOR_UNAVAILABLE",
      },
      confirmed,
    ];
    for (const projection of matrix) expectValid(schemas.operationalReadiness, projection);

    expectInvalid(schemas.operationalReadiness, {
      ...matrix[2],
      readinessCommandRef: undefined,
    });
    expectInvalid(schemas.operationalReadiness, {
      ...matrix[3],
      readinessResultRef,
    });
    expectInvalid(schemas.operationalReadiness, {
      ...confirmed,
      syncStage: "CONFIRMED_WITH_WARNING",
    });
  });
});
