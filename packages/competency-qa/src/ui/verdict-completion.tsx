import { useCallback, useEffect, useState } from "react";

import {
  Alert,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  formatRuUiValue,
  Stack,
  TextField,
  Typography,
} from "@awp/platform-ui";

import type { QaBrowserApiContext } from "./intake.tsx";

type Row = Readonly<Record<string, unknown>>;
interface Projection {
  readonly aggregateSnapshotHash?: string;
  readonly cosignRequests?: readonly Readonly<{ approvalId: string; verdictId: string }>[];
  readonly verdicts: readonly Row[];
  readonly verdictSignatures: readonly Row[];
  readonly dodAssessments: readonly Row[];
  readonly completionCandidates: readonly Row[];
  readonly finalCloseConfirmations: readonly Row[];
  readonly postCloseCorrectionMarkers: readonly Row[];
}

const field = (row: Row | undefined, camel: string, snake: string): unknown =>
  row?.[camel] ?? row?.[snake];
const asJson = <T,>(value: unknown): T =>
  typeof value === "string" ? (JSON.parse(value) as T) : (value as T);
const exact = (
  row: Row,
): Readonly<{ id: string; version: number; contentHash: `sha256:${string}` }> => ({
  id: String(field(row, "verdictId", "verdict_id")),
  version: Number(field(row, "version", "version")),
  contentHash: String(field(row, "contentHash", "content_hash")) as `sha256:${string}`,
});

export type QaVerdictCompletionProps = QaBrowserApiContext &
  Readonly<{ workItemId?: string; permissions?: readonly string[] }>;

