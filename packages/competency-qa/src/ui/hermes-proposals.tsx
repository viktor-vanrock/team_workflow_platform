import {
  Alert,
  Card,
  CardContent,
  Chip,
  formatRuUiValue,
  Stack,
  Typography,
} from "@awp/platform-ui";

export interface HermesProposalView {
  readonly id: string;
  readonly revision: number;
  readonly state: "CURRENT" | "STALE" | "SUPERSEDED" | "ACCEPTED";
  readonly contentHash: string;
  readonly sourceFactSetHash: string;
  readonly content: Readonly<Record<string, unknown>>;
}
export function QaHermesProposals({ items }: Readonly<{ items: readonly HermesProposalView[] }>) {
  return (
    <Stack spacing={2}>
      <Alert severity="warning">
        Hermes формирует только объяснимые предложения. При изменении фактов они автоматически
        становятся устаревшими.
      </Alert>
      {items.map((item) => (
        <Card key={`${item.id}:${item.revision}`}>
          <CardContent>
            <Stack spacing={1}>
              <Stack direction="row" spacing={1}>
                <Chip
                  label={formatRuUiValue(item.state)}
                  color={item.state === "CURRENT" ? "success" : "warning"}
                />
                <Chip label={`ревизия ${item.revision}`} />
              </Stack>
              <Typography variant="h6">Предложение {item.id}</Typography>
              <Typography variant="body2">содержимое {item.contentHash}</Typography>
              <Typography variant="body2">факты {item.sourceFactSetHash}</Typography>
              <Typography>
                {String(item.content.explanation ?? "Объяснение отсутствует")}
              </Typography>
            </Stack>
          </CardContent>
        </Card>
      ))}
    </Stack>
  );
}
export const qaHermesProposalsUiContribution = Object.freeze({
  key: "competency-qa.hermes-proposals",
  componentRef: "qa.ui.hermes-proposals",
  Component: QaHermesProposals,
});
