import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { sha256 } from "@awp/platform-contracts/canonical-hash";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  formatRuUiValue,
  OperationalAuthorityPanel,
  OperationalConflictPanel,
  Stack,
  Tab,
  Tabs,
  Typography,
} from "@awp/platform-ui";

import { QaConfirmedBacklog } from "./confirmed-backlog.tsx";
import { QaEvidenceReview } from "./evidence-review.tsx";
import { QaFindingsDefects, qaUs4UiContribution } from "./findings-defects.tsx";
import { type QaBrowserApiContext, QaRequesterIntake } from "./intake.tsx";
import { QaManualSessionExecutor } from "./manual-session-executor.tsx";
import { QaOperationalAuthorityWorkspace } from "./operational-authority-workspace.tsx";
import {
  QaSessionPlanner,
  type QaSessionPlannerPlanItem,
  type QaSessionPlannerSession,
} from "./session-planner.tsx";
import { qaUs5UiContribution, QaVerdictCompletion } from "./verdict-completion.tsx";

export { QaAutomatedSession, qaAutomatedSessionUiContribution } from "./automated-session.tsx";
export {
  QaAutomatedSessionExecutor,
  qaAutomatedSessionExecutorUiContribution,
} from "./automated-session-executor.tsx";
export { QaCandidateIntake, qaCandidateIntakeUiContribution } from "./candidate-intake.tsx";
export { QaHermesProposals, qaHermesProposalsUiContribution } from "./hermes-proposals.tsx";
export {
  QaNotificationHealth,
  qaNotificationHealthUiContribution,
} from "./notification-health.tsx";

export type QaUs1WorkspaceProps = QaBrowserApiContext & Readonly<{ onConfirmed?: () => void }>;

export function QaUs1Workspace(props: Readonly<QaUs1WorkspaceProps>) {
  const [refreshToken, setRefreshToken] = useState(0);
  const context = useMemo(
    () => ({
      apiUrl: props.apiUrl,
      accessToken: props.accessToken,
      workspaceId: props.workspaceId,
      projectId: props.projectId,
    }),
    [props.apiUrl, props.accessToken, props.workspaceId, props.projectId],
  );
  return (
    <Stack spacing={3}>
      <OperationalAuthorityPanel state="PENDING" origin="PLATFORM_DRAFT" freshness="UNKNOWN" />
      <QaRequesterIntake
        context={context}
        onChanged={() => {
          setRefreshToken((value) => value + 1);
          props.onConfirmed?.();
        }}
      />
      <QaConfirmedBacklog context={context} refreshToken={refreshToken} />
    </Stack>
  );
}

export const qaUs1UiContribution = Object.freeze({
  key: "competency-qa.us1",
  componentRef: "qa.ui.us1-workspace",
  Component: QaUs1Workspace,
});

export function QaImportedOperationalSummary(
  props: Readonly<{ externalDisplayKey: string; completeness: "COMPLETE" | "NEEDS_INFO" }>,
) {
  return (
    <OperationalAuthorityPanel
      state="CONFIRMED"
      origin="OPERATIONAL_IMPORT"
      freshness="CURRENT"
      externalDisplayKey={props.externalDisplayKey}
      completeness={props.completeness}
    />
  );
}
export function QaOperationalConflictSummary(
  props: Readonly<{ reasonCode: string; expectedRevision: string; observedRevision: string }>,
) {
  return <OperationalConflictPanel state="OPEN" {...props} />;
}

interface ApiSession {
  readonly sessionId: string;
  readonly ordinal: number;
  readonly state: string;
  readonly requiredSessionRequirementRef: Readonly<{
    planRef: Readonly<{ id: string; revision: number; contentHash: string }>;
    requirementKey: string;
    ordinal: number;
    contentHash: string;
  }>;
  readonly targetSnapshotHash?: string;
  readonly scopeSnapshotHash?: string;
  readonly structureRevision: number;
  readonly structureHash: string;
  readonly resourceVersion: number;
  readonly startedAt?: string;
}
interface ApiPlanItem {
  readonly planItemId: string;
  readonly sessionId: string;
}

export type QaUs2SessionWorkspaceProps = QaBrowserApiContext & Readonly<{ workItemId?: string }>;

