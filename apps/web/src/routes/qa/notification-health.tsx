import { useState } from "react";

import { QaNotificationHealth, type QaNotificationHealthView } from "@awp/competency-qa/ui";
import { Alert, Button, Stack, TextField } from "@awp/platform-ui";

export function NotificationHealthRoute(
  props: Readonly<{ apiUrl: string; accessToken: string; workspaceId: string; projectId: string }>,
) {
  const [intentId, setIntentId] = useState("");
  const [value, setValue] = useState<QaNotificationHealthView>();
  const [notice, setNotice] = useState("Введите точный ID намерения уведомления.");
  async function load() {
    const response = await fetch(
      `${props.apiUrl}/api/v1/workspaces/${props.workspaceId}/projects/${props.projectId}/notification-intents/${intentId}`,
      { headers: { authorization: `Bearer ${props.accessToken}` } },
    );
    if (!response.ok)
      throw new Error(`Не удалось загрузить состояние уведомления: ${response.status}`);
    setValue((await response.json()) as QaNotificationHealthView);
    setNotice("Сохранённое состояние загружено.");
  }
  return (
    <Stack spacing={2}>
      <Alert severity="info">{notice}</Alert>
      <TextField
        label="ID намерения уведомления"
        value={intentId}
        onChange={(event) => setIntentId(event.target.value)}
      />
      <Button
        disabled={!intentId}
        onClick={() => void load().catch((error: unknown) => setNotice(String(error)))}
      >
        Загрузить состояние доставки
      </Button>
      <QaNotificationHealth {...(value ? { value } : {})} />
    </Stack>
  );
}
