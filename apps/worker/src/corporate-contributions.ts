import type { DataSource } from "typeorm";

import {
  closeDispatcherOnlyWorkerContribution,
  closeReconciliationWorkerContribution,
  closeWorkerLoopContribution,
  type CorporateConnectorFactories,
  type CorporateConnectorGrant,
  type CorporateConnectorRequestAuthority,
  type CorporateWorkerCommandContext,
  createArtifactRetentionMaintenanceWorker,
  createCapabilityProbeMaintenanceWorker,
  createCorporateGitLabAuthoritativeReadHandler,
  createCorporateGitLabAutomationWorkerAuthority,
  createCorporateGitLabResultAuthority,
  createCorporateGitLabResultWorker,
  createCorporateGitLabTerminalCandidateScanner,
  createCorporateJiraAuthoritativeReadHandler,
  createCorporateJiraAuthoritativeReadWorker,
  createCorporateJiraBoundRefreshScheduler,
  createCorporateJiraCreateObservationAuthority,
  createCorporateMattermostTemplateAuthority,
  createCorporateMattermostWorkerSteps,
  createCorporateOnboardingEventWorker,
  createCorporateProbeAuthorization,
  createCorporateProbeObserver,
  createCorporateProjectRecoveryWorker,
  createCorporateQaConfirmationNotificationAuthority,
  createCorporateQaNotificationProducer,
  createFeature005AutomationEventWorkerStep,
  createGitLabAutomationWorkerSteps,
  createGitLabReconciliationWorkerSteps,
  createQaJiraCorporateWorkerSteps,
  createQueueFoundationWorkerContribution,
  createQueueFoundationWorkerRuntime,
  createRequestedCapabilityProbeWorker,
  createTypeOrmGitLabAutomationResultSyncConsumer,
  createWorkerRetryAdmission,
  type Feature005AutomationEventPublisher,
  feature005AutomationEventTypes,
  pilotNonLocalWorkerKeys,
  type RuntimeEnvironment,
} from "@awp/runtime-composition";

import type { NamedWorkerLoopContribution } from "./app.module.ts";

/** Every external authority is supplied explicitly; local adapters cannot be selected here. */
export interface CorporateWorkerPorts {
  readonly gitlabEventPublisher?: Feature005AutomationEventPublisher;
}

/** Keep events durable until a real publisher is configured; this step never acknowledges them. */
export function createDeferredGitLabEventsStep(
  source: DataSource,
  scope: Readonly<{ workspaceId: string; projectIds: readonly string[] }>,
) {
  return {
    async run() {
      const rows = (await source.query(
        `SELECT count(*)::integer AS pending FROM event_outbox
         WHERE state='READY' AND event_type=ANY($1::text[])
           AND workspace_id=$2 AND project_id=ANY($3::uuid[])`,
        [[...feature005AutomationEventTypes], scope.workspaceId, [...scope.projectIds]],
      )) as readonly { pending: string | number }[];
      return { deferred: Number(rows[0]?.pending ?? 0) };
    },
  };
}

