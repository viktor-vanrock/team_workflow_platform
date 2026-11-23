import { useEffect, useRef, useState } from "react";

import {
  Alert,
  Button,
  Card,
  CardContent,
  CircularProgress,
  formatRuDateTime,
  formatRuUiValue,
  Stack,
  TextField,
  Typography,
} from "@awp/platform-ui";

type Verification = Readonly<{
  manifestRef: { id: string; version: number };
  integrity: "PASS" | "FAIL";
  signature: "PASS" | "FAIL" | "LEGACY_INTEGRITY_ONLY";
  keyStatus: string;
  verifiedAt: string;
}>;

export function ProjectEvidenceRoute(
  props: Readonly<{ apiUrl: string; accessToken: string; workspaceId: string; projectId: string }>,
) {
  const [manifestId, setManifestId] = useState("");
  const [revision, setRevision] = useState("1");
  const [packageId, setPackageId] = useState("");
  const [reason, setReason] = useState("");
  const [verification, setVerification] = useState<Verification>();
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const active = useRef<AbortController | undefined>(undefined);
  const exportRequest = useRef<Readonly<{ input: string; key: string }> | undefined>(undefined);
  const base = `${props.apiUrl}/v1/workspaces/${props.workspaceId}/projects/${props.projectId}/evidence`;
  useEffect(() => {
    active.current?.abort();
    exportRequest.current = undefined;
    let current = true;
    queueMicrotask(() => {
      if (!current) return;
      setVerification(undefined);
      setError(undefined);
      setNotice(undefined);
      setBusy(false);
      setManifestId("");
      setPackageId("");
    });
    return () => {
      current = false;
      active.current?.abort();
    };
  }, [props.workspaceId, props.projectId, props.accessToken]);

  async function api<T>(suffix: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${props.accessToken}`);
    headers.set("content-type", "application/json");
    const response = await fetch(`${base}/${suffix}`, { ...init, headers, cache: "no-store" });
    const value: unknown = await response.json();
    if (!response.ok) {
      const code = value && typeof value === "object" && "code" in value ? value.code : undefined;
      throw new Error(
        code === "EVIDENCE_STEP_UP_REQUIRED"
          ? "Перед экспортом подтверждающих материалов пройдите усиленную аутентификацию."
          : response.status === 401 || response.status === 403
            ? "Текущий сеанс не разрешает эту операцию."
            : response.status === 404
              ? "Подтверждающие материалы недоступны в этом проекте."
              : response.status === 422
                ? "Результат проверки или опубликованная политика не разрешает экспорт."
                : "Подтверждающие материалы временно недоступны. Повторите попытку.",
      );
    }
    return value as T;
  }
  async function verify() {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    setVerification(undefined);
    try {
      const result = await api<Verification>(
        `manifests/${encodeURIComponent(manifestId.trim())}/verify?revision=${encodeURIComponent(revision)}`,
        { method: "POST", signal: controller.signal },
      );
      if (!controller.signal.aborted) setVerification(result);
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(
          cause instanceof Error ? cause.message : "Не удалось проверить подтверждающие материалы.",
        );
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  async function exportEvidence() {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const id = encodeURIComponent(packageId.trim());
      const current = await api<{ version: number }>(`packages/${id}`, {
        signal: controller.signal,
      });
      const options = await api<{ redactionPolicyRef: unknown }>("export-options", {
        signal: controller.signal,
      });
      const body = JSON.stringify({
        packageVersion: current.version,
        redactionPolicyRef: options.redactionPolicyRef,
        format: "JSON",
        reason: reason.trim(),
      });
      const input = `${id}:${body}`;
      if (exportRequest.current?.input !== input)
        exportRequest.current = { input, key: crypto.randomUUID() };
      const receipt = await api<{ commandId: string }>(`packages/${id}/exports`, {
        method: "POST",
        signal: controller.signal,
        headers: { "idempotency-key": exportRequest.current.key },
        body,
      });
      const payload = await api<unknown>(`exports/${encodeURIComponent(receipt.commandId)}`, {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `evidence-${receipt.commandId}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice("Проверенные метаданные скачаны, экспорт записан в журнал аудита.");
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(
          cause instanceof Error
            ? cause.message
            : "Не удалось экспортировать подтверждающие материалы.",
        );
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <Stack component="main" spacing={3} sx={{ maxWidth: 900, mx: "auto", p: 3 }}>
      <Typography variant="h4">Целостность подтверждающих материалов</Typography>
      <Card>
        <CardContent>
          <Stack
            component="form"
            spacing={2}
            onSubmit={(event) => {
              event.preventDefault();
              void verify();
            }}
          >
            <Typography variant="h6">Проверить подписанную ревизию</Typography>
            <TextField
              label="ID манифеста"
              value={manifestId}
              required
              onChange={(event) => setManifestId(event.target.value)}
            />
            <TextField
              label="Ревизия"
              type="number"
              value={revision}
              required
              onChange={(event) => setRevision(event.target.value)}
            />
            <Button
              type="submit"
              variant="contained"
              disabled={busy || !manifestId.trim() || !/^[1-9][0-9]*$/u.test(revision)}
            >
              Проверить материалы
            </Button>
          </Stack>
        </CardContent>
      </Card>
      {verification && (
        <Alert
          severity={
            verification.integrity === "PASS" && verification.signature === "PASS"
              ? "success"
              : "warning"
          }
        >
          Ревизия {verification.manifestRef.version}: целостность —{" "}
          {formatRuUiValue(verification.integrity)}, подпись —{" "}
          {formatRuUiValue(verification.signature)}, ключ —{" "}
          {formatRuUiValue(verification.keyStatus)}. Проверено:{" "}
          {formatRuDateTime(verification.verifiedAt)}.
        </Alert>
      )}
      <Card>
        <CardContent>
          <Stack
            component="form"
            spacing={2}
            onSubmit={(event) => {
              event.preventDefault();
              void exportEvidence();
            }}
          >
            <Typography variant="h6">Экспортировать проверенные метаданные пакета</Typography>
            <Typography color="text.secondary">
              Перед экспортом проверяются текущая политика проекта и все подписи пакета. Требуется
              усиленная аутентификация.
            </Typography>
            <TextField
              label="ID пакета подтверждающих материалов"
              value={packageId}
              required
              onChange={(event) => setPackageId(event.target.value)}
            />
            <TextField
              label="Причина экспорта"
              value={reason}
              required
              onChange={(event) => setReason(event.target.value)}
            />
            <Button
              type="submit"
              variant="contained"
              disabled={busy || !packageId.trim() || !reason.trim()}
            >
              Экспортировать проверенные материалы
            </Button>
          </Stack>
        </CardContent>
      </Card>
      {busy && <CircularProgress aria-label="Обработка подтверждающих материалов" />}
      {error && <Alert severity="error">{error}</Alert>}
      {notice && <Alert severity="success">{notice}</Alert>}
    </Stack>
  );
}
