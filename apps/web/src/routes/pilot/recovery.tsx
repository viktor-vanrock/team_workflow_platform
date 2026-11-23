import { useState } from "react";

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  formatRuUiValue,
  Stack,
  TextField,
  Typography,
} from "@awp/platform-ui";

import { PilotBrowserClient, PilotClientError, type PilotRecoveryView } from "./pilot-client.ts";

const client = new PilotBrowserClient(),
  uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu;
export function PilotRecoveryRoute({
  initialScope = { workspaceId: "", projectId: "" },
}: {
  readonly initialScope?: { readonly workspaceId: string; readonly projectId: string };
}) {
  const [scope, setScope] = useState(initialScope),
    [view, setView] = useState<PilotRecoveryView>(),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState<string>();
  const load = async () => {
    if (!uuid.test(scope.workspaceId) || !uuid.test(scope.projectId)) {
      setNotice("Введите корректные ID рабочей области и проекта.");
      return;
    }
    setBusy(true);
    setNotice(undefined);
    try {
      if (!(await client.session())) throw new PilotClientError("PILOT_LOGIN_REQUIRED");
      setView(await client.recovery(scope));
    } catch (error) {
      setNotice(
        error instanceof PilotClientError && error.code === "PILOT_LOGIN_REQUIRED"
          ? "Войдите на странице готовности пилота и повторите попытку."
          : "Данные о восстановлении недоступны для этого проекта.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Box
      component="main"
      sx={{ minHeight: "100vh", bgcolor: "background.default", p: { xs: 2, md: 4 } }}
    >
      <Stack spacing={3} sx={{ maxWidth: 1000, mx: "auto" }}>
        <Box>
          <Typography variant="h3">Данные о восстановлении</Typography>
          <Typography color="text.secondary">
            Результаты проверок в выбранной области и неразрешённые эффекты поставщиков.
          </Typography>
        </Box>
        <Card>
          <CardContent>
            <Stack
              component="form"
              spacing={2}
              onSubmit={(event) => {
                event.preventDefault();
                void load();
              }}
            >
              <TextField
                label="ID рабочей области"
                value={scope.workspaceId}
                onChange={(event) => setScope({ ...scope, workspaceId: event.target.value.trim() })}
              />
              <TextField
                label="ID проекта"
                value={scope.projectId}
                onChange={(event) => setScope({ ...scope, projectId: event.target.value.trim() })}
              />
              <Button type="submit" variant="contained" disabled={busy}>
                Загрузить данные
              </Button>
              {busy && <CircularProgress size={20} />}{" "}
              {notice && <Alert severity="warning">{notice}</Alert>}
            </Stack>
          </CardContent>
        </Card>
        {view && (
          <>
            <Alert severity={view.uncertainEffects.length ? "warning" : "success"}>
              Неразрешённых эффектов: {view.uncertainEffects.length}
            </Alert>
            {view.drills.map((drill) => (
              <Card key={drill.recoveryId}>
                <CardContent>
                  <Typography variant="h6">{drill.recoveryId}</Typography>
                  <Typography>
                    {formatRuUiValue(drill.stage)} · {formatRuUiValue(drill.status)}
                  </Typography>
                  <Typography>
                    RPO: {drill.rpoObservedSeconds ?? "неизвестно"} с · RTO:{" "}
                    {drill.rtoObservedSeconds ?? "неизвестно"} с
                  </Typography>
                  <Typography>
                    Неразрешённых эффектов поставщика: {drill.unresolvedEffects.length}
                  </Typography>
                </CardContent>
              </Card>
            ))}
          </>
        )}
      </Stack>
    </Box>
  );
}
