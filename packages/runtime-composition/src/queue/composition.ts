import type { DataSource, EntityManager } from "typeorm";

import {
  type QaQueueActivity,
  type QaQueueFacts,
  TypeOrmQaQueueFactRepository,
} from "@awp/competency-qa/node";
import { type JsonValue, sha256 } from "@awp/platform-contracts";
import {
  type ConfirmedJiraProjectionRef,
  createQueueStageTransition,
  type ProjectQueuePolicyFacet,
  validateQueueEntryProjection,
} from "@awp/platform-core";
import {
  AuthorizedScopeMembershipRepository,
  CapacityAdmissionRepository,
  CapacityScopeProjectionRepository,
  QueueActionCandidateRepository,
  QueueControlRepository,
  QueueOrderInvalidationRepository,
  QueuePolicyRepository,
  QueueProjectionRepository,
  SlaClockRepository,
  SlaRolloutVerificationRepository,
  TypeOrmOperationalAuthorityRepository,
} from "@awp/platform-persistence-typeorm";

import { qaJiraGitLabMattermostLocalComposition } from "../mattermost/gitlab-composition.ts";
import {
  PostgresCapacityAdmissionBinder,
  type PostgresCapacityAdmissionBinderPorts,
} from "./admission-service.ts";
import {
  ConfirmedJiraSlaStartProjector,
  LocalQueueFactComposer,
  type LocalQueuePlanningFacts,
  type QueueExactSourceRef,
  QueueProjectionCoordinator,
  type QueueProjectionCoordinatorPorts,
  queueProjectionEventTypes,
  type QueueProjectionSourceSnapshot,
  slaClockTransitionEventEnvelope,
  type SlaLifecycleFacts,
  SlaLifecycleProjector,
} from "./projection-worker.ts";
import { PostgresSlaTemporalClockLoader } from "./temporal-transition-worker.ts";

type Row = Record<string, unknown>;
const rows = (value: unknown): readonly Row[] => {
  const raw = value as readonly unknown[];
  return (Array.isArray(raw?.[0]) ? raw[0] : raw) as readonly Row[];
};
const json = <T>(value: unknown): T =>
  typeof value === "string" ? (JSON.parse(value) as T) : (value as T);
