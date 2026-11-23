import {
  type DynamicModule,
  Inject,
  Injectable,
  Module,
  type OnApplicationShutdown,
  type OnModuleInit,
} from "@nestjs/common";
import type { DataSource } from "typeorm";

import type { ProjectEventEnvelope } from "@awp/platform-core";
import { StructuredLogger } from "@awp/platform-runtime-nest";
import {
  closeDispatcherOnlyWorkerContribution,
  closeReconciliationWorkerContribution,
  closeWorkerLoopContribution,
  createArtifactRetentionMaintenanceWorker,
  createCapabilityProbeMaintenanceWorker,
  createDevelopmentCapabilityProbeWorker,
  createFeature005AutomationEventWorkerStep,
  createGitLabAutomationWorkerSteps,
  createGitLabReconciliationWorkerSteps,
  createLocalGitLabAuthoritativeReadHandler,
  createLocalGitLabAutomationWorkerAuthority,
  createMattermostWorkerSteps,
  createQaJiraLocalWorkerSteps,
  createQaLocalOperationalBrokerMap,
  createQueueFoundationWorkerContribution,
  createQueueFoundationWorkerRuntime,
  createRequestedCapabilityProbeWorker,
  createRuntimeDataSource,
  Feature005InProcessEventPublisher,
  type GitLabAutomationWorkerSteps,
  type GitLabReconciliationWorkerSteps,
  isGitLabLocalComposition,
  isMattermostLocalComposition,
  isQaJiraLocalComposition,
  isQueueLocalComposition,
  loadEnvironment,
  type MattermostWorkerSteps,
  onboardingLocalComposition,
  ProjectOnboardingEventWorker,
  ProjectSuspensionRecoveryWorker,
  type QaJiraLocalWorkerSteps,
  type QaUs1OperationalBrokerMap,
  selectRuntimeComposition,
} from "@awp/runtime-composition";

import { HealthController } from "./health.controller.ts";
import { LocalWorkerHealthController } from "./local-health.controller.ts";
import { WORKER_DATA_SOURCE } from "./worker.tokens.ts";

export interface WorkerLoopStep {
  run(): Promise<unknown>;
}
export interface NamedWorkerLoopContribution {
  readonly key: string;
  readonly recovery: WorkerLoopStep;
  readonly dispatcher: WorkerLoopStep;
  readonly commands: WorkerLoopStep;
}
export const WORKER_CONTRIBUTIONS = Symbol("WORKER_CONTRIBUTIONS");
export const QA_OPERATIONAL_BROKER_MAP = Symbol("QA_OPERATIONAL_BROKER_MAP");
const QA_JIRA_LOCAL_WORKER_STEPS = Symbol("QA_JIRA_LOCAL_WORKER_STEPS");
const MATTERMOST_WORKER_STEPS = Symbol("MATTERMOST_WORKER_STEPS");
const GITLAB_AUTOMATION_WORKER_STEPS = Symbol("GITLAB_AUTOMATION_WORKER_STEPS");
const GITLAB_RECONCILIATION_WORKER_STEPS = Symbol("GITLAB_RECONCILIATION_WORKER_STEPS");
const FEATURE_005_EVENT_WORKER_STEP = Symbol("FEATURE_005_EVENT_WORKER_STEP");
const FEATURE_005_EVENT_PUBLISHER = Symbol("FEATURE_005_EVENT_PUBLISHER");
const QUEUE_FOUNDATION_WORKER_RUNTIME = Symbol("QUEUE_FOUNDATION_WORKER_RUNTIME");
const ONBOARDING_EVENT_WORKER_STEP = Symbol("ONBOARDING_EVENT_WORKER_STEP");
const ONBOARDING_PROBE_WORKER_STEP = Symbol("ONBOARDING_PROBE_WORKER_STEP");
const ARTIFACT_RETENTION_WORKER_STEP = Symbol("ARTIFACT_RETENTION_WORKER_STEP");
const PROJECT_SUSPENSION_RECOVERY_WORKER_STEP = Symbol("PROJECT_SUSPENSION_RECOVERY_WORKER_STEP");
type QueueFoundationWorkerRuntime = ReturnType<typeof createQueueFoundationWorkerRuntime>;

