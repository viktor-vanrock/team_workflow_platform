import { useState } from "react";

import { QaRequesterIntake } from "@awp/competency-qa/ui";
import { Alert, Button, Card, CardContent, Stack, Typography } from "@awp/platform-ui";

interface Option {
  readonly intentId: string;
  readonly intentToken: string;
  readonly workspaceLabel: string;
  readonly projectLabel: string;
  readonly expiresAt: string;
}
export function MattermostIntakeRoute(props: Readonly<{ apiUrl: string; accessToken: string }>) {
  const [options, setOptions] = useState<readonly Option[]>([]);
  const [selected, setSelected] =
    useState<Readonly<{ workspaceId: string; projectId: string; projectLabel: string }>>();
  const [notice, setNotice] = useState("Выберите проект после входа через OIDC.");
  const headers = {
    authorization: `Bearer ${props.accessToken}`,
    "content-type": "application/json",
  };
  async function load() {
    const response = await fetch(`${props.apiUrl}/api/v1/intake/mattermost/project-option-sets`, {
      method: "POST",
      headers,
      body: "{}",
    });
    if (!response.ok) throw new Error(`Не удалось загрузить варианты проектов: ${response.status}`);
    const body = (await response.json()) as Readonly<{ items: readonly Option[] }>;
    setOptions(body.items);
    setNotice(
      body.items.length
        ? "Доступные проекты вычислены по текущим правам."
        : "Нет доступных проектов.",
    );
  }
  async function choose(option: Option) {
    const response = await fetch(`${props.apiUrl}/api/v1/intake/mattermost/project-selections`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        intentId: option.intentId,
        intentToken: option.intentToken,
        requestKey: `mattermost-web-${crypto.randomUUID()}`,
      }),
    });
    if (!response.ok) throw new Error(`Не удалось выбрать проект: ${response.status}`);
    const body = (await response.json()) as Readonly<{
      draft: Readonly<{
        workspaceId: string;
        projectId: string;
        revision: number;
        contentHash: string;
      }>;
      replayed: boolean;
    }>;
    setSelected({
      workspaceId: body.draft.workspaceId,
      projectId: body.draft.projectId,
      projectLabel: option.projectLabel,
    });
    setNotice(
      `Создан черновик r${body.draft.revision}; повтор=${String(body.replayed)}. Дальнейшее подтверждение остаётся явным.`,
    );
  }
  return (
    <Stack spacing={2}>
      <Card>
        <CardContent>
          <Stack spacing={2}>
            <Typography variant="h4">Управляемый приём запроса из Mattermost</Typography>
            <Alert severity="info">{notice}</Alert>
            <Button
              variant="contained"
              onClick={() => void load().catch((error: unknown) => setNotice(String(error)))}
            >
              Получить доступные проекты
            </Button>
            {options.map((option) => (
              <Button
                key={option.intentId}
                variant="outlined"
                onClick={() =>
                  void choose(option).catch((error: unknown) => setNotice(String(error)))
                }
              >
                {option.workspaceLabel} / {option.projectLabel}
              </Button>
            ))}
          </Stack>
        </CardContent>
      </Card>
      {selected && (
        <QaRequesterIntake
          context={{
            apiUrl: props.apiUrl,
            accessToken: props.accessToken,
            workspaceId: selected.workspaceId,
            projectId: selected.projectId,
          }}
        />
      )}
    </Stack>
  );
}
