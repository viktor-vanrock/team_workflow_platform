import {
  Alert,
  Button,
  Card,
  CardContent,
  Chip,
  formatRuUiValue,
  Stack,
  Typography,
} from "@awp/platform-ui";

export interface QaSessionPlannerSession {
  readonly id: string;
  readonly ordinal: number;
  readonly state: string;
  readonly requirementKey: string;
  readonly targetSnapshotHash?: string;
  readonly scopeSnapshotHash?: string;
  readonly structureRevision: number;
  readonly startedAt?: string;
}

export interface QaSessionPlannerPlanItem {
  readonly id: string;
  readonly sessionId: string;
}

export function QaSessionPlanner(
  props: Readonly<{
    sessions: readonly QaSessionPlannerSession[];
    planItems: readonly QaSessionPlannerPlanItem[];
    onCreate?: () => void;
    onAddPlanItem?: (id: string) => void;
    onPrepare?: (id: string) => void;
    onStart?: (id: string) => void;
    onReplace?: (id: string) => void;
  }>,
) {
  return (
    <Card>
      <CardContent>
        <Stack spacing={2}>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
            <Typography variant="h6">Ручные сеансы</Typography>
            <Button onClick={props.onCreate}>Запланировать сеанс</Button>
          </Stack>
          {props.sessions.length === 0 && (
            <Alert severity="info">Запланированных сеансов нет.</Alert>
          )}
          {props.sessions.map((session) => (
            <Stack key={session.id} spacing={1}>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                <Chip label={`№ ${session.ordinal}`} />
                <Chip label={formatRuUiValue(session.state)} />
                <Typography>{formatRuUiValue(session.requirementKey)}</Typography>
              </Stack>
              <Typography variant="body2">
                цель {(session.targetSnapshotHash ?? "ожидается").slice(0, 18)} · область{" "}
                {(session.scopeSnapshotHash ?? "ожидается").slice(0, 18)} · структура r
                {session.structureRevision}
              </Typography>
              <Typography variant="body2">
                Запланировано проверок:{" "}
                {props.planItems.filter((item) => item.sessionId === session.id).length}
              </Typography>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                {session.state === "PLANNED" && (
                  <Button onClick={() => props.onAddPlanItem?.(session.id)}>
                    Добавить проверку
                  </Button>
                )}
                {session.state === "PLANNED" && (
                  <Button onClick={() => props.onPrepare?.(session.id)}>Подготовить</Button>
                )}
                {session.state === "READY" && (
                  <Button onClick={() => props.onStart?.(session.id)}>Запустить</Button>
                )}
                {session.startedAt && (
                  <Button onClick={() => props.onReplace?.(session.id)}>
                    Создать связанную замену
                  </Button>
                )}
              </Stack>
            </Stack>
          ))}
        </Stack>
      </CardContent>
    </Card>
  );
}