@Injectable()
export class DurableWorkerLoops implements OnModuleInit, OnApplicationShutdown {
  #timer?: ReturnType<typeof setInterval>;
  #current: Promise<void> | undefined;
  #running = false;
  constructor(
    @Inject(WORKER_CONTRIBUTIONS)
    private readonly contributions: readonly NamedWorkerLoopContribution[],
  ) {}
  onModuleInit(): void {
    this.#current = this.tick().finally(() => {
      this.#current = undefined;
    });
    this.#timer = setInterval(() => {
      if (!this.#current)
        this.#current = this.tick().finally(() => {
          this.#current = undefined;
        });
    }, 1_000);
    this.#timer.unref();
  }
  async tick(): Promise<void> {
    if (this.#running) return;
    this.#running = true;
    try {
      for (const [phase, select] of [
        ["recovery", (contribution: NamedWorkerLoopContribution) => contribution.recovery],
        ["dispatcher", (contribution: NamedWorkerLoopContribution) => contribution.dispatcher],
        ["commands", (contribution: NamedWorkerLoopContribution) => contribution.commands],
      ] as const) {
        for (const contribution of this.contributions) {
          try {
            await select(contribution).run();
          } catch {
            new StructuredLogger().write("error", "worker.contribution.deferred", {
              component: contribution.key,
              operation: `worker.${phase}`,
              outcome: "DEFERRED",
              reasonCode: "DEFERRED",
            });
          }
        }
      }
    } finally {
      this.#running = false;
    }
  }
  async onApplicationShutdown(): Promise<void> {
    if (this.#timer) clearInterval(this.#timer);
    await this.#current;
  }
}

@Injectable()
class LocalWorkerShutdown implements OnApplicationShutdown {
  constructor(
    @Inject(WORKER_DATA_SOURCE) private readonly source: DataSource,
    @Inject(DurableWorkerLoops) private readonly loops: DurableWorkerLoops,
  ) {}
  async onApplicationShutdown(): Promise<void> {
    await this.loops.onApplicationShutdown();
    if (this.source.isInitialized) await this.source.destroy();
  }
}

const noop: WorkerLoopStep = { run: async () => undefined };
export const onboardingWorkerComposition = onboardingLocalComposition;
const noopContribution: NamedWorkerLoopContribution = Object.freeze({
  key: "noop",
  recovery: noop,
  dispatcher: noop,
  commands: noop,
});
const loopProviders = [
  { provide: WORKER_CONTRIBUTIONS, useValue: Object.freeze([noopContribution]) },
  DurableWorkerLoops,
] as const;
const feature005EventPublisher = new Feature005InProcessEventPublisher();

function gitLabAutomationSteps(source: DataSource): GitLabAutomationWorkerSteps | undefined {
  const environment = loadEnvironment();
  return isGitLabLocalComposition(environment.composition)
    ? createGitLabAutomationWorkerSteps(
        source,
        createLocalGitLabAutomationWorkerAuthority(source, environment),
        undefined,
        undefined,
        environment.profile === "non-local" || environment.deployment !== undefined,
      )
    : undefined;
}

function feature005EventStep(
  source: DataSource,
  publisher: Feature005InProcessEventPublisher,
): WorkerLoopStep | undefined {
  const environment = loadEnvironment();
  return isGitLabLocalComposition(environment.composition)
    ? createFeature005AutomationEventWorkerStep(source, publisher)
    : undefined;
}

function queueFoundationContribution(
  queue: QueueFoundationWorkerRuntime,
): readonly NamedWorkerLoopContribution[] {
  const environment = loadEnvironment();
  const composition = selectRuntimeComposition(process.env, environment);
  return process.env.AWP_QUEUE_STATIC_CONTOUR === "true" && isQueueLocalComposition(composition)
    ? Object.freeze([createQueueFoundationWorkerContribution(queue)])
    : Object.freeze([]);
}

function gitLabReconciliationSteps(
  source: DataSource,
): GitLabReconciliationWorkerSteps | undefined {
  const environment = loadEnvironment();
  return isGitLabLocalComposition(environment.composition)
    ? createGitLabReconciliationWorkerSteps(
        source,
        createLocalGitLabAuthoritativeReadHandler(source, environment),
      )
    : undefined;
}

function onboardingEventStep(source: DataSource): WorkerLoopStep {
  return new ProjectOnboardingEventWorker(
    {
      ready: async () => {
        const rows = (await source.query(
          "SELECT envelope FROM event_outbox WHERE state='READY' AND event_type IN ('PROJECT_REGISTERED','PROJECT_ENTITLEMENTS_CHANGED','PROJECT_ONBOARDING_CHANGED','PROJECT_BINDING_CHANGED','PROJECT_OPERATIONAL_STATE_CHANGED') ORDER BY created_at,id LIMIT 100",
        )) as readonly Readonly<{ envelope: ProjectEventEnvelope | string }>[];
        return rows.map(({ envelope }) =>
          typeof envelope === "string" ? (JSON.parse(envelope) as ProjectEventEnvelope) : envelope,
        );
      },
      acknowledge: async (eventId) => {
        await source.query(
          "UPDATE event_outbox SET state='ACKNOWLEDGED' WHERE id=$1 AND state='READY'",
          [eventId],
        );
      },
      quarantine: async (event, reason) => {
        await source.query(
          "UPDATE event_outbox SET state='DEAD',envelope=envelope||jsonb_build_object('quarantineReason',$2::text) WHERE id=$1",
          [event.payload.eventId, reason],
        );
      },
    },
    {
      apply: async (event) => {
        await source.query(
          "INSERT INTO consumer_inbox(consumer_key,message_id,message_hash,processed_at) VALUES('project-onboarding-projection',$1,$2,clock_timestamp()) ON CONFLICT(consumer_key,message_id) DO NOTHING",
          [event.payload.eventId, event.payload.contentHash],
        );
      },
    },
  );
}

function onboardingProbeStep(source: DataSource): WorkerLoopStep {
  if (process.env.AWP_PILOT_ADAPTER_MODE === "development")
    return createDevelopmentCapabilityProbeWorker(source, loadEnvironment());
  // Local bootstrap discovers real published work. Missing live bindings are persisted as
  // unavailable; corporate composition must supply its authorized provider probe ports.
  const maintenance = createCapabilityProbeMaintenanceWorker(source, {
    refreshAfterMs: 60_000,
    validForMs: 120_000,
    deadlineMs: 5_000,
  });
  const requested = createRequestedCapabilityProbeWorker(source, {
    deadlineMs: 5_000,
    validForMs: 120_000,
  });
  return {
    async run() {
      const requests = await requested.run();
      return { ...(await maintenance.run()), requests };
    },
  };
}

function artifactRetentionStep(source: DataSource): WorkerLoopStep {
  return createArtifactRetentionMaintenanceWorker(source);
}

function projectSuspensionRecoveryStep(source: DataSource): WorkerLoopStep {
  const count = (value: unknown): number => {
    const raw = value as readonly unknown[];
    const values = (Array.isArray(raw[0]) ? raw[0] : raw) as readonly Readonly<{
      count?: number | string;
    }>[];
    return Number(values[0]?.count ?? values.length);
  };
  return new ProjectSuspensionRecoveryWorker({
    // Candidates and probes are immutable. Expiration is recognized from their
    // authoritative timestamps instead of mutating published history.
    recoverStaleOperationalActions: async () =>
      count(
        await source.query(
          "SELECT count(*)::int AS count FROM project_operational_action_candidates WHERE expires_at<=clock_timestamp()",
        ),
      ),
    expireStaleProbes: async () =>
      count(
        await source.query(
          "SELECT count(*)::int AS count FROM capability_probe_results WHERE valid_until<=clock_timestamp()",
        ),
      ),
    projectsNeedingProjectionRepair: async () => {
      const raw = (await source.query(
        `SELECT h.project_id
           FROM project_onboarding_headers h
           JOIN project_onboarding_revisions r
             ON r.workspace_id=h.workspace_id AND r.project_id=h.project_id
            AND r.onboarding_id=h.onboarding_id AND r.version=h.current_version
          WHERE h.current_stage<>r.onboarding_stage
             OR h.current_capability_mode<>r.qa_capability_mode
             OR h.current_operational_state<>r.project_operational_state
          ORDER BY h.project_id`,
      )) as readonly unknown[];
      const values = (Array.isArray(raw[0]) ? raw[0] : raw) as readonly Readonly<{
        project_id: string;
      }>[];
      return values.map(({ project_id }) => project_id);
    },
    repairProjection: async (projectId) => {
      await source.transaction("SERIALIZABLE", async (manager) => {
        await manager.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          `project-onboarding-recovery:${projectId}`,
        ]);
        await manager.query(
          `UPDATE project_onboarding_headers h
              SET current_stage=r.onboarding_stage,
                  current_capability_mode=r.qa_capability_mode,
                  current_operational_state=r.project_operational_state,
                  intended_capability_mode=r.intended_capability_mode,
                  row_version=h.row_version+1,
                  updated_at=clock_timestamp()
             FROM project_onboarding_revisions r
            WHERE h.project_id=$1 AND r.workspace_id=h.workspace_id AND r.project_id=h.project_id
              AND r.onboarding_id=h.onboarding_id AND r.version=h.current_version`,
          [projectId],
        );
      });
    },
    // Only active Projects are made due again. Every provider worker still runs
    // the shared execution-time guard immediately before invocation.
    reauthorizePendingWork: async () => {
      const updated: unknown = await source.query(
        `UPDATE command_outbox outbox
            SET available_at=LEAST(outbox.available_at,clock_timestamp())
           FROM project_onboarding_headers onboarding
          WHERE outbox.workspace_id=onboarding.workspace_id AND outbox.project_id=onboarding.project_id
            AND outbox.state='READY' AND onboarding.current_operational_state='ACTIVE'
          RETURNING outbox.id`,
      );
      const raw = updated as readonly unknown[];
      return (Array.isArray(raw[0]) ? raw[0] : raw).length;
    },
  });
}

