import { Alert, Card, CardContent, Chip, Stack, Typography } from "@mui/material";

import { formatRuDateTime, formatRuUiValue } from "../localization/ru.ts";

export type DeliveryHealthState =
  | "QUEUED"
  | "DELIVERING"
  | "LOOKUP_REQUIRED"
  | "DELIVERED"
  | "FAILED_RETRYABLE"
  | "FAILED_FINAL"
  | "AMBIGUOUS"
  | "EXPIRED";
const severity = (state: DeliveryHealthState) =>
  state === "DELIVERED"
    ? "success"
    : state === "QUEUED" || state === "DELIVERING"
      ? "info"
      : "warning";

export function DeliveryHealthCard(
  props: Readonly<{
    state: DeliveryHealthState;
    attemptCount: number;
    connectionState?: "HEALTHY" | "DEGRADED" | "UNAVAILABLE" | "UNKNOWN";
    reasonCode?: string;
    updatedAt?: string;
  }>,
) {
  return (
    <Card variant="outlined">
      <CardContent>
        <Stack spacing={1}>
          <Stack direction="row" spacing={1}>
            <Chip
              label={`Доставка: ${formatRuUiValue(props.state)}`}
              color={props.state === "DELIVERED" ? "success" : "warning"}
            />
            <Chip label={`Подключение: ${formatRuUiValue(props.connectionState ?? "UNKNOWN")}`} />
          </Stack>
          <Typography>Попыток: {props.attemptCount}</Typography>
          {props.updatedAt && (
            <Typography variant="body2">Обновлено: {formatRuDateTime(props.updatedAt)}</Typography>
          )}
          {props.state === "LOOKUP_REQUIRED" || props.state === "AMBIGUOUS" ? (
            <Alert severity={severity(props.state)}>
              Результат внешнего действия не определён. Восстановление допускает только проверку
              состояния; автоматическая повторная отправка запрещена.
            </Alert>
          ) : null}
          {props.reasonCode && (
            <Typography variant="body2">Причина: {formatRuUiValue(props.reasonCode)}</Typography>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}