export function QaUs2SessionWorkspace(props: Readonly<QaUs2SessionWorkspaceProps>) {
  const [workItemId, setWorkItemId] = useState(props.workItemId);
  const [sessions, setSessions] = useState<readonly ApiSession[]>([]);
  const [planItems, setPlanItems] = useState<readonly ApiPlanItem[]>([]);
  const [notice, setNotice] = useState(
    "Планирование сеансов привязано к текущему подтверждённому плану и снимкам.",
  );
  const base = `/api/v1/workspaces/${props.workspaceId}/projects/${props.projectId}`;
  const request = useCallback(
    async (path: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      headers.set("authorization", `Bearer ${props.accessToken}`);
      headers.set("content-type", "application/json");
      return await fetch(`${props.apiUrl}${path}`, { ...init, headers });
    },
    [props.accessToken, props.apiUrl],
  );
  const load = useCallback(async () => {
    let selected = workItemId;
    if (!selected) {
      const backlogResponse = await request(`${base}/qa/backlog`);
      if (!backlogResponse.ok)
        throw new Error(`Не удалось загрузить очередь QA: ${backlogResponse.status}`);
      const backlog = (await backlogResponse.json()) as Readonly<{
        items: readonly Readonly<{ requestExtension: Readonly<{ workItemId: string }> }>[];
      }>;
      selected = backlog.items[0]?.requestExtension.workItemId;
      setWorkItemId(selected);
    }
    if (!selected) {
      setSessions([]);
      setPlanItems([]);
      return;
    }
    const sessionResponse = await request(`${base}/work-items/${selected}/qa/sessions`);
    if (!sessionResponse.ok)
      throw new Error(`Не удалось загрузить сеансы QA: ${sessionResponse.status}`);
    const loaded = (await sessionResponse.json()) as readonly ApiSession[];
    setSessions(loaded);
    const nested = await Promise.all(
      loaded.map(async ({ sessionId }) => {
        const response = await request(
          `${base}/work-items/${selected}/qa/sessions/${sessionId}/plan-items`,
        );
        return response.ok ? ((await response.json()) as readonly ApiPlanItem[]) : [];
      }),
    );
    setPlanItems(nested.flat());
    setNotice(`Для рабочей задачи ${selected} загружено сеансов: ${loaded.length}.`);
  }, [base, request, workItemId]);
  useEffect(() => {
    let current = true;
    queueMicrotask(() => {
      if (current) void load().catch((error: unknown) => setNotice(String(error)));
    });
    return () => {
      current = false;
    };
  }, [load]);
  const transition = useCallback(
    async (session: ApiSession, requestedState: "READY" | "RUNNING") => {
      if (!workItemId) return;
      const response = await request(
        `${base}/work-items/${workItemId}/qa/sessions/${session.sessionId}/transitions`,
        {
          method: "POST",
          headers: { "if-match": `W/"${session.resourceVersion}"` },
          body: JSON.stringify({
            requestedState,
            ...(requestedState === "RUNNING"
              ? {
                  targetInputFingerprint: session.targetSnapshotHash,
                  scopeInputFingerprint: session.scopeSnapshotHash,
                  expectedStructureHash: session.structureHash,
                }
              : {}),
          }),
        },
      );
      if (!response.ok)
        throw new Error(
          `Не удалось перевести сеанс в состояние «${formatRuUiValue(requestedState)}»: ${response.status}`,
        );
      await load();
    },
    [base, load, request, workItemId],
  );
  const create = useCallback(
    async (parent?: ApiSession) => {
      if (!workItemId) return;
      let requirement = parent?.requiredSessionRequirementRef;
      let expectedVersion = parent?.resourceVersion;
      if (!requirement) {
        const response = await request(
          `${base}/work-items/${workItemId}/qa/required-session-plans/current`,
        );
        if (!response.ok)
          throw new Error(`Не удалось загрузить обязательный план: ${response.status}`);
        const plan = (await response.json()) as Readonly<{
          id: string;
          version: number;
          contentHash: string;
          requirements: readonly Readonly<{
            requirementKey: string;
            ordinal: number;
            contentHash: string;
            resolution: string;
          }>[];
        }>;
        const selected = plan.requirements.find(({ resolution }) => resolution === "REQUIRED");
        if (!selected) throw new Error("В плане нет обязательного сеанса");
        requirement = {
          planRef: { id: plan.id, revision: plan.version, contentHash: plan.contentHash },
          requirementKey: selected.requirementKey,
          ordinal: selected.ordinal,
          contentHash: selected.contentHash,
        };
        expectedVersion = plan.version;
      }
      const response = await request(`${base}/work-items/${workItemId}/qa/sessions`, {
        method: "POST",
        headers: { "if-match": `W/"${expectedVersion}"` },
        body: JSON.stringify({
          requiredSessionRequirementRef: requirement,
          ...(parent ? { parentSessionId: parent.sessionId } : {}),
        }),
      });
      if (!response.ok) throw new Error(`Не удалось запланировать сеанс: ${response.status}`);
      await load();
    },
    [base, load, request, workItemId],
  );
  const addPlanItem = useCallback(
    async (session: ApiSession) => {
      if (!workItemId) return;
      const response = await request(
        `${base}/work-items/${workItemId}/qa/sessions/${session.sessionId}/plan-items`,
        {
          method: "POST",
          headers: { "if-match": `W/"${session.resourceVersion}"` },
          body: JSON.stringify({
            title: "Ручная проверка",
            expectedOutcome: "Подтверждён ожидаемый результат приёмки",
            definition: {
              kind: "session-plan-item-snapshot",
              snapshotHash: session.scopeSnapshotHash ?? session.structureHash,
            },
          }),
        },
      );
      if (!response.ok) throw new Error(`Не удалось создать пункт плана: ${response.status}`);
      await load();
    },
    [base, load, request, workItemId],
  );
  const viewSessions: readonly QaSessionPlannerSession[] = sessions.map((session) => ({
    id: session.sessionId,
    ordinal: session.ordinal,
    state: session.state,
    requirementKey: session.requiredSessionRequirementRef.requirementKey,
    ...(session.targetSnapshotHash ? { targetSnapshotHash: session.targetSnapshotHash } : {}),
    ...(session.scopeSnapshotHash ? { scopeSnapshotHash: session.scopeSnapshotHash } : {}),
    structureRevision: session.structureRevision,
    ...(session.startedAt ? { startedAt: session.startedAt } : {}),
  }));
  const viewItems: readonly QaSessionPlannerPlanItem[] = planItems.map((item) => ({
    id: item.planItemId,
    sessionId: item.sessionId,
  }));
  return (
    <Stack spacing={2}>
      <Alert severity={/(?:не удалось|ошиб|failed|error)/iu.test(notice) ? "error" : "info"}>
        {notice}
      </Alert>
      <QaSessionPlanner
        sessions={viewSessions}
        planItems={viewItems}
        onCreate={() => void create().catch((error: unknown) => setNotice(String(error)))}
        onAddPlanItem={(id) => {
          const session = sessions.find(({ sessionId }) => sessionId === id);
          if (session)
            void addPlanItem(session).catch((error: unknown) => setNotice(String(error)));
        }}
        onPrepare={(id) => {
          const session = sessions.find(({ sessionId }) => sessionId === id);
          if (session)
            void transition(session, "READY").catch((error: unknown) => setNotice(String(error)));
        }}
        onStart={(id) => {
          const session = sessions.find(({ sessionId }) => sessionId === id);
          if (session)
            void transition(session, "RUNNING").catch((error: unknown) => setNotice(String(error)));
        }}
        onReplace={(id) => {
          const session = sessions.find(({ sessionId }) => sessionId === id);
          if (session) void create(session).catch((error: unknown) => setNotice(String(error)));
        }}
      />
    </Stack>
  );
}