@Module({
  controllers: [LocalWorkerHealthController],
  providers: [
    ...loopProviders,
    {
      provide: WORKER_DATA_SOURCE,
      useFactory: async () => {
        const environment = loadEnvironment();
        const source = createRuntimeDataSource(environment);
        await source.initialize();
        return source;
      },
    },
    LocalWorkerShutdown,
  ],
})
export class LocalWorkerAppModule {}

@Module({
  controllers: [LocalWorkerHealthController],
  providers: [
    ...loopProviders,
    {
      provide: WORKER_DATA_SOURCE,
      useFactory: async () => {
        const environment = loadEnvironment();
        if (selectRuntimeComposition(process.env, environment) !== "qa-local") {
          throw new Error("QA_LOCAL_WORKER_COMPOSITION_REQUIRED");
        }
        const source = createRuntimeDataSource(environment);
        await source.initialize();
        return source;
      },
    },
    {
      provide: QA_OPERATIONAL_BROKER_MAP,
      useFactory: (): QaUs1OperationalBrokerMap =>
        createQaLocalOperationalBrokerMap(loadEnvironment()),
    },
    LocalWorkerShutdown,
  ],
})
export class QaLocalWorkerAppModule {}

@Module({
  controllers: [LocalWorkerHealthController],
  providers: [
    {
      provide: WORKER_DATA_SOURCE,
      useFactory: async () => {
        const environment = loadEnvironment();
        const composition = selectRuntimeComposition(process.env, environment);
        if (!isQaJiraLocalComposition(composition))
          throw new Error("QA_JIRA_LOCAL_WORKER_COMPOSITION_REQUIRED");
        const source = createRuntimeDataSource(environment);
        await source.initialize();
        return source;
      },
    },
    {
      provide: QUEUE_FOUNDATION_WORKER_RUNTIME,
      useFactory: (source: DataSource) => createQueueFoundationWorkerRuntime(source),
      inject: [WORKER_DATA_SOURCE],
    },
    {
      provide: QA_JIRA_LOCAL_WORKER_STEPS,
      useFactory: (source: DataSource): QaJiraLocalWorkerSteps =>
        createQaJiraLocalWorkerSteps(source, loadEnvironment()),
      inject: [WORKER_DATA_SOURCE],
    },
    {
      provide: GITLAB_AUTOMATION_WORKER_STEPS,
      useFactory: (source: DataSource): GitLabAutomationWorkerSteps | undefined =>
        gitLabAutomationSteps(source),
      inject: [WORKER_DATA_SOURCE],
    },
    {
      provide: GITLAB_RECONCILIATION_WORKER_STEPS,
      useFactory: (source: DataSource): GitLabReconciliationWorkerSteps | undefined =>
        gitLabReconciliationSteps(source),
      inject: [WORKER_DATA_SOURCE],
    },
    { provide: FEATURE_005_EVENT_PUBLISHER, useValue: feature005EventPublisher },
    {
      provide: FEATURE_005_EVENT_WORKER_STEP,
      useFactory: (
        source: DataSource,
        publisher: Feature005InProcessEventPublisher,
      ): WorkerLoopStep | undefined => feature005EventStep(source, publisher),
      inject: [WORKER_DATA_SOURCE, FEATURE_005_EVENT_PUBLISHER],
    },
    {
      provide: ONBOARDING_EVENT_WORKER_STEP,
      useFactory: (source: DataSource): WorkerLoopStep => onboardingEventStep(source),
      inject: [WORKER_DATA_SOURCE],
    },
    {
      provide: ONBOARDING_PROBE_WORKER_STEP,
      useFactory: (source: DataSource): WorkerLoopStep => onboardingProbeStep(source),
      inject: [WORKER_DATA_SOURCE],
    },
    {
      provide: ARTIFACT_RETENTION_WORKER_STEP,
      useFactory: (source: DataSource): WorkerLoopStep => artifactRetentionStep(source),
      inject: [WORKER_DATA_SOURCE],
    },
    {
      provide: PROJECT_SUSPENSION_RECOVERY_WORKER_STEP,
      useFactory: (source: DataSource): WorkerLoopStep => projectSuspensionRecoveryStep(source),
      inject: [WORKER_DATA_SOURCE],
    },
    {
      provide: WORKER_CONTRIBUTIONS,
      useFactory: (
        steps: QaJiraLocalWorkerSteps,
        gitlab: GitLabAutomationWorkerSteps | undefined,
        reconciliation: GitLabReconciliationWorkerSteps | undefined,
        events: WorkerLoopStep | undefined,
        queue: QueueFoundationWorkerRuntime,
        onboarding: WorkerLoopStep,
        probes: WorkerLoopStep,
        retention: WorkerLoopStep,
        suspensionRecovery: WorkerLoopStep,
      ): readonly NamedWorkerLoopContribution[] =>
        Object.freeze([
          Object.freeze({
            key: "qa-jira",
            recovery: steps.recovery,
            dispatcher: steps.dispatcher,
            commands: steps.commands,
          }),
          closeDispatcherOnlyWorkerContribution("project-onboarding-events", onboarding),
          closeDispatcherOnlyWorkerContribution("project-onboarding-probes", probes),
          closeDispatcherOnlyWorkerContribution("artifact-retention", retention),
          closeDispatcherOnlyWorkerContribution("project-suspension-recovery", suspensionRecovery),
          ...queueFoundationContribution(queue),
          ...(gitlab ? [closeWorkerLoopContribution("gitlab.automation-trigger", gitlab)] : []),
          ...(reconciliation
            ? [
                closeReconciliationWorkerContribution(
                  "gitlab.webhook-reconciliation",
                  reconciliation,
                ),
              ]
            : []),
          ...(events
            ? [closeDispatcherOnlyWorkerContribution("gitlab.automation-events", events)]
            : []),
        ]),
      inject: [
        QA_JIRA_LOCAL_WORKER_STEPS,
        GITLAB_AUTOMATION_WORKER_STEPS,
        GITLAB_RECONCILIATION_WORKER_STEPS,
        FEATURE_005_EVENT_WORKER_STEP,
        QUEUE_FOUNDATION_WORKER_RUNTIME,
        ONBOARDING_EVENT_WORKER_STEP,
        ONBOARDING_PROBE_WORKER_STEP,
        ARTIFACT_RETENTION_WORKER_STEP,
        PROJECT_SUSPENSION_RECOVERY_WORKER_STEP,
      ],
    },
    DurableWorkerLoops,
    LocalWorkerShutdown,
  ],
})
export class QaJiraLocalWorkerAppModule {}

