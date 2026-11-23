import { createHash } from "node:crypto";

import type { DataSource } from "typeorm";

import { assessQaIntakeCompleteness, qaAggregateSnapshotHash } from "@awp/competency-qa/node";
import {
  AgentRunAggregate,
  type AgentRunSubject,
  type AgentToolGrant,
  type SkillDefinition,
} from "@awp/platform-core";
import {
  TypeOrmAgentRuntimeRepository,
  TypeOrmIntakeCandidateRepository,
} from "@awp/platform-persistence-typeorm";
import type {
  AgentRunsApiPort,
  IntakeCandidatesApiPort,
  IntakeDraftRevisionApiPort,
  NotificationIntentsApiPort,
} from "@awp/platform-runtime-nest";
import {
  createHermesSkillRegistry,
  PromptManifestBuilder,
  QaIntakeDraftService,
} from "@awp/runtime-composition";

import {
  authorizeQaApi,
  type QaApiAuthorization,
  type QaSessionRequest,
} from "./qa-api-authorization.ts";

/** The composition must independently resolve current service and human action rights. */
export interface CoreAgentGrantAuthority {
  resolve(
    input: Readonly<{
      authorization: QaApiAuthorization;
      subject: AgentRunSubject;
      skill: SkillDefinition;
    }>,
  ): Promise<Readonly<{ servicePrincipalId: string; grants: readonly AgentToolGrant[] }>>;
}
export interface CoreIntakeHttpApis {
  readonly drafts: IntakeDraftRevisionApiPort;
  readonly candidates: IntakeCandidatesApiPort;
  readonly agents: AgentRunsApiPort;
  readonly notifications: NotificationIntentsApiPort;
}
function deterministicUuid(namespace: string): string {
  const hex = createHash("sha256").update(namespace).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}