export function createCorporateWorkerContributions(
  input: Readonly<{
    source: DataSource;
    environment: RuntimeEnvironment;
    grants: readonly CorporateConnectorGrant[];
    factories: CorporateConnectorFactories;
    commands: CorporateWorkerCommandContext;
    connectorAuthority: CorporateConnectorRequestAuthority;
    fences: Parameters<typeof createWorkerRetryAdmission>[1];
    effectGuard: Parameters<typeof createWorkerRetryAdmission>[2];
    allowValidatedIncomplete?: boolean;
    ports?: CorporateWorkerPorts;
  }>,
): readonly NamedWorkerLoopContribution[] {
  const deployment = input.environment.deployment;
  if (
    !input.source.isInitialized ||
    input.environment.profile !== "non-local" ||
    input.environment.environmentScope !== "NON_PROD" ||
    !deployment ||
    !deployment.workspaceId ||
    !deployment.projectIds?.length ||
    typeof input.commands?.guard?.assertCommandAllowed !== "function" ||
    typeof input.connectorAuthority?.authorize !== "function" ||
    typeof input.fences?.current !== "function" ||
    typeof input.effectGuard?.assertEffectsAllowed !== "function" ||
    (input.ports?.gitlabEventPublisher !== undefined &&
      typeof input.ports.gitlabEventPublisher.publish !== "function")
  )
    throw new Error("CORPORATE_WORKER_PORTS_REQUIRED");
  const jira = createQaJiraCorporateWorkerSteps({
    ...input,
    createObservation: createCorporateJiraCreateObservationAuthority(input),
  });
  const jiraRead = createCorporateJiraAuthoritativeReadWorker({
    ...input,
    handler: createCorporateJiraAuthoritativeReadHandler(input),
  });
  const jiraRefresh = createCorporateJiraBoundRefreshScheduler(input);
  const probeOptions = {
    authorize: createCorporateProbeAuthorization({
      environment: input.environment,
      grants: input.grants,
      authority: input.connectorAuthority,
    }),
    observe: createCorporateProbeObserver(input),
    deadlineMs: 5_000,
    validForMs: 120_000,
    deploymentScope: deployment,
  };
  const requestedProbes = createRequestedCapabilityProbeWorker(input.source, probeOptions);
  const maintenanceProbes = createCapabilityProbeMaintenanceWorker(input.source, {
    ...probeOptions,
    refreshAfterMs: 60_000,
  });
  const gitlab = createGitLabAutomationWorkerSteps(
    input.source,
    createCorporateGitLabAutomationWorkerAuthority(input),
    undefined,
    input.commands.guard,
    true,
    { workspaceId: deployment.workspaceId, projectIds: deployment.projectIds },
  );
  const reconciliation = createGitLabReconciliationWorkerSteps(
    input.source,
    createCorporateGitLabAuthoritativeReadHandler(input),
    undefined,
    deployment,
  );
  const gitlabResults = createCorporateGitLabResultWorker({
    environment: input.environment,
    deadlineMs: 60_000,
    scanner: createCorporateGitLabTerminalCandidateScanner(input.source, input.environment),
    authority: createCorporateGitLabResultAuthority({ ...input, guard: input.commands.guard }),
    consumer: createTypeOrmGitLabAutomationResultSyncConsumer(
      input.source,
      undefined,
      createWorkerRetryAdmission(input.source, input.fences, input.effectGuard),
    ),
  });
  const mattermost = createCorporateMattermostWorkerSteps({
    ...input,
    authority: createCorporateQaConfirmationNotificationAuthority(input.source, input.environment),
    templates: createCorporateMattermostTemplateAuthority(input.source),
  });
  const producer = createCorporateQaNotificationProducer({ ...input, guard: input.commands.guard });
  const result = Object.freeze([
    closeWorkerLoopContribution("qa-jira", {
      recovery: {
        run: async () => ({
          commands: await jira.recovery.run(),
          reads: await jiraRead.recover(),
          scheduled: await jiraRefresh.run(),
        }),
      },
      dispatcher: jira.dispatcher,
      commands: {
        run: async () => ({ reads: await jiraRead.run(), commands: await jira.commands.run() }),
      },
    }),
    closeWorkerLoopContribution("mattermost", {
      recovery: mattermost.recovery,
      dispatcher: {
        run: async () => {
          try {
            await producer.run();
          } catch {
            console.error("CORPORATE_NOTIFICATION_PROJECTION_DEFERRED");
          }
          return await mattermost.dispatcher.run();
        },
      },
      commands: mattermost.commands,
    }),
    createQueueFoundationWorkerContribution(
      createQueueFoundationWorkerRuntime(input.source, deployment),
    ),
    closeDispatcherOnlyWorkerContribution(
      "artifact-retention",
      createArtifactRetentionMaintenanceWorker(input.source, undefined, deployment),
    ),
    closeDispatcherOnlyWorkerContribution(
      "project-onboarding-events",
      createCorporateOnboardingEventWorker(input.source, deployment),
    ),
    closeDispatcherOnlyWorkerContribution("project-onboarding-probes", {
      run: async () => ({
        requests: await requestedProbes.run(),
        maintenance: await maintenanceProbes.run(),
      }),
    }),
    closeDispatcherOnlyWorkerContribution(
      "project-suspension-recovery",
      createCorporateProjectRecoveryWorker(input.source, deployment),
    ),
    closeWorkerLoopContribution("gitlab.automation-trigger", {
      ...gitlab,
      recovery: {
        run: async () => ({
          recovery: await gitlab.recovery.run(),
          results: await gitlabResults.run(),
        }),
      },
    }),
    closeReconciliationWorkerContribution("gitlab.webhook-reconciliation", reconciliation),
    closeDispatcherOnlyWorkerContribution(
      "gitlab.automation-events",
      input.ports?.gitlabEventPublisher
        ? createFeature005AutomationEventWorkerStep(
            input.source,
            input.ports.gitlabEventPublisher,
            deployment,
          )
        : createDeferredGitLabEventsStep(input.source, deployment),
    ),
  ]);
  const keys = new Set(result.map((entry) => entry.key));
  if (
    keys.size !== pilotNonLocalWorkerKeys.length ||
    pilotNonLocalWorkerKeys.some((key) => !keys.has(key)) ||
    result.some(
      (entry) =>
        typeof entry.recovery?.run !== "function" ||
        typeof entry.dispatcher?.run !== "function" ||
        typeof entry.commands?.run !== "function",
    )
  )
    throw new Error("CORPORATE_WORKER_PORTS_REQUIRED");
  return result;
}