const digest = (value: unknown) => sha256(value as JsonValue);
const deterministicUuid = (namespace: string): string => {
  const hex = sha256(namespace).slice(7);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

function qaActivity(value: QaQueueActivity) {
  return Object.freeze({
    sessionId: value.sessionId,
    sessionRef: Object.freeze({
      ...value.sessionRef,
      sourceType: "QA_TEST_SESSION_REVISION" as const,
    }),
    mode: value.mode,
    state: value.state,
  });
}

function projectionEnvelope(
  input: Readonly<{
    eventId: string;
    eventType: string;
    workspaceId: string;
    projectId: string;
    entityType: string;
    entityId: string;
    entityVersion: number;
    occurredAt: string;
    payloadSchemaId: string;
    payload: Readonly<Record<string, unknown>>;
    correlationId: string;
    causationId: string;
  }>,
) {
  return Object.freeze({
    envelopeVersion: 1,
    eventId: input.eventId,
    eventType: input.eventType,
    occurredAt: input.occurredAt,
    recordedAt: input.occurredAt,
    producer: "worker.queue-projector",
    producerVersion: "1.0.0",
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    entityType: input.entityType,
    entityId: input.entityId,
    entityVersion: input.entityVersion,
    correlationId: input.correlationId,
    causationId: input.causationId,
    actor: Object.freeze({
      kind: "SERVICE",
      principalId: deterministicUuid("worker.queue-projector"),
      serviceKey: "worker.queue-projector",
    }),
    dataClassificationKey: "INTERNAL",
    payloadVersion: 1,
    payloadSchemaRef: Object.freeze({
      id: input.payloadSchemaId,
      version: 1,
      digest: digest(input.payload),
    }),
    payload: input.payload,
  });
}

export async function appendProjectionEvent(
  manager: EntityManager,
  envelope: Readonly<Record<string, unknown>>,
): Promise<void> {
  await manager.query(
    "INSERT INTO event_outbox(id,workspace_id,project_id,event_type,envelope,envelope_hash,state,created_at) VALUES($1,$2,$3,$4,$5,$6,'READY',$7) ON CONFLICT(id) DO NOTHING",
    [
      envelope.eventId,
      envelope.workspaceId,
      envelope.projectId,
      envelope.eventType,
      JSON.stringify(envelope),
      digest(envelope),
      envelope.recordedAt,
    ],
  );
}

/** Named static provider catalog; no runtime module discovery is permitted. */
export const queueFoundationRepositoryProviderTypes = Object.freeze([
  AuthorizedScopeMembershipRepository,
  QueuePolicyRepository,
  QueueProjectionRepository,
  SlaClockRepository,
  SlaRolloutVerificationRepository,
  QueueControlRepository,
  QueueOrderInvalidationRepository,
  QueueActionCandidateRepository,
  CapacityScopeProjectionRepository,
  CapacityAdmissionRepository,
  TypeOrmQaQueueFactRepository,
]);

export function createQueueFoundationRepositoryProviders(source: DataSource) {
  return Object.freeze({
    authorizedScopeMembership: new AuthorizedScopeMembershipRepository(source),
    policy: new QueuePolicyRepository(source),
    projection: new QueueProjectionRepository(source),
    slaClock: new SlaClockRepository(source),
    slaRolloutVerification: new SlaRolloutVerificationRepository(source),
    control: new QueueControlRepository(source),
    orderInvalidation: new QueueOrderInvalidationRepository(source),
    actionCandidate: new QueueActionCandidateRepository(source),
    capacityProjection: new CapacityScopeProjectionRepository(source),
    admission: new CapacityAdmissionRepository(source),
    qaFacts: new TypeOrmQaQueueFactRepository(source),
  });
}

/** Canonical Feature 006 mutation binder shared by HTTP, QA Session, automation, and reconciliation adapters. */
export function createPostgresQueueCapacityAdmissionBinder(
  source: DataSource,
  ports: PostgresCapacityAdmissionBinderPorts,
): PostgresCapacityAdmissionBinder {
  return new PostgresCapacityAdmissionBinder(source, ports);
}

export function createPostgresLocalQueueFactComposer(
  source: DataSource,
  repositories = createQueueFoundationRepositoryProviders(source),
): LocalQueueFactComposer {
  const authority = new TypeOrmOperationalAuthorityRepository(source);
  const input = (
    subject: Readonly<{ workspaceId: string; projectId: string; subjectId: string }>,
  ) => subject;
  return new LocalQueueFactComposer({
    workItem: {
      async current(subject) {
        const workItemQueries = (await Promise.all([
          source.query(
            `SELECT w.id,w.row_version,w.classification_key,w.created_at,d.work_type_key,d.definition_version,d.definition_hash
             FROM work_items w JOIN work_type_definitions d ON d.id=w.work_type_definition_id
            WHERE w.workspace_id=$1 AND w.project_id=$2 AND w.id=$3`,
            [subject.workspaceId, subject.projectId, subject.subjectId],
          ),
          source.query(
            "SELECT * FROM intake_candidates WHERE workspace_id=$1 AND project_id=$2 AND id=$3",
            [subject.workspaceId, subject.projectId, subject.subjectId],
          ),
          source.query(
            "SELECT * FROM intake_drafts WHERE workspace_id=$1 AND project_id=$2 AND id=$3",
            [subject.workspaceId, subject.projectId, subject.subjectId],
          ),
        ])) as unknown as readonly [unknown, unknown, unknown];
        const [workRows, candidateRows, draftRows] = workItemQueries;
        const row = rows(workRows)[0];
        if (!row) {
          const candidate = rows(candidateRows)[0];
          if (candidate && ["PENDING_CONFIRMATION", "SNOOZED"].includes(String(candidate.state))) {
            const semanticHash = String(candidate.current_source_fingerprint) as `sha256:${string}`;
            const sourceRef = Object.freeze({
              sourceType: "INTAKE_CANDIDATE_REVISION" as const,
              sourceId: String(candidate.id),
              sourceVersion: Number(candidate.row_version),
              semanticHash,
              observedAt: new Date(String(candidate.updated_at)).toISOString(),
            });
            return Object.freeze({
              subject: Object.freeze({
                kind: "CANDIDATE" as const,
                id: String(candidate.id),
                version: Number(candidate.row_version),
                semanticHash,
                candidateState:
                  candidate.state === "SNOOZED" ? ("SNOOZED" as const) : ("PENDING" as const),
              }),
              sourceRefs: Object.freeze([sourceRef]),
            });
          }
          const draft = rows(draftRows)[0];
          if (
            draft &&
            !draft.linked_work_item_id &&
            !["CANCELLED", "LINKED"].includes(String(draft.conversation_state))
          ) {
            const semanticHash = String(draft.current_content_hash) as `sha256:${string}`;
            const sourceRef = Object.freeze({
              sourceType: "INTAKE_DRAFT_REVISION" as const,
              sourceId: String(draft.current_revision_id),
              sourceVersion: Number(draft.current_revision),
              semanticHash,
              observedAt: new Date(String(draft.updated_at ?? draft.created_at)).toISOString(),
            });
            return Object.freeze({
              subject: Object.freeze({
                kind: "DRAFT" as const,
                id: String(draft.id),
                version: Number(draft.current_revision),
                semanticHash,
                linkedToConfirmedWorkItem: false,
              }),
              sourceRefs: Object.freeze([sourceRef]),
            });
          }
          return undefined;
        }
        const semanticHash = digest({
          id: row.id,
          rowVersion: Number(row.row_version),
          classificationKey: row.classification_key,
          workTypeKey: row.work_type_key,
          workTypeVersion: row.definition_version,
          definitionHash: row.definition_hash,
        });
        const sourceRef = Object.freeze({
          sourceType: "WORK_ITEM_REVISION" as const,
          sourceId: String(row.id),
          sourceVersion: Number(row.row_version),
          semanticHash,
          observedAt: new Date(String(row.created_at)).toISOString(),
        });
        return Object.freeze({
          subject: Object.freeze({
            kind: "WORK_ITEM" as const,
            id: String(row.id),
            version: Number(row.row_version),
            semanticHash,
          }),
          sourceRefs: Object.freeze([sourceRef]),
        });
      },
    },
    operational: {
      async current(subject) {
        const isWorkItem =
          rows(
            await source.query(
              "SELECT id FROM work_items WHERE workspace_id=$1 AND project_id=$2 AND id=$3",
              [subject.workspaceId, subject.projectId, subject.subjectId],
            ),
          ).length === 1;
        if (!isWorkItem)
          return Object.freeze({ state: "NOT_APPLICABLE" as const, sourceRefs: Object.freeze([]) });
        const current = await authority.confirmedProjectionForWorkItem(
          input(subject),
          subject.subjectId,
        );
        if (!current)
          return Object.freeze({
            state: "UNKNOWN" as const,
            reasonCode: "NO_CONFIRMED_PROJECTION",
            freshness: "UNKNOWN",
            sourceRefs: Object.freeze([]),
          });
        const projectionRef = Object.freeze({
          sourceType: "JIRA_OPERATIONAL_PROJECTION_REVISION" as const,
          sourceId: current.projectionId,
          sourceVersion: current.revision,
          semanticHash: current.authorityFieldsHash,
          observedAt: current.observedAt,
          confirmedAt: current.confirmedAt,
        });
        return Object.freeze({
          state: "KNOWN" as const,
          projectionRef,
          externalDisplayKey: current.snapshot.externalDisplayKey,
          rawStatus: current.snapshot.rawStatus,
          normalizedStatus: current.snapshot.normalizedStatus,
          displayStatus: current.snapshot.rawStatus.name,
          priority: current.snapshot.priority
            ? Object.freeze({ state: "UNKNOWN", reasonCode: "UNMAPPED" })
            : Object.freeze({ state: "UNKNOWN", reasonCode: "NOT_SET" }),
          dueDate: current.snapshot.dueDate
            ? Object.freeze({ state: "KNOWN", value: current.snapshot.dueDate })
            : Object.freeze({ state: "UNKNOWN", reasonCode: "NOT_SET" }),
          assignee: current.snapshot.assignee
            ? Object.freeze({ state: "KNOWN", ...current.snapshot.assignee })
            : Object.freeze({ state: "UNASSIGNED" }),
          freshness: current.freshness,
          sourceRefs: Object.freeze([projectionRef]),
        });
      },
    },
    qa: {
      async current(subject) {
        const isWorkItem =
          rows(
            await source.query(
              "SELECT id FROM work_items WHERE workspace_id=$1 AND project_id=$2 AND id=$3",
              [subject.workspaceId, subject.projectId, subject.subjectId],
            ),
          ).length === 1;
        if (!isWorkItem)
          return Object.freeze({ state: "NOT_APPLICABLE" as const, sourceRefs: Object.freeze([]) });
        const record = await repositories.qaFacts.current(input(subject), subject.subjectId);
        if (!record)
          return Object.freeze({
            state: "UNKNOWN" as const,
            reasonCode: "NOT_PROJECTED",
            sourceRefs: Object.freeze([]),
          });
        const facts = record.facts as QaQueueFacts;
        const factsRef = Object.freeze({
          sourceType: "QA_QUEUE_FACT_REVISION" as const,
          sourceId: record.revisionId,
          sourceVersion: record.revisionNumber,
          semanticHash: record.semanticHash as `sha256:${string}`,
        });
        return Object.freeze({
          state: "KNOWN" as const,
          factsRef,
          readiness: facts.readiness,
          requiredCapabilities: Object.freeze(
            facts.requiredCapabilities.map(({ capability }) => capability),
          ),
          activities: Object.freeze(facts.activities.map(qaActivity)),
          sourceRefs: Object.freeze([factsRef]),
        });
      },
    },
    planning: {
      async current(subject): Promise<LocalQueuePlanningFacts | undefined> {
        const planningQueries = (await Promise.all([
          source.query(
            `SELECT revision.safe_body FROM project_queue_policy_facet_heads head
             JOIN project_queue_policy_facet_revisions revision ON revision.policy_facet_revision_id=head.current_revision_id
             WHERE head.workspace_id=$1 AND head.project_id=$2 ORDER BY head.updated_at DESC LIMIT 1`,
            [subject.workspaceId, subject.projectId],
          ),
          source.query(
            "SELECT id,created_at FROM work_items WHERE workspace_id=$1 AND project_id=$2 AND id=$3",
            [subject.workspaceId, subject.projectId, subject.subjectId],
          ),
          source.query(
            "SELECT id,created_at FROM intake_candidates WHERE workspace_id=$1 AND project_id=$2 AND id=$3",
            [subject.workspaceId, subject.projectId, subject.subjectId],
          ),
          source.query(
            "SELECT id,created_at FROM intake_drafts WHERE workspace_id=$1 AND project_id=$2 AND id=$3",
            [subject.workspaceId, subject.projectId, subject.subjectId],
          ),
        ])) as unknown as readonly [unknown, unknown, unknown, unknown];
        const [policyRows, workRows, candidateRows, draftRows] = planningQueries;
        const policyRow = rows(policyRows)[0];
        if (!policyRow) return undefined;
        const policy = json<ProjectQueuePolicyFacet>(policyRow.safe_body);
        const sourceRefs: QueueExactSourceRef[] = [policy.statusMappingRef as QueueExactSourceRef];
        const slaStartConfiguration = Object.freeze({
          calendarRef: policy.calendarRef,
          mappingRef: Object.freeze({
            ...policy.statusMappingRef,
            sourceVersion: Number(policy.statusMappingRef.sourceVersion),
          }),
          algorithmRef: Object.freeze({
            key: "sla-business-time",
            version: "1.0.0",
            semanticHash: digest({ key: "sla-business-time", version: "1.0.0" }),
          }),
          goals: Object.freeze(
            policy.slaGoals.map((goal) =>
              Object.freeze({
                goal: goal.goal,
                targetBusinessSeconds: goal.targetBusinessSeconds,
                warningThresholds: goal.warningThresholds,
              }),
            ),
          ),
        });
        const work = rows(workRows)[0];
        if (!work) {
          const candidate = rows(candidateRows)[0];
          const draft = rows(draftRows)[0];
          const subjectKind = candidate ? ("CANDIDATE" as const) : ("DRAFT" as const);
          const enteredInboxAt = new Date(String((candidate ?? draft)?.created_at)).toISOString();
          const components = Object.freeze({
            enteredInboxAt,
            subjectKind,
            subjectId: subject.subjectId,
          });
          return Object.freeze({
            policyFacetRef: policy.policyFacetRef,
            derivationRuleRef: policy.stageRuleRef,
            control: Object.freeze({ state: "NOT_APPLICABLE" }),
            capacity: Object.freeze({ state: "NOT_CONSUMING" }),
            sla: Object.freeze({ state: "NOT_APPLICABLE" }),
            ordering: Object.freeze({
              state: "CANDIDATE_INBOX",
              comparatorRef: policy.comparatorRef,
              components,
              baseRankKey: digest(components),
            }),
            sourceRefs: Object.freeze(sourceRefs),
            slaStartConfiguration,
          });
        }
        const stateQueries = (await Promise.all([
          repositories.control.currentControl(
            { kind: "PROJECT", workspaceId: subject.workspaceId, projectId: subject.projectId },
            subject.subjectId,
          ),
          source.query(
            `SELECT * FROM (
            SELECT * FROM work_item_human_wip_claims WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3
            ORDER BY revision_number DESC LIMIT 1
          ) current_claim WHERE state='ACTIVE'`,
            [subject.workspaceId, subject.projectId, subject.subjectId],
          ),
          source.query(
            `SELECT * FROM (
            SELECT * FROM review_capacity_reservations WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3
            ORDER BY revision_number DESC LIMIT 1
          ) current_reservation WHERE state IN ('HELD','COVERED_BY_CLAIM')`,
            [subject.workspaceId, subject.projectId, subject.subjectId],
          ),
        ])) as unknown as readonly [Row | undefined, unknown, unknown];
        const [control, claimRows, reservationRows] = stateQueries;
        let controlFacet: Readonly<Record<string, unknown>> = Object.freeze({
          state: "DEFAULT",
          resourceVersion: 0,
          serviceClass: "STANDARD",
        });
        if (control?.control_revision_id) {
          const controlRef = Object.freeze({
            sourceType: "WORK_ITEM_QUEUE_CONTROL_REVISION" as const,
            sourceId: String(control.control_revision_id),
            sourceVersion: Number(control.revision_number),
            semanticHash: String(control.semantic_hash) as `sha256:${string}`,
          });
          sourceRefs.push(controlRef);
          const planningValues = json<Record<string, unknown>>(control.planning_values);
          controlFacet = Object.freeze({
            state: "ACCEPTED",
            resourceVersion: Number(control.resource_version),
            controlRef,
            serviceClass: String(control.service_class ?? "STANDARD"),
            ...planningValues,
            acceptedByPrincipalId: String(control.recorded_by),
            reason: String(control.reason),
            ...(control.expiry_at
              ? { expiresAt: new Date(String(control.expiry_at)).toISOString() }
              : {}),
          });
        }
        const claim = rows(claimRows)[0];
        const reservation = rows(reservationRows)[0];
        let capacity: Readonly<Record<string, unknown>> = Object.freeze({ state: "NOT_CONSUMING" });
        if (claim) {
          const claimRef = Object.freeze({
            sourceType: "HUMAN_WIP_CLAIM_REVISION" as const,
            sourceId: String(claim.claim_id),
            sourceVersion: Number(claim.revision_number),
            semanticHash: String(claim.semantic_hash) as `sha256:${string}`,
          });
          sourceRefs.push(claimRef);
          capacity = Object.freeze({
            state: "OCCUPIED",
            claimRef,
            causeSetHash: digest([claimRef]),
            causes: Object.freeze(["MANUAL_RUNNING"]),
          });
        } else if (reservation) {
          const reservationRef = Object.freeze({
            sourceType: "REVIEW_CAPACITY_RESERVATION_REVISION" as const,
            sourceId: String(reservation.reservation_id),
            sourceVersion: Number(reservation.revision_number),
            semanticHash: String(reservation.semantic_hash) as `sha256:${string}`,
          });
          sourceRefs.push(reservationRef);
          capacity = Object.freeze({
            state: "RESERVED_REVIEW",
            reservationRef,
            reservationCauseSetHash: digest([reservationRef]),
          });
        }
        const serviceClass = String(control?.service_class ?? "STANDARD");
        const orderComponents = Object.freeze({
          serviceClassBand: serviceClass,
          slaState: "NOT_STARTED",
          urgencyTiming: Object.freeze({ state: "NOT_STARTED" }),
          jiraPriority: Object.freeze({ state: "UNKNOWN" }),
          acceptedRisk: "UNKNOWN",
          acceptedBusinessImpact: "UNKNOWN",
          dependencyReadiness: "UNKNOWN",
          readyAge: Object.freeze({ state: "UNKNOWN" }),
          readyAt: Object.freeze({ state: "UNKNOWN" }),
          jiraDisplayKey: Object.freeze({ state: "UNKNOWN" }),
          workItemId: subject.subjectId,
        });
        return Object.freeze({
          policyFacetRef: policy.policyFacetRef,
          derivationRuleRef: policy.stageRuleRef,
          control: controlFacet,
          capacity,
          sla: Object.freeze({ state: "NOT_APPLICABLE" }),
          ordering: Object.freeze({
            state: "COMPUTED",
            comparatorRef: policy.comparatorRef,
            components: orderComponents,
            baseRankKey: digest(orderComponents),
          }),
          sourceRefs: Object.freeze(sourceRefs),
          slaStartConfiguration,
        });
      },
    },
  });
}

class PostgresQueueProjectionCoordinatorPorts implements QueueProjectionCoordinatorPorts {
  readonly #repository: QueueProjectionRepository;
  readonly #orderInvalidation: QueueOrderInvalidationRepository;
  readonly #slaStarter: ConfirmedJiraSlaStartProjector;
  readonly #slaLifecycle: SlaLifecycleProjector;
  constructor(
    private readonly source: DataSource,
    private readonly composer: LocalQueueFactComposer,
    repositories: ReturnType<typeof createQueueFoundationRepositoryProviders>,
  ) {
    this.#repository = new QueueProjectionRepository(source);
    this.#orderInvalidation = repositories.orderInvalidation;
    this.#slaStarter = new ConfirmedJiraSlaStartProjector({
      start: async (value) =>
        await repositories.slaClock.startInitial({
          ...value,
          scope: {
            kind: "PROJECT",
            workspaceId: value.transition.workspaceId,
            projectId: value.transition.projectId,
          },
          afterAppend: async (manager, transition) =>
            await appendProjectionEvent(
              manager,
              slaClockTransitionEventEnvelope({
                transition,
                correlationId: value.correlationId,
                causationId: value.causationId,
              }),
            ),
        }),
    });
    const lifecycleLoader = new PostgresSlaTemporalClockLoader(source);
    const authority = new TypeOrmOperationalAuthorityRepository(source);
    this.#slaLifecycle = new SlaLifecycleProjector({
      load: async (input) => {
        const context = await lifecycleLoader.loadClock({
          kind: "SLA_CLOCK",
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          subjectId: deterministicUuid(
            `sla-clock:${input.workspaceId}:${input.projectId}:${input.workItemId}:${input.goal}`,
          ),
          dueAt: new Date(0).toISOString(),
        });
        if (
          !context ||
          context.transition.workItemId !== input.workItemId ||
          context.transition.goal !== input.goal
        )
          return undefined;
        const queryResults = (await Promise.all([
          authority.confirmedProjectionForWorkItem(
            { workspaceId: input.workspaceId, projectId: input.projectId },
            input.workItemId,
          ),
          source.query(
            `SELECT safe_body FROM project_queue_policy_facet_revisions
              WHERE workspace_id=$1 AND project_id=$2 AND policy_facet_id=$3
                AND revision_number=$4 AND semantic_hash=$5`,
            [
              input.workspaceId,
              input.projectId,
              context.transition.policyFacetRef.id,
              context.transition.policyFacetRef.version,
              context.transition.policyFacetRef.semanticHash,
            ],
          ),
          input.goal === "READY_TO_FIRST_QA_START"
            ? source.query(
                `SELECT session_id,resource_version,content,started_at FROM qa_test_sessions
              WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3 AND started_at IS NOT NULL
              ORDER BY started_at,ordinal,session_id LIMIT 1`,
                [input.workspaceId, input.projectId, input.workItemId],
              )
            : Promise.resolve([]),
          input.goal === "READY_TO_SIGNED_VERDICT"
            ? source.query(
                `SELECT verdict_id,version,content_hash,signed_at FROM qa_verdicts
              WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3 AND state='SIGNED'
              ORDER BY signed_at,version,verdict_id LIMIT 1`,
                [input.workspaceId, input.projectId, input.workItemId],
              )
            : Promise.resolve([]),
        ])) as unknown as readonly [
          Awaited<ReturnType<typeof authority.confirmedProjectionForWorkItem>>,
          unknown,
          unknown,
          unknown,
        ];
        const [operational, policyRows, sessionRows, verdictRows] = queryResults;
        const policyRow = rows(policyRows)[0];
        if (!policyRow) throw new Error("SLA_LIFECYCLE_POLICY_PIN_NOT_FOUND");
        const policy = json<ProjectQueuePolicyFacet>(policyRow.safe_body);
        const blockReason = operational?.snapshot.blockReason?.normalizedReasonCode;
        const rule = policy.blockReasonRules.find(
          (candidate) =>
            candidate.normalizedStatus === operational?.snapshot.normalizedStatus &&
            candidate.reasonCode === blockReason,
        );
        const operationalEffect =
          context.transition.currentClockState === "PAUSED"
            ? rule?.slaEffect === "PAUSE"
              ? ("CONTINUE" as const)
              : ("RESUME" as const)
            : (rule?.slaEffect ?? ("CONTINUE" as const));
        const operationalRef: ConfirmedJiraProjectionRef | undefined = operational
          ? Object.freeze({
              sourceType: "JIRA_OPERATIONAL_PROJECTION_REVISION",
              sourceId: operational.projectionId,
              sourceVersion: operational.revision,
              semanticHash: operational.authorityFieldsHash,
              observedAt: operational.observedAt,
              confirmedAt: operational.confirmedAt,
            })
          : undefined;
        const session = rows(sessionRows)[0];
        const verdict = rows(verdictRows)[0];
        return Object.freeze({
          ...context,
          ...(operationalRef
            ? {
                operational: Object.freeze({
                  sourceRef: operationalRef,
                  effect: operationalEffect,
                  ...(operationalEffect === "PAUSE" && blockReason
                    ? { mappedPauseReasonCode: blockReason }
                    : {}),
                }),
              }
            : {}),
          ...(session
            ? {
                firstConsumingSession: Object.freeze({
                  sourceRef: Object.freeze({
                    sourceType: "QA_TEST_SESSION_REVISION" as const,
                    sourceId: String(session.session_id),
                    sourceVersion: Number(session.resource_version),
                    semanticHash: digest(json(session.content)),
                  }),
                  effectiveAt: new Date(String(session.started_at)).toISOString(),
                }),
              }
            : {}),
          ...(verdict
            ? {
                signedVerdict: Object.freeze({
                  sourceRef: Object.freeze({
                    sourceType: "QA_VERDICT_REVISION" as const,
                    sourceId: String(verdict.verdict_id),
                    sourceVersion: Number(verdict.version),
                    semanticHash: String(verdict.content_hash) as `sha256:${string}`,
                  }),
                  effectiveAt: new Date(String(verdict.signed_at)).toISOString(),
                }),
              }
            : {}),
        }) satisfies SlaLifecycleFacts;
      },
      append: async (value) => {
        const { correlationId, causationId, ...append } = value;
        return await repositories.slaClock.appendTransition({
          ...append,
          scope: {
            kind: "PROJECT",
            workspaceId: value.transition.workspaceId,
            projectId: value.transition.projectId,
          },
          afterAppend: async (manager, transition) =>
            await appendProjectionEvent(
              manager,
              slaClockTransitionEventEnvelope({
                transition,
                correlationId,
                causationId,
              }),
            ),
        });
      },
    });
  }

  async applySlaLifecycle(
    input: Readonly<{
      entityId: string;
      scope: Readonly<{ workspaceId: string; projectId: string }>;
    }>,
  ): Promise<void> {
    await this.#slaLifecycle.project({ ...input.scope, workItemId: input.entityId });
  }

  async readCurrent(
    input: Readonly<{ workspaceId: string; projectId: string; subjectId: string }>,
  ): Promise<QueueProjectionSourceSnapshot> {
    return await this.composer.readCurrent(input);
  }

  async appendIfChanged(
    input: Parameters<QueueProjectionCoordinatorPorts["appendIfChanged"]>[0],
  ): Promise<Readonly<{ changed: boolean; revisionNumber: number }>> {
    const scope = {
      kind: "PROJECT" as const,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
    };
    const subject = input.snapshot.subject as Readonly<{
      kind: "CANDIDATE" | "DRAFT" | "WORK_ITEM";
      id: string;
    }>;
    const head = await this.#repository.ensureHead({
      scope,
      queueEntryId: input.subjectId,
      subject:
        subject.kind === "CANDIDATE"
          ? { kind: "CANDIDATE", candidateId: subject.id }
          : subject.kind === "DRAFT"
            ? { kind: "DRAFT", draftId: subject.id }
            : { kind: "WORK_ITEM", workItemId: subject.id },
      createdAt: String(input.snapshot.calculatedAt),
    });
    const activeCurrent = await this.#repository.currentRevision(scope, input.subjectId);
    const shadowCurrent =
      input.generationId === "ACTIVE"
        ? undefined
        : rows(
            await this.source.query(
              "SELECT * FROM queue_entry_revisions WHERE workspace_id=$1 AND project_id=$2 AND queue_entry_id=$3 AND generation_id=$4 ORDER BY revision_number DESC LIMIT 1",
              [input.workspaceId, input.projectId, input.subjectId, input.generationId],
            ),
          )[0];
    const current = shadowCurrent ?? activeCurrent;
    if (
      (input.generationId === "ACTIVE" || shadowCurrent !== undefined) &&
      String(current?.input_fingerprint ?? "") === input.inputFingerprint
    ) {
      return Object.freeze({
        changed: false,
        revisionNumber: Number(current?.revision_number ?? 0),
      });
    }
    const generationId =
      input.generationId === "ACTIVE"
        ? await this.activeGeneration(input.workspaceId, String(input.snapshot.calculatedAt))
        : input.generationId;
    const sequence = rows(
      await this.source.query(
        "SELECT COALESCE(max(revision_number),0) AS revision_number FROM queue_entry_revisions WHERE workspace_id=$1 AND project_id=$2 AND queue_entry_id=$3",
        [input.workspaceId, input.projectId, input.subjectId],
      ),
    )[0];
    const revisionNumber = Number(sequence?.revision_number ?? 0) + 1;
    const snapshot = Object.fromEntries(
      Object.entries(input.snapshot).filter(
        ([key]) => !["subjectId", "precursorId", "slaStartConfiguration"].includes(key),
      ),
    );
    const semanticBody: Readonly<Record<string, unknown>> = Object.freeze({
      ...snapshot,
      revision: revisionNumber,
      inputFingerprint: input.inputFingerprint,
      ...(["CORRECTION", "REBUILD"].includes(input.cause.kind)
        ? { reconciledAt: snapshot.calculatedAt }
        : {}),
    });
    const semanticProjection = Object.fromEntries(
      Object.entries(semanticBody).filter(
        ([key]) => !["revision", "calculatedAt", "reconciledAt"].includes(key),
      ),
    );
    const semanticHash = digest(semanticProjection);
    const document: Readonly<Record<string, unknown>> = Object.freeze({
      ...semanticBody,
      semanticHash,
    });
    validateQueueEntryProjection(document);
    const revisionId = deterministicUuid(
      `queue-entry-revision:${input.workspaceId}:${input.projectId}:${input.subjectId}:${revisionNumber}:${semanticHash}`,
    );
    const result = await this.#repository.appendRevision({
      scope,
      queueEntryId: input.subjectId,
      revisionId,
      generationId,
      expectedResourceVersion: head.resourceVersion,
      ...(current?.queue_entry_revision_id
        ? { previousRevisionId: String(current.queue_entry_revision_id) }
        : {}),
      semanticHash,
      document,
      activateCurrent: input.generationId === "ACTIVE",
      afterAppend: async (manager, appended) => {
        if (input.cause.kind === "REBUILD") return;
        const controlTransition = input.cause.kind === "CONTROL_TRANSITION";
        const stageChanged =
          appended.previous !== undefined && appended.previous.stage !== appended.stage;
        const correlationId = deterministicUuid(
          `queue-projection-correlation:${input.workspaceId}:${input.projectId}:${input.subjectId}:${revisionNumber}`,
        );
        const causationId = deterministicUuid(
          `queue-projection-causation:${input.workspaceId}:${input.projectId}:${input.subjectId}:${input.inputFingerprint}`,
        );
        const occurredAt = String(document.calculatedAt);
        for (const eventType of queueProjectionEventTypes({ controlTransition, stageChanged })) {
          if (eventType === "queue.stage.changed" && appended.previous) {
            const transitionId = deterministicUuid(
              `queue-stage-transition:${appended.previous.revisionId}:${appended.revisionId}`,
            );
            const payload = createQueueStageTransition({
              transitionId,
              workspaceId: input.workspaceId,
              projectId: input.projectId,
              previousQueueEntryRef: {
                schemaVersion: "queue-entry@1.0.0",
                queueEntryId: input.subjectId,
                revision: appended.previous.revisionNumber,
                semanticHash: appended.previous.semanticHash as `sha256:${string}`,
              },
              currentQueueEntryRef: {
                schemaVersion: "queue-entry@1.0.0",
                queueEntryId: input.subjectId,
                revision: appended.revisionNumber,
                semanticHash: appended.semanticHash as `sha256:${string}`,
              },
              previousStage: appended.previous.stage as Parameters<
                typeof createQueueStageTransition
              >[0]["previousStage"],
              currentStage: appended.stage as Parameters<
                typeof createQueueStageTransition
              >[0]["currentStage"],
              reasonCodes: document.stageReasonCodes as readonly string[],
              occurredAt,
            });
            await appendProjectionEvent(
              manager,
              projectionEnvelope({
                eventId: deterministicUuid(`queue-stage-event:${transitionId}`),
                eventType,
                workspaceId: input.workspaceId,
                projectId: input.projectId,
                entityType: "queue-stage-transition",
                entityId: transitionId,
                entityVersion: 1,
                occurredAt,
                payloadSchemaId: "urn:awp:schemas:006:queue-stage-transition:v1",
                payload,
                correlationId,
                causationId,
              }),
            );
          } else if (eventType !== "queue.stage.changed") {
            await appendProjectionEvent(
              manager,
              projectionEnvelope({
                eventId: deterministicUuid(`${eventType}:${revisionId}:${semanticHash}`),
                eventType,
                workspaceId: input.workspaceId,
                projectId: input.projectId,
                entityType: "queue-entry",
                entityId: input.subjectId,
                entityVersion: appended.revisionNumber,
                occurredAt,
                payloadSchemaId: "urn:awp:schemas:006:queue-entry:v1",
                payload: document,
                correlationId,
                causationId,
              }),
            );
          }
        }
        if (subject.kind === "WORK_ITEM") {
          await this.#orderInvalidation.appendProjectInvalidation(
            {
              scope,
              workItemId: subject.id,
              reasonCode: "BASE_VISIBLE_SET_CHANGED",
              sourceRef: Object.freeze({
                sourceType: "QUEUE_ENTRY_REVISION",
                sourceId: appended.revisionId,
                sourceVersion: appended.revisionNumber,
                semanticHash: appended.semanticHash,
              }),
              occurredAt,
            },
            manager,
          );
        }
      },
    });
    if (input.cause.kind !== "REBUILD") await this.#slaStarter.project(input.snapshot);
    return Object.freeze({
      changed: result.outcome === "APPENDED",
      revisionNumber: result.revision,
    });
  }

  async suppressPrecursor(
    input: Readonly<{
      workspaceId: string;
      projectId: string;
      precursorId: string;
      workItemId: string;
    }>,
  ): Promise<void> {
    const result = rows(
      await this.source.query(
        "SELECT queue_entry_id,resource_version FROM queue_entry_heads WHERE workspace_id=$1 AND project_id=$2 AND queue_entry_id=$3 AND suppressed_by_work_item_id IS NULL",
        [input.workspaceId, input.projectId, input.precursorId],
      ),
    );
    if (!result[0]) return;
    await this.#repository.suppressPrecursor({
      scope: { kind: "PROJECT", workspaceId: input.workspaceId, projectId: input.projectId },
      precursorQueueEntryId: input.precursorId,
      workItemQueueEntryId: input.workItemId,
      workItemId: input.workItemId,
      expectedPrecursorVersion: Number(result[0].resource_version),
    });
  }

  private async activeGeneration(workspaceId: string, at: string): Promise<string> {
    const current = rows(
      await this.source.query(
        "SELECT generation_id FROM queue_projection_generations WHERE workspace_id=$1 AND state='ACTIVE'",
        [workspaceId],
      ),
    )[0];
    if (current) return String(current.generation_id);
    const generationId = deterministicUuid(`queue-projection-generation:${workspaceId}:initial`);
    await this.source.query(
      `INSERT INTO queue_projection_generations(generation_id,workspace_id,state,source_high_watermarks,input_set_hash,output_set_hash,subject_count,stage_counts,started_at,validated_at,activated_at)
       VALUES($1,$2,'ACTIVE','{}'::jsonb,$3,$3,0,'{}'::jsonb,$4,$4,$4) ON CONFLICT(generation_id) DO NOTHING`,
      [generationId, workspaceId, digest([]), at],
    );
    return generationId;
  }
}