@Module({ imports: [QaJiraLocalWorkerAppModule] })
export class QaJiraGitLabLocalWorkerAppModule {}

@Module({
  controllers: [LocalWorkerHealthController],
  providers: [
    {
      provide: WORKER_DATA_SOURCE,
      useFactory: async () => {
        const environment = loadEnvironment();
        const composition = selectRuntimeComposition(process.env, environment);
        if (!isMattermostLocalComposition(composition))
          throw new Error("QA_JIRA_MATTERMOST_LOCAL_WORKER_COMPOSITION_REQUIRED");
        const source = createRuntimeDataSource(environment);
        await source.initialize();
        return source;
      },
    },
    {
      provide: QUEUE_FOUNDATION_WORKER_RUNTIME,
      useFactory: (source: DataSource) => createQueueFoundationWorkerRuntime(source),
      inject: [WORKER_DATA_SOURCE],
    },
    {
      provide: QA_JIRA_LOCAL_WORKER_STEPS,
      useFactory: (source: DataSource): QaJiraLocalWorkerSteps =>
        createQaJiraLocalWorkerSteps(source, loadEnvironment()),
      inject: [WORKER_DATA_SOURCE],
    },
    {
      provide: MATTERMOST_WORKER_STEPS,
      useFactory: (source: DataSource): MattermostWorkerSteps =>
        createMattermostWorkerSteps(source, loadEnvironment()),
      inject: [WORKER_DATA_SOURCE],
    },
    {
      provide: GITLAB_AUTOMATION_WORKER_STEPS,
      useFactory: (source: DataSource): GitLabAutomationWorkerSteps | undefined =>
        gitLabAutomationSteps(source),
      inject: [WORKER_DATA_SOURCE],
    },
    {
      provide: GITLAB_RECONCILIATION_WORKER_STEPS,
      useFactory: (source: DataSource): GitLabReconciliationWorkerSteps | undefined =>
        gitLabReconciliationSteps(source),
      inject: [WORKER_DATA_SOURCE],
    },
    { provide: FEATURE_005_EVENT_PUBLISHER, useValue: feature005EventPublisher },
    {
      provide: FEATURE_005_EVENT_WORKER_STEP,
      useFactory: (
        source: DataSource,
        publisher: Feature005InProcessEventPublisher,
      ): WorkerLoopStep | undefined => feature005EventStep(source, publisher),
      inject: [WORKER_DATA_SOURCE, FEATURE_005_EVENT_PUBLISHER],
    },
    {
      provide: ONBOARDING_EVENT_WORKER_STEP,
      useFactory: (source: DataSource): WorkerLoopStep => onboardingEventStep(source),
      inject: [WORKER_DATA_SOURCE],
    },
    {
      provide: ONBOARDING_PROBE_WORKER_STEP,
      useFactory: (source: DataSource): WorkerLoopStep => onboardingProbeStep(source),
      inject: [WORKER_DATA_SOURCE],
    },
    {
      provide: PROJECT_SUSPENSION_RECOVERY_WORKER_STEP,
      useFactory: (source: DataSource): WorkerLoopStep => projectSuspensionRecoveryStep(source),
      inject: [WORKER_DATA_SOURCE],
    },
    {
      provide: WORKER_CONTRIBUTIONS,
      useFactory: (
        jira: QaJiraLocalWorkerSteps,
        mattermost: MattermostWorkerSteps,
        gitlab: GitLabAutomationWorkerSteps | undefined,
        reconciliation: GitLabReconciliationWorkerSteps | undefined,
        events: WorkerLoopStep | undefined,
        queue: QueueFoundationWorkerRuntime,
        onboarding: WorkerLoopStep,
        probes: WorkerLoopStep,
        suspensionRecovery: WorkerLoopStep,
        retention: WorkerLoopStep,
      ): readonly NamedWorkerLoopContribution[] =>
        Object.freeze([
          Object.freeze({
            key: "qa-jira",
            recovery: jira.recovery,
            dispatcher: jira.dispatcher,
            commands: jira.commands,
          }),
          Object.freeze({
            key: "mattermost",
            recovery: mattermost.recovery,
            dispatcher: mattermost.dispatcher,
            commands: mattermost.commands,
          }),
          closeDispatcherOnlyWorkerContribution("artifact-retention", retention),
          closeDispatcherOnlyWorkerContribution("project-onboarding-events", onboarding),
          closeDispatcherOnlyWorkerContribution("project-onboarding-probes", probes),
          closeDispatcherOnlyWorkerContribution("project-suspension-recovery", suspensionRecovery),
          ...queueFoundationContribution(queue),
          ...(gitlab ? [closeWorkerLoopContribution("gitlab.automation-trigger", gitlab)] : []),
          ...(reconciliation
            ? [
                closeReconciliationWorkerContribution(
                  "gitlab.webhook-reconciliation",
                  reconciliation,
                ),
              ]
            : []),
          ...(events
            ? [closeDispatcherOnlyWorkerContribution("gitlab.automation-events", events)]
            : []),
        ]),
      inject: [
        QA_JIRA_LOCAL_WORKER_STEPS,
        MATTERMOST_WORKER_STEPS,
        GITLAB_AUTOMATION_WORKER_STEPS,
        GITLAB_RECONCILIATION_WORKER_STEPS,
        FEATURE_005_EVENT_WORKER_STEP,
        QUEUE_FOUNDATION_WORKER_RUNTIME,
        ONBOARDING_EVENT_WORKER_STEP,
        ONBOARDING_PROBE_WORKER_STEP,
        PROJECT_SUSPENSION_RECOVERY_WORKER_STEP,
        ARTIFACT_RETENTION_WORKER_STEP,
      ],
    },
    {
      provide: ARTIFACT_RETENTION_WORKER_STEP,
      useFactory: (source: DataSource): WorkerLoopStep => artifactRetentionStep(source),
      inject: [WORKER_DATA_SOURCE],
    },
    DurableWorkerLoops,
    LocalWorkerShutdown,
  ],
})
export class QaJiraMattermostLocalWorkerAppModule {}

