import { useCallback, useEffect, useMemo, useState } from "react";

import {
  Alert,
  Button,
  Card,
  CardContent,
  Chip,
  formatRuDateTime,
  formatRuUiValue,
  Stack,
  Typography,
} from "@awp/platform-ui";

export interface QaCandidateView {
  readonly id: string;
  readonly state: string;
  readonly currentSourceObservationVersion: number;
  readonly rowVersion: number;
  readonly expiresAt: string;
  readonly snoozedUntil?: string;
}
export function QaCandidateIntake(
  props: Readonly<{
    apiUrl: string;
    accessToken: string;
    workspaceId: string;
    projectId: string;
    permissions?: readonly string[];
  }>,
) {
  const [items, setItems] = useState<readonly QaCandidateView[]>([]),
    [notice, setNotice] = useState(
      "Кандидаты не являются операционной работой до подтверждения черновика.",
    );
  const base = `${props.apiUrl}/api/v1/workspaces/${props.workspaceId}/projects/${props.projectId}/intake-candidates`;
  const headers = useMemo(
    () => ({
      authorization: `Bearer ${props.accessToken}`,
      "content-type": "application/json",
    }),
    [props.accessToken],
  );
  const load = useCallback(async () => {
    const response = await fetch(base, { headers });
    if (!response.ok) throw new Error(`Не удалось загрузить список кандидатов: ${response.status}`);
    setItems(((await response.json()) as { items: readonly QaCandidateView[] }).items);
  }, [base, headers]);
  useEffect(() => {
    let current = true;
    queueMicrotask(() => {
      if (current) void load().catch((error: unknown) => setNotice(String(error)));
    });
    return () => {
      current = false;
    };
  }, [load]);
  async function decide(
    item: QaCandidateView,
    decision: "CREATE" | "SNOOZE" | "IGNORE",
    decidedAt: number,
  ) {
    const response = await fetch(`${base}/${item.id}/decisions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        decision,
        expectedCandidateVersion: item.rowVersion,
        expectedSourceObservationVersion: item.currentSourceObservationVersion,
        reasonCode:
          decision === "CREATE"
            ? "USER_SELECTED"
            : decision === "SNOOZE"
              ? "DEFERRED"
              : "NOT_ACTIONABLE",
        ...(decision === "SNOOZE"
          ? { snoozedUntil: new Date(decidedAt + 3_600_000).toISOString() }
          : {}),
        requestKey: `candidate-ui-${item.id}-${decision}`,
      }),
    });
    if (!response.ok)
      throw new Error(`Не удалось сохранить решение по кандидату: ${response.status}`);
    setNotice(
      `Решение «${formatRuUiValue(decision)}» записано как решение человека; при создании появился только черновик.`,
    );
    await load();
  }
  return (
    <Stack spacing={2}>
      <Typography variant="h4">Приём кандидатов</Typography>
      <Alert severity="info">{notice}</Alert>
      {items.map((item) => (
        <Card key={item.id}>
          <CardContent>
            <Stack spacing={1}>
              <Typography variant="h6">Кандидат {item.id}</Typography>
              <Stack direction="row" spacing={1}>
                <Chip label={formatRuUiValue(item.state)} />
                <Chip label={`наблюдение v${item.currentSourceObservationVersion}`} />
                <Chip label={`истекает ${formatRuDateTime(item.expiresAt)}`} />
              </Stack>
              <Stack direction="row" spacing={1}>
                <Button
                  disabled={!!props.permissions && !props.permissions.includes("qa.request.create")}
                  onClick={() =>
                    void decide(item, "CREATE", Date.now()).catch((error: unknown) =>
                      setNotice(String(error)),
                    )
                  }
                >
                  Создать черновик
                </Button>
                <Button
                  disabled={!!props.permissions && !props.permissions.includes("qa.request.create")}
                  onClick={() =>
                    void decide(item, "SNOOZE", Date.now()).catch((error: unknown) =>
                      setNotice(String(error)),
                    )
                  }
                >
                  Отложить
                </Button>
                <Button
                  disabled={!!props.permissions && !props.permissions.includes("qa.request.create")}
                  onClick={() =>
                    void decide(item, "IGNORE", Date.now()).catch((error: unknown) =>
                      setNotice(String(error)),
                    )
                  }
                >
                  Игнорировать
                </Button>
              </Stack>
            </Stack>
          </CardContent>
        </Card>
      ))}
    </Stack>
  );
}
export const qaCandidateIntakeUiContribution = Object.freeze({
  key: "competency-qa.candidate-intake",
  componentRef: "qa.ui.candidate-intake",
  Component: QaCandidateIntake,
});
