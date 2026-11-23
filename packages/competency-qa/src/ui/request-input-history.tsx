import { Card, CardContent, Chip, formatRuUiValue, Stack, Typography } from "@awp/platform-ui";

import type { QaRequestInputRevision } from "../domain/qa-request-input-revision.ts";

export function QaRequestInputHistory(
  props: Readonly<{ revisions: readonly QaRequestInputRevision[] }>,
) {
  return (
    <Card>
      <CardContent>
        <Stack spacing={1}>
          <Typography variant="h6">История входных данных запроса</Typography>
          {props.revisions.map((revision) => (
            <Stack key={revision.inputRevisionId} direction="row" spacing={1}>
              <Chip label={`v${revision.version}`} />
              <Typography>
                {formatRuUiValue(revision.changeReasonCode)}
                {revision.changeReason ? ` · ${revision.changeReason}` : ""}
              </Typography>
            </Stack>
          ))}
        </Stack>
      </CardContent>
    </Card>
  );
}