@Module({ imports: [QaJiraMattermostLocalWorkerAppModule] })
export class QaJiraGitLabMattermostLocalWorkerAppModule {}

@Module({ controllers: [HealthController], providers: [...loopProviders] })
export class CoreWorkerAppModule {}

/** Non-local workers are supplied as an exact, closed contribution set by the corporate factory.
 * Empty phases and a contribution named `noop` are rejected at composition time. */
@Module({})
export class PilotNonLocalWorkerAppModule {
  static register(
    source: DataSource,
    contributions: readonly NamedWorkerLoopContribution[],
    expectedKeys: readonly string[],
  ): DynamicModule {
    const keys = contributions.map((value) => value.key);
    const expected = new Set(expectedKeys);
    if (
      !source.isInitialized ||
      !contributions.length ||
      keys.length !== expected.size ||
      new Set(keys).size !== keys.length ||
      keys.some((key) => key === "noop" || !expected.delete(key)) ||
      expected.size ||
      contributions.some(
        (value) => !value.recovery?.run || !value.dispatcher?.run || !value.commands?.run,
      )
    )
      throw new Error("PILOT_NON_LOCAL_WORKER_BINDINGS_REQUIRED");
    return {
      module: PilotNonLocalWorkerAppModule,
      controllers: [HealthController],
      providers: [
        { provide: WORKER_DATA_SOURCE, useValue: source },
        { provide: WORKER_CONTRIBUTIONS, useValue: Object.freeze([...contributions]) },
        DurableWorkerLoops,
      ],
    };
  }
}
