import {
  blackOrder,
  Box,
  Button,
  Card,
  CardContent,
  OrderSeal,
  Stack,
  Typography,
} from "@awp/platform-ui";

import { canVisit, type LocalSession, personaDescriptions, sections } from "./navigation.ts";

const steps = [
  {
    numeral: "I",
    title: "Запрос",
    text: "Опишите задачу, проверьте резюме и подтвердите отправку.",
  },
  {
    numeral: "II",
    title: "Проверки",
    text: "Команда QA готовит план, выполняет проверки и сохраняет материалы.",
  },
  {
    numeral: "III",
    title: "Заключение",
    text: "Уполномоченный участник команды подписывает итоговое заключение.",
  },
];

export function WorkspaceHome({
  session,
  help = false,
}: Readonly<{ session: LocalSession; help?: boolean }>) {
  const available = sections.filter(
    (section) => section.path !== "/" && section.path !== "/help" && canVisit(section, session),
  );
  return (
    <Stack spacing={3}>
      <Card>
        <CardContent>
          <Stack
            direction="row"
            sx={{
              justifyContent: "space-between",
              gap: 1,
              flexWrap: "wrap",
              color: "text.secondary",
              fontSize: 11,
            }}
          >
            <span>QA / Все проекты</span>
            <span>Работа с запросами</span>
          </Stack>
          <Typography component="h2" variant="h4" sx={{ mt: "22px", mb: "10px", maxWidth: 420 }}>
            {help ? "Как устроена работа" : "От запроса — к результату проверки"}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: "24px" }}>
            Опишите, что нужно проверить. Команда QA подготовит проверки, сохранит результаты и даст
            итоговое заключение.
          </Typography>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: 1,
              mb: "24px",
            }}
          >
            {steps.map((step, index) => (
              <Box
                key={step.numeral}
                sx={{
                  position: "relative",
                  "&::after":
                    index < steps.length - 1
                      ? {
                          content: '""',
                          position: "absolute",
                          height: "1px",
                          left: 30,
                          right: 0,
                          top: 10,
                          background: "linear-gradient(90deg, #706050, #363035)",
                        }
                      : {},
                }}
              >
                <Typography
                  sx={{
                    fontFamily: blackOrder.headingFont,
                    fontWeight: 500,
                    fontSize: 20,
                    color: blackOrder.metal,
                    lineHeight: 1,
                  }}
                >
                  {step.numeral}
                </Typography>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: "block", mt: "6px" }}
                >
                  {step.title}
                </Typography>
              </Box>
            ))}
          </Box>
          <Stack direction="row" spacing={1.25} sx={{ alignItems: "center", mb: 0.5 }}>
            <Typography sx={{ fontSize: 11, letterSpacing: 1.5, color: "text.secondary" }}>
              РАЗДЕЛЫ РАБОТЫ
            </Typography>
            <Box sx={{ flex: 1, height: "1px", bgcolor: "divider" }} />
          </Stack>
          {available.map((section) => (
            <Box
              key={section.path}
              sx={{
                display: "flex",
                gap: 2,
                alignItems: "center",
                borderBottom: "1px solid #423b3a",
                py: 0,
                minHeight: 44,
              }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontWeight: 500, fontSize: 12 }}>{section.label}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {section.description}
                </Typography>
              </Box>
              <Button
                href={section.path}
                sx={{ fontSize: 11, whiteSpace: "nowrap", color: "#dcb6a1", flexShrink: 0 }}
              >
                Перейти →
              </Button>
            </Box>
          ))}
          <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", mt: "22px" }}>
            <OrderSeal />
            <Box>
              <Typography variant="caption" color="text.secondary">
                Ваша роль и проект
              </Typography>
              <Typography variant="body2">
                {personaDescriptions[session.persona.key] ??
                  "Доступные действия определены вашей ролью и правами в проекте."}
              </Typography>
            </Box>
          </Stack>
        </CardContent>
      </Card>
      {help && (
        <Card>
          <CardContent>
            <Typography component="h2" variant="h4" sx={{ mb: 2 }}>
              Три этапа работы
            </Typography>
            <Stack spacing={2}>
              {steps.map((step) => (
                <Box key={step.numeral}>
                  <Typography variant="h5" component="h3">
                    {step.numeral} · {step.title}
                  </Typography>
                  <Typography color="text.secondary">{step.text}</Typography>
                </Box>
              ))}
            </Stack>
            <Typography sx={{ mt: 3 }}>
              Заключение QA описывает результат проверки. Решение о выпуске принимается отдельно.
            </Typography>
          </CardContent>
        </Card>
      )}
      {help && (
        <Card>
          <CardContent>
            <Typography component="h2" variant="h4" sx={{ mb: 2 }}>
              Что означают состояния
            </Typography>
            <Stack spacing={2}>
              <Typography>
                <strong>Черновик</strong> — сохранён для проверки, но ещё не отправлен в работу.
              </Typography>
              <Typography>
                <strong>Отправляется</strong> — система обрабатывает запрос. Проверьте его
                состояние, прежде чем отправлять что-либо повторно.
              </Typography>
              <Typography>
                <strong>Статус в Jira</strong> — где запрос находится в рабочем процессе.{" "}
                <strong>Готовность QA</strong> — достаточно ли сведений и ресурсов для начала
                проверок.
              </Typography>
              <Typography>
                <strong>Проверки</strong> — отдельные ручные или автоматические сеансы.{" "}
                <strong>Материалы</strong> — результаты выполнения и подтверждающие сведения.
              </Typography>
              <Typography>
                <strong>Нет доступа</strong> — текущая роль не имеет нужного разрешения. Смените
                роль или обратитесь к владельцу проекта.
              </Typography>
              <Typography color="text.secondary">
                Чтобы посмотреть другой сценарий, нажмите «Сменить роль» в верхней панели. Сервер
                определяет, какие разделы и действия доступны.
              </Typography>
            </Stack>
          </CardContent>
        </Card>
      )}
    </Stack>
  );
}
