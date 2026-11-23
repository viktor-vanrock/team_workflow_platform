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

export interface EvidenceReviewLink {
  readonly evidenceArtifactLinkId: string;
  readonly availability: "AVAILABLE" | "EXPIRED";
  readonly artifactRef?: Readonly<{ mediaType?: string; sizeBytes?: number }>;
}
export interface EvidenceReviewManifest {
  readonly manifestId: string;
  readonly resourceVersion: number;
  readonly latestRevisionRef?: Readonly<{ id: string; version: number; contentHash: string }>;
  readonly latestAdjudicativeRevisionRef?: Readonly<{
    id: string;
    version: number;
    contentHash: string;
  }>;
  readonly postCloseCorrectionMarkers?: readonly Readonly<{
    marker_id?: string;
    markerId?: string;
  }>[];
  readonly revisions: readonly Readonly<{
    version: number;
    kind: string;
    sessionOutcome: string;
    contentHash: string;
  }>[];
}

export function QaEvidenceReview(
  props: Readonly<{
    sessionState?: string;
    sessionOutcome?: string;
    evidence: readonly EvidenceReviewLink[];
    manifests: readonly EvidenceReviewManifest[];
    busy?: boolean;
    notice?: string;
    onPublish(): void;
    onReload(): void;
  }>,
) {
  return (
    <Card>
      <CardContent>
        <Stack spacing={2}>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
            <Typography variant="h5">Проверка подтверждающих материалов</Typography>
            <Chip
              label={props.sessionState ? formatRuUiValue(props.sessionState) : "Сеанс не выбран"}
            />
            {props.sessionOutcome && (
              <Chip color="success" label={formatRuUiValue(props.sessionOutcome)} />
            )}
            <Button size="small" onClick={props.onReload}>
              Обновить
            </Button>
          </Stack>
          {props.notice && (
            <Alert
              severity={/(?:failed|error|не удалось|ошиб)/iu.test(props.notice) ? "error" : "info"}
            >
              {props.notice}
            </Alert>
          )}
          <Typography>Ссылок на материалы: {props.evidence.length}</Typography>
          {props.evidence.map((link) => (
            <Stack key={link.evidenceArtifactLinkId} direction="row" spacing={1}>
              <Typography sx={{ flex: 1 }}>{link.evidenceArtifactLinkId}</Typography>
              <Chip
                size="small"
                color={link.availability === "AVAILABLE" ? "success" : "warning"}
                label={formatRuUiValue(link.availability)}
              />
            </Stack>
          ))}
          {props.manifests.map((manifest) => (
            <Stack
              key={manifest.manifestId}
              spacing={0.5}
              sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1, p: 2 }}
            >
              <Typography>Подписанный манифест · ETag {manifest.resourceVersion}</Typography>
              {manifest.latestRevisionRef && manifest.latestAdjudicativeRevisionRef && (
                <Alert
                  severity={
                    manifest.latestRevisionRef.id === manifest.latestAdjudicativeRevisionRef.id
                      ? "info"
                      : "warning"
                  }
                >
                  Последняя версия: v{manifest.latestRevisionRef.version}; версия решения: v
                  {manifest.latestAdjudicativeRevisionRef.version}. Служебная история после закрытия
                  не меняет указатель решения.
                </Alert>
              )}
              {manifest.revisions.map((revision) => (
                <Typography key={revision.version} variant="body2">
                  v{revision.version} · {formatRuUiValue(revision.kind)} ·{" "}
                  {formatRuUiValue(revision.sessionOutcome)} · {revision.contentHash.slice(0, 20)}…
                </Typography>
              ))}
              {(manifest.postCloseCorrectionMarkers?.length ?? 0) > 0 && (
                <Typography variant="body2">
                  Метки человека после закрытия: {manifest.postCloseCorrectionMarkers!.length}
                </Typography>
              )}
            </Stack>
          ))}
          <Button
            variant="contained"
            disabled={props.busy || props.sessionState !== "REVIEW_REQUIRED"}
            onClick={props.onPublish}
          >
            Подписать проверку с результатом «Пройдено»
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
}
