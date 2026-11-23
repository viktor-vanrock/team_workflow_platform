import { defineWorkItemDetailContribution } from "@awp/competency-ui-sdk";
import { Card, CardContent, Stack, Typography } from "@awp/platform-ui";

import type { DummyRequest } from "../domain/dummy-request.ts";

function DummyDetail({ data }: Readonly<{ workItemId: string; data: DummyRequest }>) {
  return (
    <Card>
      <CardContent>
        <Stack spacing={1}>
          <Typography variant="h6">Dummy request</Typography>
          <Typography>{data.sampleName}</Typography>
          <Typography color="text.secondary">{data.message}</Typography>
          <Typography variant="caption">
            Definition: dummy.request@1.0.0 · history {data.history.length}
          </Typography>
        </Stack>
      </CardContent>
    </Card>
  );
}

export const dummyDetailContribution = defineWorkItemDetailContribution<DummyRequest>({
  slot: "WORK_ITEM_DETAIL_TAB",
  routeSegment: "sample",
  label: "Sample",
  componentRef: "dummy.ui.detail",
  Component: DummyDetail,
});
