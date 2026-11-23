import { dummyDetailContribution } from "@awp/competency-dummy";
import { Alert, Box, Chip, Stack, Typography } from "@awp/platform-ui";

const fixture = {
  id: "preview",
  workspaceId: "local-functional",
  projectId: "ALPHA",
  workItemId: "preview",
  sampleName: "Ядро расширения",
  message: "Статический пример подробного представления",
  history: [],
  rowVersion: 1,
  createdAt: new Date(),
} as const;

export function WorkItemDetailRoute() {
  const Detail = dummyDetailContribution.Component;
  return (
    <Box sx={{ p: 3 }}>
      <Stack spacing={2}>
        <Alert severity="warning">ЛОКАЛЬНАЯ РАЗРАБОТКА</Alert>
        <Stack direction="row" spacing={1}>
          <Typography variant="h4">Рабочая задача</Typography>
          <Chip label="dummy.request@1.0.0" />
        </Stack>
        <Detail workItemId="preview" data={fixture} />
      </Stack>
    </Box>
  );
}