export function QaVerdictCompletion(props: QaVerdictCompletionProps) {
  const [workItemId, setWorkItemId] = useState(props.workItemId);
  const [projection, setProjection] = useState<Projection>({
    verdicts: [],
    verdictSignatures: [],
    dodAssessments: [],
    completionCandidates: [],
    finalCloseConfirmations: [],
    postCloseCorrectionMarkers: [],
  });
  const [residualRisk, setResidualRisk] = useState(
    "QA фиксирует остаточный риск продукта; это не решение о выпуске.",
  );
  const [riskClassification, setRiskClassification] = useState("LOW");
  const [revisionReason, setRevisionReason] = useState("");
  const [verdictValue, setVerdictValue] = useState("FAIL");
  const [notice, setNotice] = useState(
    "Заключение, DoD и внешнее состояние «Выполнено» — отдельные неизменяемые решения.",
  );
  const [busy, setBusy] = useState(false);
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
      const backlog = (await (await request(`${base}/qa/backlog`)).json()) as Readonly<{
        items: readonly Readonly<{
          requestExtension: Readonly<{ workItemId: string; permissions?: readonly string[] }>;
        }>[];
      }>;
      selected = backlog.items[0]?.requestExtension.workItemId;
      setWorkItemId(selected);
    }
    if (!selected) return;
    const response = await request(`${base}/work-items/${selected}/qa/verdict-completion`);
    if (!response.ok) throw new Error(`Не удалось обновить заключение: ${response.status}`);
    setProjection((await response.json()) as Projection);
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
  const latestVerdict = projection.verdicts.at(-1);
  const latestDod = projection.dodAssessments.at(-1);
  const latestCandidate = projection.completionCandidates.at(-1);
  const verdictState = String(field(latestVerdict, "state", "state") ?? "NOT_CREATED");
  const candidateState = String(field(latestCandidate, "state", "state") ?? "NOT_CREATED");
  const blockers = asJson<readonly string[]>(
    field(latestDod, "blockerCodes", "blocker_codes") ?? [],
  );
  const run = useCallback(
    async (operation: () => Promise<Response>) => {
      setBusy(true);
      try {
        const response = await operation();
        if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);
        await load();
        setNotice("Команда сохранена; точное неизменяемое состояние обновлено.");
      } catch (error) {
        setNotice(`Не удалось выполнить команду: ${String(error)}`);
      } finally {
        setBusy(false);
      }
    },
    [load],
  );
  const successorBody = latestVerdict
    ? {
        verdict: verdictValue,
        residualRisk: { statement: residualRisk, classification: riskClassification },
        expectedAggregateSnapshotHash: projection.aggregateSnapshotHash,
        supersedesVerdictRef: exact(latestVerdict),
        revisionReason,
      }
    : undefined;
  const pendingCosign = projection.cosignRequests?.find(
    (value) => value.verdictId === field(latestVerdict, "verdictId", "verdict_id"),
  );

  const path = workItemId ? `${base}/work-items/${workItemId}/qa` : undefined;
  return (
    <Card>
      <CardContent>
        <Stack spacing={2}>
          <Typography variant="h5">Итоговое заключение QA и завершение</Typography>
          <Alert severity="warning">
            <strong>Это не решение о выпуске.</strong> Состояние «Выполнено» закрывает запрос на
            услугу QA и может сочетаться с отрицательным заключением и открытым связанным дефектом
            продукта.
          </Alert>
          <Alert severity={/(?:не удалось|ошиб|failed|error)/iu.test(notice) ? "error" : "info"}>
            {notice}
          </Alert>
          <Stack direction={{ xs: "column", md: "row" }} spacing={1}>
            <Chip label={`Заключение: ${formatRuUiValue(verdictState)}`} />
            <Chip
              label={`DoD: ${formatRuUiValue(field(latestDod, "state", "state") ?? "NOT_EVALUATED")}`}
            />
            <Chip
              color={candidateState === "CONFIRMED" ? "success" : "default"}
              label={`Закрытие: ${formatRuUiValue(candidateState)}`}
            />
          </Stack>
          <select
            aria-label="Заключение QA"
            value={verdictValue}
            onChange={(event) => setVerdictValue(event.target.value)}
          >
            <option value="PASS">Пройдено</option>
            <option value="FAIL">Не пройдено</option>
            <option value="BLOCKED">Заблокировано</option>
            <option value="INCONCLUSIVE">Нет однозначного результата</option>
          </select>
          <select
            aria-label="Классификация остаточного риска"
            value={riskClassification}
            onChange={(event) => setRiskClassification(event.target.value)}
          >
            <option value="LOW">Низкий</option>
            <option value="MEDIUM">Средний</option>
            <option value="HIGH">Высокий</option>
            <option value="CRITICAL">Критический</option>
          </select>
          <TextField
            multiline
            minRows={3}
            label="Остаточный риск"
            value={residualRisk}
            onChange={(event) => setResidualRisk(event.target.value)}
          />
          <TextField
            label="Причина пересмотра подписанного заключения"
            value={revisionReason}
            onChange={(event) => setRevisionReason(event.target.value)}
          />
          <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
            <Button
              disabled={
                (!!props.permissions && !props.permissions.includes("qa.verdict.sign")) ||
                busy ||
                !path ||
                !!latestVerdict ||
                !projection.aggregateSnapshotHash ||
                !residualRisk.trim()
              }
              onClick={() =>
                void run(async () =>
                  request(`${path}/verdicts`, {
                    method: "POST",
                    body: JSON.stringify({
                      verdict: verdictValue,
                      residualRisk: { statement: residualRisk, classification: riskClassification },
                      expectedAggregateSnapshotHash: projection.aggregateSnapshotHash,
                    }),
                  }),
                )
              }
            >
              Создать черновик заключения
            </Button>
            <Button
              disabled={
                (!!props.permissions && !props.permissions.includes("qa.verdict.sign")) ||
                busy ||
                !path ||
                !successorBody ||
                !revisionReason.trim() ||
                verdictState !== "SIGNED"
              }
              onClick={() =>
                void run(
                  async () =>
                    await request(
                      `${path}/verdicts/${String(field(latestVerdict, "verdictId", "verdict_id"))}/supersessions`,
                      {
                        method: "POST",
                        headers: {
                          "if-match": `W/"${Number(field(latestVerdict, "resourceVersion", "resource_version"))}"`,
                        },
                        body: JSON.stringify(successorBody),
                      },
                    ),
                )
              }
            >
              Создать замещающее заключение
            </Button>
            <Button
              variant="contained"
              disabled={
                (!!props.permissions && !props.permissions.includes("qa.verdict.sign")) ||
                busy ||
                !path ||
                verdictState !== "DRAFT"
              }
              onClick={() =>
                void run(
                  async () =>
                    await request(
                      `${path}/verdicts/${String(field(latestVerdict, "verdictId", "verdict_id"))}/signatures`,
                      {
                        method: "POST",
                        headers: {
                          "if-match": `W/"${Number(field(latestVerdict, "resourceVersion", "resource_version"))}"`,
                        },
                        body: "{}",
                      },
                    ),
                )
              }
            >
              Подписать первым
            </Button>
            <Button
              color="secondary"
              disabled={
                (!!props.permissions && !props.permissions.includes("qa.verdict.sign")) ||
                busy ||
                !path ||
                verdictState !== "PARTIALLY_SIGNED"
              }
              onClick={() =>
                void run(
                  async () =>
                    await request(
                      `${path}/verdicts/${String(field(latestVerdict, "verdictId", "verdict_id"))}/cosign-requests`,
                      {
                        method: "POST",
                        headers: {
                          "if-match": `W/"${Number(field(latestVerdict, "resourceVersion", "resource_version"))}"`,
                        },
                        body: JSON.stringify({
                          reason: "Независимая проверка высокого или критического риска",
                        }),
                      },
                    ),
                )
              }
            >
              Запросить подпись руководителя
            </Button>
            <Button
              disabled={
                (!!props.permissions && !props.permissions.includes("qa.verdict.cosign")) ||
                busy ||
                !path ||
                !pendingCosign ||
                verdictState !== "PARTIALLY_SIGNED"
              }
              onClick={() =>
                void run(async () =>
                  request(
                    `${path}/verdicts/${pendingCosign!.verdictId}/cosign-approvals/${pendingCosign!.approvalId}/approve`,
                    { method: "POST", body: "{}" },
                  ),
                )
              }
            >
              Подписать как руководитель QA
            </Button>
            <Button
              disabled={
                (!!props.permissions && !props.permissions.includes("qa.completion.request")) ||
                busy ||
                !path ||
                verdictState !== "SIGNED" ||
                !projection.aggregateSnapshotHash
              }
              onClick={() =>
                void run(async () =>
                  request(`${path}/dod-assessments`, {
                    method: "POST",
                    body: JSON.stringify({
                      verdictRef: exact(latestVerdict!),
                      expectedAggregateSnapshotHash: projection.aggregateSnapshotHash,
                    }),
                  }),
                )
              }
            >
              Оценить DoD
            </Button>
            <Button
              disabled={
                (!!props.permissions && !props.permissions.includes("qa.completion.request")) ||
                busy ||
                !path ||
                field(latestDod, "state", "state") !== "READY_TO_CLOSE" ||
                [
                  "CANDIDATE",
                  "AWAITING_APPROVAL",
                  "AUTHORIZED",
                  "DISPATCHED",
                  "CONFIRMED",
                ].includes(candidateState)
              }
              onClick={() =>
                void run(async () =>
                  request(`${path}/completion-candidates`, {
                    method: "POST",
                    body: JSON.stringify({
                      readyToCloseDodRef: {
                        id: field(latestDod, "assessmentId", "assessment_id"),
                        version: field(latestDod, "version", "version"),
                        contentHash: field(latestDod, "contentHash", "content_hash"),
                      },
                    }),
                  }),
                )
              }
            >
              Подготовить закрытие
            </Button>
            <Button
              disabled={
                (!!props.permissions && !props.permissions.includes("qa.completion.request")) ||
                busy ||
                !path ||
                candidateState !== "CANDIDATE"
              }
              onClick={() =>
                void run(
                  async () =>
                    await request(
                      `${path}/completion-candidates/${String(field(latestCandidate, "candidateId", "candidate_id"))}/final-close`,
                      {
                        method: "POST",
                        headers: {
                          "if-match": `W/"${Number(field(latestCandidate, "resourceVersion", "resource_version"))}"`,
                        },
                        body: "{}",
                      },
                    ),
                )
              }
            >
              Запросить внешнее состояние «Выполнено»
            </Button>
            <Button
              variant="contained"
              color="secondary"
              disabled={
                (!!props.permissions && !props.permissions.includes("qa.completion.approve")) ||
                busy ||
                !path ||
                candidateState !== "AWAITING_APPROVAL"
              }
              onClick={() => {
                const ref = asJson<Readonly<{ id: string }>>(
                  field(latestCandidate, "approvalRef", "approval_ref"),
                );
                void run(
                  async () =>
                    await request(`${path}/completion-approvals/${ref.id}/approve`, {
                      method: "POST",
                      body: "{}",
                    }),
                );
              }}
            >
              Согласовать внешнее состояние «Выполнено»
            </Button>
          </Stack>
          <Divider />
          <Typography variant="h6">Детерминированные препятствия DoD</Typography>
          {blockers.length === 0 ? (
            <Typography color="text.secondary">В последней оценке нет препятствий.</Typography>
          ) : (
            blockers.map((blocker) => (
              <Chip key={blocker} color="warning" label={formatRuUiValue(blocker)} />
            ))
          )}
          <Typography variant="body2">
            Подписей: {projection.verdictSignatures.length} · подтверждений:{" "}
            {projection.finalCloseConfirmations.length} · отметок после закрытия:{" "}
            {projection.postCloseCorrectionMarkers.length}
          </Typography>
          <Button onClick={() => void load()} disabled={busy}>
            Обновить точное состояние
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
}

export const qaUs5UiContribution = Object.freeze({
  key: "competency-qa.us5",
  componentRef: "qa.ui.us5-verdict-completion",
  Component: QaVerdictCompletion,
});
