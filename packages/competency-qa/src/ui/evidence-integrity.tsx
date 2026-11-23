import {
  Alert,
  Button,
  Card,
  CardContent,
  Chip,
  formatRuUiValue,
  Stack,
  Typography,
} from "@awp/platform-ui";

export interface EvidenceIntegrityView {
  readonly revisions: readonly Readonly<{
    id: string;
    version: number;
    kind: string;
    signatureStatus: "VALID" | "INVALID" | "KEY_UNAVAILABLE";
    predecessorId?: string;
  }>[];
  readonly artifacts: readonly Readonly<{
    id: string;
    state: "AVAILABLE" | "EXPIRED" | "QUARANTINED" | "UNAVAILABLE";
    checksum: string;
  }>[];
  readonly integrityMode: "SIGNED_V2" | "LEGACY_INTEGRITY_ONLY";
  readonly canExport: boolean;
}

export function EvidenceIntegrityWorkspace({
  view,
  onExport,
}: Readonly<{ view: EvidenceIntegrityView; onExport: () => void }>) {
  return (
    <Stack spacing={2} aria-label="Целостность подтверждающих материалов">
      <Typography variant="h4">Целостность подтверждающих материалов</Typography>
      {view.integrityMode === "LEGACY_INTEGRITY_ONLY" && (
        <Alert severity="warning">
          Устаревшие материалы защищены только хешем и не учитываются в критериях подписанного
          пилота.
        </Alert>
      )}
      <Card>
        <CardContent>
          <Stack spacing={1}>
            <Typography variant="h6">История ревизий</Typography>
            {view.revisions.map((revision) => (
              <Stack direction="row" spacing={1} key={revision.id}>
                <Typography>
                  Ревизия {revision.version} · {formatRuUiValue(revision.kind)}
                  {revision.predecessorId ? ` · предыдущая ${revision.predecessorId}` : ""}
                </Typography>
                <Chip
                  color={revision.signatureStatus === "VALID" ? "success" : "error"}
                  label={formatRuUiValue(revision.signatureStatus)}
                />
              </Stack>
            ))}
          </Stack>
        </CardContent>
      </Card>
      <Card>
        <CardContent>
          <Stack spacing={1}>
            <Typography variant="h6">Срок хранения артефактов</Typography>
            {view.artifacts.map((artifact) => (
              <Typography key={artifact.id}>
                {artifact.id} · {formatRuUiValue(artifact.state)} · контрольная сумма{" "}
                {artifact.checksum}
              </Typography>
            ))}
          </Stack>
        </CardContent>
      </Card>
      <Button
        disabled={
          !view.canExport ||
          view.revisions.some(({ signatureStatus }) => signatureStatus !== "VALID")
        }
        onClick={onExport}
      >
        Экспортировать проверенные материалы
      </Button>
    </Stack>
  );
}
