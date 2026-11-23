import { Alert, Card, CardContent, Stack, Typography } from "@mui/material";

export function OperationalConflictPanel(
  props: Readonly<{
    state: string;
    reasonCode: string;
    expectedRevision: string;
    observedRevision: string;
  }>,
) {
  return (
    <Card>
      <CardContent>
        <Stack spacing={1}>
          <Typography variant="h6">Операционный конфликт</Typography>
          <Alert severity="error">{props.reasonCode}</Alert>
          <Typography variant="body2">
            Ожидалась ревизия {props.expectedRevision}; получена {props.observedRevision}.
            Перезапись без проверки не выполнялась.
          </Typography>
        </Stack>
      </CardContent>
    </Card>
  );
}