export function createCoreIntakeHttpApis(
  source: DataSource,
  agentAuthority: CoreAgentGrantAuthority,
): CoreIntakeHttpApis {
  const authorize = (
    request: object,
    workspaceId: string,
    projectId: string,
    permission = "work-item.read",
  ) => authorizeQaApi(source, request as QaSessionRequest, workspaceId, projectId, permission);
  const drafts: IntakeDraftRevisionApiPort = ((source: DataSource): IntakeDraftRevisionApiPort => ({
    list: async ({ workspaceId, projectId, draftId, request }) => {
      await authorize(request, workspaceId, projectId);
      return {
        items: (await source.query(
          'SELECT id,workspace_id AS "workspaceId",project_id AS "projectId",draft_id AS "draftId",revision,content,content_hash AS "contentHash",source_kind AS "sourceKind",created_by AS "createdBy",created_at AS "createdAt" FROM intake_draft_revisions WHERE workspace_id=$1 AND project_id=$2 AND draft_id=$3 ORDER BY revision',
          [workspaceId, projectId, draftId],
        )) as readonly Readonly<Record<string, unknown>>[],
      };
    },
    revise: async ({ workspaceId, projectId, draftId, request: httpRequest, body }) => {
      const authorization = await authorize(
        httpRequest,
        workspaceId,
        projectId,
        "qa.request.input.revise",
      );
      const request = body as Readonly<{
        expectedRevision?: unknown;
        expectedContentHash?: unknown;
        content?: unknown;
      }>;
      if (
        !Number.isInteger(request.expectedRevision) ||
        typeof request.expectedContentHash !== "string" ||
        !request.content ||
        typeof request.content !== "object" ||
        Array.isArray(request.content)
      )
        throw new Error("DRAFT_REVISION_REQUEST_INVALID");
      const result = await new QaIntakeDraftService(source).revise({
        workspaceId,
        projectId,
        draftId,
        principalId: authorization.actor.principalId,
        expectedRevision: Number(request.expectedRevision),
        expectedContentHash: request.expectedContentHash,
        content: request.content as never,
        sourceKind: "HUMAN_FORM",
      });
      return result.draft;
    },
    validate: async ({ workspaceId, projectId, draftId, request: httpRequest, body }) => {
      await authorize(httpRequest, workspaceId, projectId, "qa.request.input.revise");
      const exact = body as Readonly<{ revision?: unknown; contentHash?: unknown }>;
      const draft = await new QaIntakeDraftService(source).get({ workspaceId, projectId }, draftId);
      if (exact.revision !== draft.revision || exact.contentHash !== draft.contentHash)
        throw new Error("DRAFT_VALIDATION_STALE_REVISION");
      return assessQaIntakeCompleteness({
        workspaceId,
        projectId,
        draftId,
        revision: draft.revision,
        contentHash: draft.contentHash as `sha256:${string}`,
        content: draft.content,
      });
    },
  }))(source);
  const candidates: IntakeCandidatesApiPort = ((source: DataSource): IntakeCandidatesApiPort => {
    const candidates = new TypeOrmIntakeCandidateRepository(source);
    const drafts = new QaIntakeDraftService(source);
    return {
      list: async ({ workspaceId, projectId, request }) => {
        await authorize(request, workspaceId, projectId);
        return { items: await candidates.list(workspaceId, projectId) };
      },
      get: async ({ workspaceId, projectId, candidateId, request }) => {
        await authorize(request, workspaceId, projectId);
        const value = await candidates.get(workspaceId, projectId, candidateId);
        if (!value) throw new Error("CANDIDATE_NOT_FOUND");
        return value;
      },
      decide: async ({ workspaceId, projectId, candidateId, request: httpRequest, body }) => {
        const authorization = await authorize(
          httpRequest,
          workspaceId,
          projectId,
          "qa.request.create",
        );
        const request = body as Readonly<{
          decision?: unknown;
          expectedCandidateVersion?: unknown;
          expectedSourceObservationVersion?: unknown;
          snoozedUntil?: unknown;
          reasonCode?: unknown;
          requestKey?: unknown;
        }>;
        if (
          !new Set(["CREATE", "SNOOZE", "IGNORE"]).has(String(request.decision)) ||
          !Number.isInteger(request.expectedCandidateVersion) ||
          !Number.isInteger(request.expectedSourceObservationVersion) ||
          typeof request.requestKey !== "string" ||
          request.requestKey.length < 1
        )
          throw new Error("CANDIDATE_DECISION_REQUEST_INVALID");
        const requestKey = request.requestKey;
        const principalId = authorization.actor.principalId;
        const provenance = `candidate-decision:${candidateId}:${createHash("sha256").update(requestKey).digest("hex")}`;
        return await source.transaction("SERIALIZABLE", async (manager) => {
          await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [provenance]);
          const currentAuthority = await authorize(
            httpRequest,
            workspaceId,
            projectId,
            "qa.request.create",
          );
          if (
            currentAuthority.actor.principalId !== principalId ||
            qaAggregateSnapshotHash(currentAuthority.basis as never) !==
              qaAggregateSnapshotHash(authorization.basis as never)
          )
            throw new Error("CANDIDATE_DECISION_AUTHORITY_CHANGED");
          const scopedCandidate = (await manager.query(
            "SELECT id FROM intake_candidates WHERE workspace_id=$1 AND project_id=$2 AND id=$3 FOR UPDATE",
            [workspaceId, projectId, candidateId],
          )) as readonly unknown[];
          if (!scopedCandidate.length) throw new Error("CANDIDATE_NOT_FOUND");
          const replay = (await manager.query(
            "SELECT decision FROM intake_candidate_decisions WHERE candidate_id=$1 AND action_provenance_ref=$2",
            [candidateId, provenance],
          )) as readonly unknown[];
          if (replay.length) {
            const value = await candidates.get(workspaceId, projectId, candidateId);
            return Object.freeze({ candidate: value, replayed: true });
          }
          let draft: unknown;
          let convertedDraftId: string | undefined;
          if (request.decision === "CREATE") {
            const observations = (await manager.query(
              "SELECT minimal_summary FROM intake_candidate_source_observations WHERE candidate_id=$1 AND version=$2",
              [candidateId, request.expectedSourceObservationVersion],
            )) as readonly Readonly<{ minimal_summary: unknown }>[];
            const summaryValue: unknown =
              typeof observations[0]?.minimal_summary === "string"
                ? (JSON.parse(observations[0].minimal_summary) as unknown)
                : observations[0]?.minimal_summary;
            const summary =
              summaryValue !== null &&
              typeof summaryValue === "object" &&
              !Array.isArray(summaryValue)
                ? (summaryValue as Readonly<Record<string, unknown>>)
                : undefined;
            if (!summary) throw new Error("CANDIDATE_OBSERVATION_NOT_FOUND");
            const created = await drafts.createInTransaction(manager, {
              workspaceId,
              projectId,
              principalId,
              requestKey,
              originCandidateId: candidateId,
              content: {
                schemaVersion: 1,
                ...(typeof summary.title === "string" ? { title: summary.title } : {}),
                requestedClassificationKey: "INTERNAL",
              },
            });
            draft = created.draft;
            convertedDraftId = created.draft.id;
          }
          const candidate = await candidates.decideInTransaction(manager, {
            workspaceId,
            projectId,
            candidateId,
            actorPrincipalId: principalId,
            actorKind: "HUMAN",
            decision: request.decision as "CREATE" | "SNOOZE" | "IGNORE",
            expectedRowVersion: Number(request.expectedCandidateVersion),
            expectedSourceObservationVersion: Number(request.expectedSourceObservationVersion),
            ...(request.snoozedUntil
              ? { snoozedUntil: new Date(String(request.snoozedUntil)) }
              : {}),
            ...(convertedDraftId ? { convertedDraftId } : {}),
            authorizationBasisHash: qaAggregateSnapshotHash(authorization.basis as never),
            actionProvenanceRef: provenance,
            now: new Date(),
          });
          const event = {
            candidateId,
            decision: request.decision,
            candidateVersion: candidate.rowVersion,
            ...(convertedDraftId ? { draftId: convertedDraftId } : {}),
          };
          await manager.query(
            "INSERT INTO event_outbox(id,workspace_id,project_id,event_type,envelope,envelope_hash,state,created_at) VALUES($1,$2,$3,$4,$5,$6,'READY',clock_timestamp())",
            [
              deterministicUuid(provenance),
              workspaceId,
              projectId,
              convertedDraftId
                ? "intake.candidate.converted"
                : "intake.candidate.decision-recorded",
              JSON.stringify(event),
              `sha256:${createHash("sha256").update(JSON.stringify(event)).digest("hex")}`,
            ],
          );
          return Object.freeze({ candidate, ...(draft ? { draft } : {}), replayed: false });
        });
      },
    };
  })(source);
  const agents: AgentRunsApiPort = ((source: DataSource): AgentRunsApiPort => {
    const repository = new TypeOrmAgentRuntimeRepository(source);
    const registry = createHermesSkillRegistry();
    const promptBuilder = new PromptManifestBuilder();
    return {
      start: async ({ workspaceId, projectId, request: httpRequest, body }) => {
        const authorization = await authorize(httpRequest, workspaceId, projectId);
        const request = body as Readonly<{
          skillRef?: unknown;
          subject?: unknown;
          requestKey?: unknown;
        }>;
        if (
          typeof request.skillRef !== "string" ||
          typeof request.requestKey !== "string" ||
          !request.subject ||
          typeof request.subject !== "object"
        )
          throw new Error("AGENT_RUN_REQUEST_INVALID");
        const skillRef = request.skillRef,
          requestKey = request.requestKey;
        const match = /^([a-z0-9._-]+)@(\d+\.\d+\.\d+)$/u.exec(skillRef);
        if (!match) throw new Error("AGENT_SKILL_REF_INVALID");
        const skill = registry.resolve(match[1]!, match[2]!);
        const requested = request.subject as Readonly<{
          kind?: unknown;
          id?: unknown;
          version?: unknown;
          contentHash?: unknown;
        }>;
        if (
          !new Set(["DRAFT", "CANDIDATE", "WORK_ITEM"]).has(String(requested.kind)) ||
          typeof requested.id !== "string" ||
          !Number.isInteger(requested.version) ||
          typeof requested.contentHash !== "string"
        )
          throw new Error("AGENT_SUBJECT_INVALID");
        const subject = Object.freeze({
          kind: requested.kind as "DRAFT" | "CANDIDATE" | "WORK_ITEM",
          id: requested.id,
          version: Number(requested.version),
          contentHash: requested.contentHash,
          aggregateSnapshotHash: `sha256:${createHash("sha256").update(`${requested.kind}:${requested.id}:${requested.version}:${requested.contentHash}`).digest("hex")}`,
        });
        if (!skill.allowedSubjects.includes(subject.kind))
          throw new Error("AGENT_SKILL_SUBJECT_DENIED");
        let rows: readonly Readonly<Record<string, unknown>>[];
        if (subject.kind === "DRAFT")
          rows = (await source.query(
            "SELECT current_revision AS version,current_content_hash AS content_hash FROM intake_drafts WHERE workspace_id=$1 AND project_id=$2 AND id=$3",
            [workspaceId, projectId, subject.id],
          )) as readonly Readonly<Record<string, unknown>>[];
        else if (subject.kind === "CANDIDATE")
          rows = (await source.query(
            "SELECT row_version AS version,current_source_fingerprint AS content_hash FROM intake_candidates WHERE workspace_id=$1 AND project_id=$2 AND id=$3",
            [workspaceId, projectId, subject.id],
          )) as readonly Readonly<Record<string, unknown>>[];
        else
          rows = (await source.query(
            "SELECT row_version AS version,'sha256:'||encode(sha256(concat_ws(':',id::text,row_version::text,state)::bytea),'hex') AS content_hash FROM work_items WHERE workspace_id=$1 AND project_id=$2 AND id=$3",
            [workspaceId, projectId, subject.id],
          )) as readonly Readonly<Record<string, unknown>>[];
        const current = rows[0];
        if (
          !current ||
          Number(current.version) !== subject.version ||
          String(current.content_hash) !== subject.contentHash
        )
          throw new Error("AGENT_SUBJECT_STALE");
        const resolved = await agentAuthority.resolve({ authorization, subject, skill });
        const currentAuthority = await authorize(httpRequest, workspaceId, projectId);
        if (
          currentAuthority.actor.principalId !== authorization.actor.principalId ||
          qaAggregateSnapshotHash(currentAuthority.basis as never) !==
            qaAggregateSnapshotHash(authorization.basis as never)
        )
          throw new Error("AGENT_HUMAN_AUTHORITY_CHANGED");
        if (
          !resolved.servicePrincipalId ||
          !resolved.grants.length ||
          authorization.classificationCeiling === "PUBLIC"
        )
          throw new Error("AGENT_GRANTS_DENIED");
        const grants = resolved.grants;
        const id = deterministicUuid(
          `agent-run:${workspaceId}:${projectId}:${authorization.actor.principalId}:${requestKey}`,
        );
        const aggregate = AgentRunAggregate.start({
          id,
          workspaceId,
          projectId,
          requestKey,
          subject,
          humanPrincipalId: authorization.actor.principalId,
          servicePrincipalId: resolved.servicePrincipalId,
          grants,
          requestPayload: {
            skillRef,
            subject: {
              kind: subject.kind,
              id: subject.id,
              version: subject.version,
              contentHash: subject.contentHash,
            },
            requestKey,
          },
        });
        const prompt = promptBuilder.build({
          workspaceId,
          projectId,
          subject,
          skill,
          facts: [
            {
              sourceKind:
                subject.kind === "WORK_ITEM"
                  ? "QA_STATE"
                  : subject.kind === "CANDIDATE"
                    ? "JIRA"
                    : "DRAFT",
              sourceRef: `${subject.kind}:${subject.id}`,
              sourceVersion: String(subject.version),
              sourceHash: subject.contentHash,
              classification: "INTERNAL",
              key: "subjectContentHash",
              value: subject.contentHash,
            },
          ],
          allowedFactKeys: ["subjectContentHash"],
          maximumClassification: "INTERNAL",
          createdAt: new Date(),
        });
        return await repository.create(aggregate.snapshot(), prompt);
      },
      get: async ({ workspaceId, projectId, runId, request }) => {
        await authorize(request, workspaceId, projectId);
        const value = await repository.get(workspaceId, projectId, runId);
        if (!value) throw new Error("AGENT_RUN_NOT_FOUND");
        return value;
      },
    };
  })(source);
  const notifications: NotificationIntentsApiPort = ((
    source: DataSource,
  ): NotificationIntentsApiPort => ({
    get: async ({ workspaceId, projectId, notificationIntentId, request }) => {
      await authorize(request, workspaceId, projectId);
      const rows = (await source.query(
        `
            SELECT n.id,n.workspace_id AS "workspaceId",n.project_id AS "projectId",n.dedupe_key AS "dedupeKey",
                   n.source_event_ref AS "sourceEventRef",n.target,n.target_hash AS "targetHash",n.payload_hash AS "payloadHash",
                   n.render_hash AS "renderHash",n.command_id AS "commandId",n.state,n.reconciliation,n.expires_at AS "expiresAt",
                   n.row_version AS "rowVersion",n.created_at AS "createdAt",
                   COALESCE(jsonb_agg(jsonb_build_object('attempt',a.attempt,'fence',a.fence,'startedAt',a.started_at,
                     'effectInvocationStartedAt',a.effect_invocation_started_at,'outcome',a.outcome,'selectorHash',a.selector_hash)
                     ORDER BY a.attempt) FILTER (WHERE a.attempt IS NOT NULL),'[]'::jsonb) AS attempts
              FROM notification_intents n
              LEFT JOIN notification_delivery_attempts a ON a.notification_intent_id=n.id
             WHERE n.workspace_id=$1 AND n.project_id=$2 AND n.id=$3
             GROUP BY n.id`,
        [workspaceId, projectId, notificationIntentId],
      )) as readonly Readonly<Record<string, unknown>>[];
      const value = rows[0];
      if (!value) throw new Error("NOTIFICATION_INTENT_NOT_FOUND");
      return Object.freeze({
        ...value,
        state: value.state === "FAILED" ? "FAILED_FINAL" : value.state,
        capture: "SUPPRESSED",
      });
    },
  }))(source);
  return Object.freeze({ drafts, candidates, agents, notifications });
}
