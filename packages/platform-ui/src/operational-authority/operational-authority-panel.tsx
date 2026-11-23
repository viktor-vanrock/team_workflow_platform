import { Alert, Card, CardContent, Chip, Stack, Typography } from "@mui/material";

import { formatRuUiValue } from "../localization/ru.ts";

export interface OperationalAuthorityPanelProps {
  readonly state: "PENDING" | "CONFIRMED" | "ERROR" | "CONFLICT";
  readonly externalDisplayKey?: string;
  readonly origin?: "PLATFORM_DRAFT" | "OPERATIONAL_IMPORT";
  readonly freshness?: "CURRENT" | "STALE" | "UNKNOWN";
  readonly completeness?: string;
  readonly safeReasonCode?: string;
}
export function OperationalAuthorityPanel(props: OperationalAuthorityPanelProps) {
  const severity =
    props.state === "ERROR" || props.state === "CONFLICT"
      ? "error"
      : props.state === "PENDING"
        ? "warning"
        : "success";
  return (
    <Card>
      <CardContent>
        <Stack spacing={1}>
          <Typography variant="h6">Операционный источник истины</Typography>
          <Stack direction="row" spacing={1}>
            <Chip label={formatRuUiValue(props.state)} />
            {props.externalDisplayKey && <Chip label={props.externalDisplayKey} />}{" "}
            {props.freshness && <Chip label={formatRuUiValue(props.freshness)} />}
          </Stack>
          <Alert severity={severity}>
            {props.state === "CONFIRMED"
              ? `Подтверждено авторитетным чтением${props.origin ? ` · ${formatRuUiValue(props.origin)}` : ""}`
              : formatRuUiValue(props.safeReasonCode ?? "Ожидается авторитетное подтверждение")}
          </Alert>
          {props.completeness && (
            <Typography variant="body2">Полнота: {formatRuUiValue(props.completeness)}</Typography>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}