export const qaUs2UiContribution = Object.freeze({
  key: "competency-qa.us2",
  componentRef: "qa.ui.us2-session-workspace",
  Component: QaUs2SessionWorkspace,
});

interface Us3PlanItem extends ApiPlanItem {
  readonly title: string;
  readonly expectedOutcome: string;
  readonly state: string;
}
interface Us3Attempt {
  readonly attemptId: string;
  readonly planItemId: string;
  readonly attemptNo: number;
  readonly state: string;
  readonly result?: string;
  readonly contentHash: `sha256:${string}`;
}
interface Us3Observation {
  readonly observationId: string;
  readonly planItemId: string;
  readonly attemptId: string;
  readonly kind: string;
  readonly contentHash: `sha256:${string}`;
}
interface Us3Result {
  readonly resultRevisionId: string;
  readonly planItemId: string;
  readonly version: number;
  readonly result: string;
}
interface Us3Manifest {
  readonly manifestId: string;
  readonly resourceVersion: number;
  readonly revisions: readonly Readonly<{
    version: number;
    kind: string;
    sessionOutcome: string;
    contentHash: string;
  }>[];
}

export function QaUs3ExecutionWorkspace(props: Readonly<QaUs2SessionWorkspaceProps>) {
  const [workItemId, setWorkItemId] = useState(props.workItemId);
  const [sessions, setSessions] = useState<readonly ApiSession[]>([]);
  const [items, setItems] = useState<readonly Us3PlanItem[]>([]);
  const [attempts, setAttempts] = useState<readonly Us3Attempt[]>([]);
  const [observations, setObservations] = useState<readonly Us3Observation[]>([]);
  const [results, setResults] = useState<readonly Us3Result[]>([]);
  const [evidence, setEvidence] = useState<
    readonly Readonly<{ evidenceArtifactLinkId: string; availability: "AVAILABLE" | "EXPIRED" }>[]
  >([]);
  const [manifests, setManifests] = useState<readonly Us3Manifest[]>([]);
  const [notice, setNotice] = useState(
    "Устойчивое к перезагрузке выполнение использует ETag сеанса для каждой команды.",
  );
  const [busy, setBusy] = useState(false);
  const base = `/api/v1/workspaces/${props.workspaceId}/projects/${props.projectId}`;
  const request = useCallback(
    async (path: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      headers.set("authorization", `Bearer ${props.accessToken}`);
      if (!(init.body instanceof Uint8Array)) headers.set("content-type", "application/json");
      return await fetch(`${props.apiUrl}${path}`, { ...init, headers });
    },
    [props.accessToken, props.apiUrl],
  );
  const load = useCallback(async () => {
    let selected = workItemId;
    if (!selected) {
      const backlog = await request(`${base}/qa/backlog`);
      const body = (await backlog.json()) as Readonly<{
        items: readonly Readonly<{ requestExtension: Readonly<{ workItemId: string }> }>[];
      }>;
      selected = body.items[0]?.requestExtension.workItemId;
      setWorkItemId(selected);
    }
    if (!selected) return;
    const loadedSessions = (await (
      await request(`${base}/work-items/${selected}/qa/sessions`)
    ).json()) as readonly ApiSession[];
    const session = loadedSessions.at(-1);
    setSessions(loadedSessions);
    if (!session) return;
    const loadedItems = (await (
      await request(`${base}/work-items/${selected}/qa/sessions/${session.sessionId}/plan-items`)
    ).json()) as readonly Us3PlanItem[];
    setItems(loadedItems);
    const attemptGroups = await Promise.all(
      loadedItems.map(
        async ({ planItemId }) =>
          (await (
            await request(
              `${base}/work-items/${selected}/qa/sessions/${session.sessionId}/plan-items/${planItemId}/attempts`,
            )
          ).json()) as readonly Us3Attempt[],
      ),
    );
    const flatAttempts = attemptGroups.flat();
    setAttempts(flatAttempts);
    const observationGroups = await Promise.all(
      flatAttempts.map(
        async ({ attemptId }) =>
          (await (
            await request(
              `${base}/work-items/${selected}/qa/sessions/${session.sessionId}/attempts/${attemptId}/observations`,
            )
          ).json()) as readonly Us3Observation[],
      ),
    );
    setObservations(observationGroups.flat());
    const resultGroups = await Promise.all(
      loadedItems.map(
        async ({ planItemId }) =>
          (await (
            await request(
              `${base}/work-items/${selected}/qa/sessions/${session.sessionId}/plan-items/${planItemId}/result-revisions`,
            )
          ).json()) as readonly Us3Result[],
      ),
    );
    setResults(resultGroups.flat());
    const evidenceResponse = await request(
      `${base}/work-items/${selected}/qa/sessions/${session.sessionId}/evidence-links`,
    );
    if (evidenceResponse.ok) setEvidence((await evidenceResponse.json()) as typeof evidence);
    const manifestResponse = await request(
      `${base}/work-items/${selected}/qa/sessions/${session.sessionId}/evidence-manifests`,
    );
    if (manifestResponse.ok)
      setManifests((await manifestResponse.json()) as readonly Us3Manifest[]);
  }, [base, request, workItemId]);
  useEffect(() => {
    let current = true;
    queueMicrotask(() => {
      if (current)
        void load().catch((error: unknown) =>
          setNotice(`Не удалось обновить данные: ${String(error)}`),
        );
    });
    return () => {
      current = false;
    };
  }, [load]);
  const run = useCallback(
    async (work: () => Promise<Response>) => {
      setBusy(true);
      try {
        const response = await work();
        if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);
        await load();
        setNotice("Команда сохранена; неизменяемая история повторно загружена через API.");
      } catch (error) {
        setNotice(`Не удалось выполнить команду: ${String(error)}`);
      } finally {
        setBusy(false);
      }
    },
    [load],
  );
  const session = sessions.at(-1);
  const path =
    session && workItemId
      ? `${base}/work-items/${workItemId}/qa/sessions/${session.sessionId}`
      : undefined;
  const headers = () => ({ "if-match": `W/"${session?.resourceVersion ?? 0}"` });
  const startAttempt = (planItemId: string) =>
    void run(
      async () =>
        await request(`${path}/plan-items/${planItemId}/attempts`, {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({ targetSnapshotHash: session?.targetSnapshotHash }),
        }),
    );
  const completeAttempt = (attemptId: string) =>
    void run(
      async () =>
        await request(`${path}/attempts/${attemptId}/completion`, {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({ result: "PASS", notes: "Ручная проверка пройдена без замечаний" }),
        }),
    );
  const recordObservation = (attemptId: string, planItemId: string) => {
    const item = items.find((value) => value.planItemId === planItemId)!;
    void run(
      async () =>
        await request(`${path}/attempts/${attemptId}/observations`, {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({
            planItemId,
            kind: "POSITIVE",
            expectedOutcome: item.expectedOutcome,
            actualOutcome: item.expectedOutcome,
            severity: "INFO",
          }),
        }),
    );
  };
  const recordResult = (planItemId: string) => {
    const completed = attempts.filter(
      (value) => value.planItemId === planItemId && value.state === "COMPLETED",
    );
    const observed = observations
      .filter((value) => value.planItemId === planItemId)
      .sort((a, b) => a.observationId.localeCompare(b.observationId));
    void run(
      async () =>
        await request(`${path}/plan-items/${planItemId}/result-revisions`, {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({
            expectedPreviousResultRevisionRef: null,
            expectedAttemptSetHash: sha256(
              completed.map(({ attemptId: id, contentHash }) => ({ id, contentHash })),
            ),
            expectedMaximumAttemptNo: completed.at(-1)?.attemptNo ?? 0,
            expectedObservationSetHash: sha256(
              observed.map(({ observationId: id, contentHash }) => ({ id, contentHash })),
            ),
            expectedObservationCount: observed.length,
            reviewFlags: [],
            result: "PASS",
            actualOutcome: items.find((value) => value.planItemId === planItemId)?.expectedOutcome,
            decisionReason: "Ожидаемый результат подтверждён",
            artifactIds: [],
          }),
        }),
    );
  };
  const transitionReview = () =>
    void run(
      async () =>
        await request(`${path}/transitions`, {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({ requestedState: "REVIEW_REQUIRED" }),
        }),
    );
  const publish = () => {
    const completed = attempts.filter(({ state }) => state === "COMPLETED");
    void run(
      async () =>
        await request(`${path}/evidence-manifests`, {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({
            reviewKind: "INITIAL",
            sessionOutcome: "PASSED",
            outcomeSummary: "Все ручные проверки пройдены с ожидаемыми результатами.",
            expectedExecutionSetHash: sha256(
              completed.map(({ attemptId: id, contentHash }) => ({ id, contentHash })),
            ),
            expectedFlakyDispositionBases: [],
          }),
        }),
    );
  };
  return (
    <Stack spacing={2}>
      <QaManualSessionExecutor
        {...(session
          ? {
              session: {
                sessionId: session.sessionId,
                state: session.state,
                resourceVersion: session.resourceVersion,
              },
            }
          : {})}
        planItems={items}
        attempts={attempts}
        observations={observations}
        results={results}
        busy={busy}
        notice={notice}
        onStartAttempt={startAttempt}
        onCompleteAttempt={completeAttempt}
        onRecordObservation={recordObservation}
        onRecordResult={recordResult}
        onTransitionReview={transitionReview}
        onReload={() => void load()}
      />
      <QaEvidenceReview
        {...(session ? { sessionState: session.state } : {})}
        evidence={evidence}
        manifests={manifests}
        busy={busy}
        notice={notice}
        onPublish={publish}
        onReload={() => void load()}
      />
    </Stack>
  );
}