export function createPostgresQueueProjectionCoordinator(
  source: DataSource,
  repositories = createQueueFoundationRepositoryProviders(source),
): QueueProjectionCoordinator {
  return new QueueProjectionCoordinator(
    new PostgresQueueProjectionCoordinatorPorts(
      source,
      createPostgresLocalQueueFactComposer(source, repositories),
      repositories,
    ),
  );
}

export const queueFoundationOperationModuleShell = Object.freeze({
  key: "queue.foundation",
  apiOperations: Object.freeze([
    "queue.portfolio.read",
    "queue.project-lane.read",
    "queue.policy.read",
  ]),
  workerOperations: Object.freeze(["queue.project", "queue.temporal.evaluate", "queue.rebuild"]),
});

const idleQueueWorkerStep = Object.freeze({ run: async () => undefined });

export function createQueueFoundationWorkerContribution(
  runtime: Readonly<{
    projection: Readonly<{ run(): Promise<unknown> }>;
    temporal: Readonly<{
      run(batchSize?: number, trigger?: "STARTUP" | "PERIODIC"): Promise<unknown>;
    }>;
  }>,
) {
  let firstSweep = true;
  return Object.freeze({
    key: "queue.foundation",
    recovery: runtime.projection,
    dispatcher: Object.freeze({
      run: async () => {
        const trigger = firstSweep ? ("STARTUP" as const) : ("PERIODIC" as const);
        firstSweep = false;
        return await runtime.temporal.run(100, trigger);
      },
    }),
    commands: idleQueueWorkerStep,
  });
}

export const qaJiraGitLabMattermostQueueLocalMigrationRegistry =
  qaJiraGitLabMattermostLocalComposition.migrationRegistry;
export const qaJiraGitLabMattermostQueueLocalComposition = Object.freeze({
  ...qaJiraGitLabMattermostLocalComposition,
  key: "qa-jira-gitlab-mattermost-queue-local" as const,
  queue: Object.freeze({
    repositoryProviderTypes: queueFoundationRepositoryProviderTypes,
    operations: queueFoundationOperationModuleShell,
  }),
});
