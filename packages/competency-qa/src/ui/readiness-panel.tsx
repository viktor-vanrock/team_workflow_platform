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

import type { QaReadinessAssessment, QaReadinessSyncState } from "../domain/readiness.ts";

export function QaReadinessPanel(
  props: Readonly<{
    assessment?: QaReadinessAssessment;
    syncState: QaReadinessSyncState;
    canAssess?: boolean;
    canConfirm?: boolean;
    onAssess?: () => void;
    onConfirm?: () => void;
  }>,
) {
  return (
    <Card>
      <CardContent>
        <Stack spacing={2}>
          <Stack direction="row" spacing={1}>
            <Typography variant="h6">Критерии готовности (DoR)</Typography>
            <Chip label={formatRuUiValue(props.assessment?.state ?? "NOT_EVALUATED")} />
            <Chip label={formatRuUiValue(props.syncState)} />
          </Stack>
          {props.assessment?.blockers.map((blocker) => (
            <Alert severity="warning" key={blocker.code}>
              {formatRuUiValue(blocker.code)}: {blocker.remediation}
            </Alert>
          ))}
          <Stack direction="row" spacing={1}>
            {props.canAssess && <Button onClick={props.onAssess}>Оценить</Button>}
            {props.canConfirm && (
              <Button onClick={props.onConfirm} disabled={props.assessment?.state === "NEEDS_INFO"}>
                Подтвердить готовность
              </Button>
            )}
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}