export const qaUs3UiContribution = Object.freeze({
  key: "competency-qa.us3",
  componentRef: "qa.ui.us3-execution-workspace",
  Component: QaUs3ExecutionWorkspace,
});

type QaDetailTab =
  "intake" | "authority" | "readiness" | "sessions" | "evidence" | "findings" | "verdict";
interface QaBacklogChoice {
  readonly requestExtension: Readonly<{ workItemId: string }>;
  readonly currentRequestInputRevision: Readonly<{ title: string }>;
}
interface QaDetailSummary {
  readonly workItemId: string;
  readonly operationalReadiness: Readonly<{
    assessmentState?: string;
    normalizedStatus?: string;
    syncStage?: string;
  }>;
  readonly readinessAssessments: readonly unknown[];
  readonly requiredSessionPlanHistory: Readonly<{
    currentRevisionRef?: Readonly<{ version: number }> | null;
    revisions?: readonly unknown[];
  }> | null;
  readonly sessions: readonly unknown[];
  readonly evidenceManifestHistories: readonly unknown[];
  readonly findings: readonly unknown[];
  readonly verdicts: readonly unknown[];
}

export type QaWorkItemDetailProps = QaBrowserApiContext &
  Readonly<{
    workItemId?: string;
    view?: "create" | "requests";
    permissions?: readonly string[];
    projectLabel?: string;
    onOpenRequest?: (workItemId: string) => void;
    onCreateRequest?: () => void;
  }>;

