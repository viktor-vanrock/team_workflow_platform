import { Card, CardContent, Chip, formatRuUiValue, Stack, Typography } from "@awp/platform-ui";

import type { QaRequiredSessionPlanHeader } from "../domain/required-session-plan.ts";

export function QaRequiredSessionPlan(props: Readonly<{ plan: QaRequiredSessionPlanHeader }>) {
  const current = props.plan.revisions.at(-1);
  return (
    <Card>
      <CardContent>
        <Stack spacing={1}>
          <Typography variant="h6">План обязательных сеансов</Typography>
          <Chip label={current ? `v${current.version}` : "Не опубликован"} />
          {current?.requirements.map((requirement) => (
            <Typography key={requirement.id}>
              {requirement.ordinal}. {formatRuUiValue(requirement.requirementKey)} ·{" "}
              {formatRuUiValue(requirement.mode)} · минимум {requirement.minimumSessionCount} ·{" "}
              {formatRuUiValue(requirement.resolution)}
            </Typography>
          ))}
        </Stack>
      </CardContent>
    </Card>
  );
}
