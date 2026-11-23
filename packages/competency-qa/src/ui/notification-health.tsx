import {
  Alert,
  DeliveryHealthCard,
  type DeliveryHealthState,
  Stack,
  Typography,
} from "@awp/platform-ui";

export interface QaNotificationHealthView {
  readonly id: string;
  readonly state: DeliveryHealthState;
  readonly attempts: readonly Readonly<{ attempt: number; outcome?: string }>[];
  readonly createdAt?: string;
  readonly reasonCode?: string;
}
export function QaNotificationHealth({
  value,
  connectionState,
}: Readonly<{
  value?: QaNotificationHealthView;
  connectionState?: "HEALTHY" | "DEGRADED" | "UNAVAILABLE" | "UNKNOWN";
}>) {
  if (!value)
    return (
      <Alert severity="info">
        Выберите намерение уведомления, чтобы проверить сохранённое состояние доставки.
      </Alert>
    );
  return (
    <Stack spacing={2}>
      <Typography variant="h5">Состояние доставки уведомления</Typography>
      <DeliveryHealthCard
        state={value.state}
        attemptCount={value.attempts.length}
        {...(connectionState ? { connectionState } : {})}
        {...(value.reasonCode ? { reasonCode: value.reasonCode } : {})}
        {...(value.createdAt ? { updatedAt: value.createdAt } : {})}
      />
      <Alert severity="info">
        Здесь показаны только хеши и типизированные состояния. Тела запросов поставщика, учётные
        данные и токены обратных вызовов скрыты.
      </Alert>
    </Stack>
  );
}
export const qaNotificationHealthUiContribution = Object.freeze({
  key: "competency-qa.notification-health",
  componentRef: "qa.ui.notification-health",
  Component: QaNotificationHealth,
});