export function QaWorkItemDetail(props: Readonly<QaWorkItemDetailProps>) {
  const contextKey = `${props.workspaceId}:${props.projectId}:${props.accessToken}`;
  if (props.view === "create")
    return (
      <QaRequesterIntake
        key={contextKey}
        context={props}
        {...(props.projectLabel ? { projectLabel: props.projectLabel } : {})}
        {...(props.onOpenRequest ? { onConfirmed: props.onOpenRequest } : {})}
      />
    );
  return <QaRequestBrowser key={contextKey} {...props} />;
}

function QaRequestBrowser(props: Readonly<QaWorkItemDetailProps>) {
  const [tab, setTab] = useState<QaDetailTab>("intake");
  const [localSelection, setLocalSelection] = useState<string>();
  const workItemId = props.workItemId ?? localSelection;
  const [summary, setSummary] = useState<QaDetailSummary>();
  const [choices, setChoices] = useState<readonly QaBacklogChoice[]>([]);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const loadSequence = useRef(0);
  const cancelPendingLoads = useCallback(() => {
    loadSequence.current += 1;
  }, []);
  const base = `/api/v1/workspaces/${props.workspaceId}/projects/${props.projectId}`;
  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setNotice("");
    setSummary(undefined);
    try {
      const headers = { authorization: `Bearer ${props.accessToken}` };
      const backlogResponse = await fetch(`${props.apiUrl}${base}/qa/backlog`, { headers });
      if (!backlogResponse.ok) throw new Error(backlogResponse.status === 403 ? "access" : "load");
      const backlog = (await backlogResponse.json()) as Readonly<{
        items: readonly QaBacklogChoice[];
      }>;
      if (sequence !== loadSequence.current) return;
      setChoices(backlog.items);
      if (!workItemId) return;
      if (!backlog.items.some((item) => item.requestExtension.workItemId === workItemId))
        throw new Error("missing");
      const response = await fetch(`${props.apiUrl}${base}/work-items/${workItemId}/qa/detail`, {
        headers,
      });
      if (!response.ok)
        throw new Error(response.status === 403 || response.status === 404 ? "missing" : "load");
      const detail = (await response.json()) as QaDetailSummary;
      if (sequence === loadSequence.current && detail.workItemId === workItemId) setSummary(detail);
    } catch (error) {
      if (sequence !== loadSequence.current) return;
      setChoices([]);
      setSummary(undefined);
      setNotice(
        error instanceof Error && error.message === "access"
          ? "Нет доступа к запросам этого проекта. Выберите другую роль или обратитесь к владельцу проекта."
          : error instanceof Error && error.message === "missing"
            ? "Этот запрос больше недоступен. Вернитесь к списку и выберите доступный запрос."
            : "Не удалось загрузить запросы. Проверьте соединение и повторите загрузку.",
      );
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [base, props.accessToken, props.apiUrl, workItemId]);
  useEffect(() => {
    let live = true;
    queueMicrotask(() => {
      if (live) void load();
    });
    return () => {
      live = false;
      cancelPendingLoads();
    };
  }, [load, cancelPendingLoads]);
  const open = (id: string) => {
    setSummary(undefined);
    if (props.onOpenRequest) props.onOpenRequest(id);
    else setLocalSelection(id);
  };
  const title = choices.find((item) => item.requestExtension.workItemId === workItemId)
    ?.currentRequestInputRevision.title;
  const canCreate = !props.permissions || props.permissions.includes("qa.request.create");
  const hasAnyPermission = (...permissions: string[]) =>
    !props.permissions || permissions.some((permission) => props.permissions!.includes(permission));
  const childProps = {
    ...(props.permissions ? { permissions: props.permissions } : {}),
    apiUrl: props.apiUrl,
    accessToken: props.accessToken,
    workspaceId: props.workspaceId,
    projectId: props.projectId,
    ...(workItemId ? { workItemId } : {}),
  };
  const tabs = [
    ["intake", "Запрос"],
    ["authority", "Статус в Jira"],
    ["readiness", "Готовность"],
    ["sessions", "Проверки"],
    ["evidence", "Материалы"],
    ["findings", "Замечания"],
    ["verdict", "Заключение"],
  ] as const;
  const tabHelp = {
    intake: "Описание выбранного запроса и следующий шаг команды.",
    authority:
      "Jira хранит рабочий статус, исполнителя и сроки запроса. Изменения могут требовать согласования.",
    readiness:
      "Перед началом проверок нужны достаточные исходные сведения, ресурсы и согласованный план.",
    sessions:
      "Сеанс — отдельный набор ручных или автоматических проверок. Сначала подготовьте план и проверьте готовность.",
    evidence:
      "Выполняйте проверки и сохраняйте наблюдения и подтверждающие материалы. История попыток сохраняется.",
    findings:
      "Разберите обнаруженные проблемы. Дефект создаётся после проверки и подтверждения человеком.",
    verdict: "Подведите итог проверок. Заключение подписывает уполномоченный участник команды.",
  };
  if (!workItemId)
    return (
      <Stack spacing={3}>
        <Box>
          <Typography component="h1" variant="h4">
            Запросы на проверку
          </Typography>
          <Typography color="text.secondary">
            Выберите запрос по названию, чтобы увидеть его состояние, проверки и результат.
          </Typography>
        </Box>
        <QaConfirmedBacklog
          context={props}
          onOpen={open}
          {...(canCreate && props.onCreateRequest ? { onCreate: props.onCreateRequest } : {})}
        />
      </Stack>
    );
  return (
    <Stack spacing={3}>
      <Stack direction="row" spacing={1}>
        <Button
          href="/qa/requests"
          onClick={
            props.onOpenRequest
              ? undefined
              : (event) => {
                  event.preventDefault();
                  setLocalSelection(undefined);
                }
          }
        >
          ← Все запросы
        </Button>
        {canCreate && props.onCreateRequest && (
          <Button onClick={props.onCreateRequest}>Новый запрос</Button>
        )}
      </Stack>
      <Card>
        <CardContent>
          <Stack spacing={2}>
            <label htmlFor="qa-selected-request">Выбранный запрос</label>
            <select
              id="qa-selected-request"
              value={workItemId}
              onChange={(event) => open(event.target.value)}
            >
              <option value="" disabled>
                Выберите запрос
              </option>
              {choices.map((choice) => (
                <option
                  key={choice.requestExtension.workItemId}
                  value={choice.requestExtension.workItemId}
                >
                  {choice.currentRequestInputRevision.title}
                </option>
              ))}
            </select>
            {loading && (
              <Stack role="status" direction="row" spacing={1}>
                <CircularProgress size={20} />
                <Typography>Загружаем выбранный запрос…</Typography>
              </Stack>
            )}
            {notice && <Alert severity="error">{notice}</Alert>}
            <Button onClick={() => void load()} disabled={loading}>
              Обновить сведения
            </Button>
            {!loading && summary?.workItemId === workItemId && (
              <>
                <Typography component="h1" variant="h4">
                  {title ?? "Запрос на проверку"}
                </Typography>
                <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
                  <Chip
                    label={`Статус в Jira: ${formatRuUiValue(summary.operationalReadiness.normalizedStatus ?? "UNKNOWN")}`}
                  />
                  <Chip
                    variant="outlined"
                    label={`Готовность QA: ${formatRuUiValue(summary.operationalReadiness.assessmentState ?? "NOT_EVALUATED")}`}
                  />
                </Stack>
                <Tabs
                  value={tab}
                  onChange={(_event, next: QaDetailTab) => setTab(next)}
                  variant="scrollable"
                  scrollButtons="auto"
                  aria-label="Разделы запроса"
                >
                  {tabs.map(([key, label]) => (
                    <Tab
                      key={key}
                      value={key}
                      label={label}
                      id={`qa-tab-${key}`}
                      aria-controls={`qa-panel-${key}`}
                    />
                  ))}
                </Tabs>
                <Box
                  role="tabpanel"
                  id={`qa-panel-${tab}`}
                  aria-labelledby={`qa-tab-${tab}`}
                  key={`${props.workspaceId}:${props.projectId}:${workItemId}:${tab}`}
                >
                  <Typography color="text.secondary" sx={{ mb: 2 }}>
                    {tabHelp[tab]}
                  </Typography>
                  {tab === "intake" && (
                    <Stack spacing={2}>
                      <Typography variant="h5" component="h2">
                        Что дальше
                      </Typography>
                      <Typography>
                        {summary.verdicts.length
                          ? "В запросе есть заключение. Откройте его, чтобы ознакомиться с результатом и оставшимися рисками."
                          : summary.sessions.length
                            ? "Проверки уже запланированы. Откройте раздел «Проверки», чтобы посмотреть их ход, или «Материалы» для результатов."
                            : "Команде QA нужно проверить готовность запроса и согласовать план. Заказчик может следить за ходом работы здесь."}
                      </Typography>
                      <Box>
                        <Button
                          variant="contained"
                          onClick={() =>
                            setTab(
                              summary.verdicts.length
                                ? "verdict"
                                : summary.sessions.length
                                  ? "sessions"
                                  : "readiness",
                            )
                          }
                        >
                          {summary.verdicts.length
                            ? "Посмотреть заключение"
                            : summary.sessions.length
                              ? "Посмотреть проверки"
                              : "Посмотреть готовность"}
                        </Button>
                      </Box>
                      <Typography color="text.secondary">
                        Проверок: {summary.sessions.length} · замечаний: {summary.findings.length} ·
                        заключений: {summary.verdicts.length}
                      </Typography>
                    </Stack>
                  )}
                  {tab === "authority" && (
                    <QaOperationalAuthorityWorkspace {...childProps} workItemId={workItemId} />
                  )}
                  {tab === "readiness" && (
                    <Stack spacing={2}>
                      <Typography variant="h5" component="h2">
                        Готовность к проверке
                      </Typography>
                      <Typography>
                        Оценка:{" "}
                        {formatRuUiValue(
                          summary.operationalReadiness.assessmentState ?? "NOT_EVALUATED",
                        )}
                      </Typography>
                      <Typography>
                        План проверок:{" "}
                        {summary.requiredSessionPlanHistory?.currentRevisionRef
                          ? `согласована версия ${summary.requiredSessionPlanHistory.currentRevisionRef.version}`
                          : "ещё не опубликован"}
                      </Typography>
                      <Alert severity="info">
                        Исполнитель QA проверяет исходные данные и ресурсы; уполномоченный участник
                        подтверждает готовность. Если вы заказчик, уточните недостающие сведения у
                        команды.
                      </Alert>
                    </Stack>
                  )}
                  {tab === "sessions" &&
                    (hasAnyPermission("qa.session.plan", "qa.session.execute") ? (
                      <QaUs2SessionWorkspace {...childProps} />
                    ) : (
                      <Alert severity="info">
                        Проверок: {summary.sessions.length}. Планировать и выполнять проверки может
                        исполнитель QA. Для этого сценария выберите роль исполнителя.
                      </Alert>
                    ))}
                  {tab === "evidence" &&
                    (hasAnyPermission("qa.session.execute") ? (
                      <QaUs3ExecutionWorkspace {...childProps} />
                    ) : (
                      <Alert severity="info">
                        Историй материалов: {summary.evidenceManifestHistories.length}. Результаты
                        выполнения сохраняет исполнитель QA.
                      </Alert>
                    ))}
                  {tab === "findings" && <QaFindingsDefects {...childProps} />}
                  {tab === "verdict" && <QaVerdictCompletion {...childProps} />}
                </Box>
                <Box component="details">
                  <summary>Технические детали</summary>
                  <Typography variant="body2">Запрос: {workItemId}</Typography>
                  <Typography variant="body2">
                    Оценок готовности: {summary.readinessAssessments.length}; история материалов:{" "}
                    {summary.evidenceManifestHistories.length}
                  </Typography>
                </Box>
                <Typography variant="caption" color="text.secondary">
                  Заключение QA описывает результат проверок. Решение о выпуске принимается
                  отдельно.
                </Typography>
              </>
            )}
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  );
}

export const qaWorkItemDetailUiContribution = Object.freeze({
  key: "competency-qa.work-item-detail",
  componentRef: "qa.ui.work-item-detail",
  Component: QaWorkItemDetail,
});

export { QaFindingsDefects, qaUs4UiContribution, qaUs5UiContribution, QaVerdictCompletion };
