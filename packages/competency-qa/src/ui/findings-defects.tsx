import { useCallback, useEffect, useMemo, useState } from "react";

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  formatRuUiValue,
  Stack,
  TextField,
  Typography,
} from "@awp/platform-ui";

import type { QaBrowserApiContext } from "./intake.tsx";

interface Finding {
  readonly findingId: string;
  readonly sessionId: string;
  readonly state: string;
  readonly resourceVersion: number;
  readonly summary?: string;
  readonly classification?: string;
  readonly latestReviewRevisionRef?: Readonly<{ id: string; version: number; contentHash: string }>;
}
interface MembershipCollection {
  readonly findingId: string;
  readonly activeMembershipSetHash: string;
  readonly memberships: readonly Readonly<{
    membershipId: string;
    observationId: string;
    state: string;
  }>[];
}
interface Draft {
  readonly defectDraftId: string;
  readonly findingId: string;
  readonly state: string;
  readonly resourceVersion: number;
  readonly contentHash: string;
  readonly payload: Readonly<{ title: string; description: string }>;
  readonly approvalRef?: Readonly<{ id: string }>;
}
interface DefectLink {
  readonly defectLinkId: string;
  readonly findingId: string;
  readonly externalDisplayKey: string;
  readonly externalEntityId: string;
  readonly normalizedStatus: string;
}
interface Proposal {
  readonly proposalId: string;
  readonly proposalHash: string;
  readonly source: string;
  readonly fallbackReasonCode?: string;
  readonly title: string;
  readonly description: string;
  readonly expiresAt: string;
}

export type QaUs4FindingWorkspaceProps = QaBrowserApiContext &
  Readonly<{ workItemId?: string; permissions?: readonly string[] }>;

export function QaFindingsDefects(props: Readonly<QaUs4FindingWorkspaceProps>) {
  const [workItemId, setWorkItemId] = useState(props.workItemId);
  const [findings, setFindings] = useState<readonly Finding[]>([]);
  const [memberships, setMemberships] = useState<Readonly<Record<string, MembershipCollection>>>(
    {},
  );
  const [drafts, setDrafts] = useState<readonly Draft[]>([]);
  const [links, setLinks] = useState<readonly DefectLink[]>([]);
  const [proposal, setProposal] = useState<Proposal>();
  const [actionState, setActionState] = useState<string>();
  const [reason, setReason] = useState("Классификация и решение специалиста QA");
  const [notice, setNotice] = useState(
    "Решения по результатам используют последний ETag и точный хеш набора связей.",
  );
  const [busy, setBusy] = useState(false);
  const base = `/api/v1/workspaces/${props.workspaceId}/projects/${props.projectId}`;
  const request = useCallback(
    async (path: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      headers.set("authorization", `Bearer ${props.accessToken}`);
      headers.set("content-type", "application/json");
      return await fetch(`${props.apiUrl}${path}`, { ...init, headers });
    },
    [props.accessToken, props.apiUrl],
  );

  const load = useCallback(async () => {
    let selected = workItemId;
    if (!selected) {
      const backlog = await request(`${base}/qa/backlog`);
      if (!backlog.ok) throw new Error(`Не удалось обновить очередь: ${backlog.status}`);
      const body = (await backlog.json()) as Readonly<{
        items: readonly Readonly<{
          requestExtension: Readonly<{ workItemId: string; permissions?: readonly string[] }>;
        }>[];
      }>;
      selected = body.items[0]?.requestExtension.workItemId;
      setWorkItemId(selected);
    }
    if (!selected) return;
    const findingResponse = await request(`${base}/work-items/${selected}/qa/findings`);
    if (!findingResponse.ok)
      throw new Error(`Не удалось обновить результаты: ${findingResponse.status}`);
    const loaded = (await findingResponse.json()) as readonly Finding[];
    setFindings(loaded);
    const membershipEntries = await Promise.all(
      loaded.map(async (finding) => {
        const response = await request(
          `${base}/work-items/${selected}/qa/findings/${finding.findingId}/memberships`,
        );
        return [
          finding.findingId,
          response.ok ? ((await response.json()) as MembershipCollection) : undefined,
        ] as const;
      }),
    );
    setMemberships(
      Object.fromEntries(
        membershipEntries.filter(
          (entry): entry is readonly [string, MembershipCollection] => entry[1] !== undefined,
        ),
      ),
    );
    const draftGroups = await Promise.all(
      loaded.map(async (finding) => {
        const response = await request(
          `${base}/work-items/${selected}/qa/findings/${finding.findingId}/defect-drafts`,
        );
        return response.ok ? ((await response.json()) as readonly Draft[]) : [];
      }),
    );
    setDrafts(draftGroups.flat());
    const linkResponse = await request(`${base}/work-items/${selected}/qa/defect-links`);
    setLinks(linkResponse.ok ? ((await linkResponse.json()) as readonly DefectLink[]) : []);
  }, [base, request, workItemId]);
  useEffect(() => {
    let current = true;
    queueMicrotask(() => {
      if (current) void load().catch((error: unknown) => setNotice(String(error)));
    });
    return () => {
      current = false;
    };
  }, [load]);

  const run = useCallback(
    async (work: () => Promise<Response>) => {
      setBusy(true);
      try {
        const response = await work();
        const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        if (!response.ok) throw new Error(`${response.status}: ${JSON.stringify(body)}`);
        if (body.state === "PENDING_APPROVAL")
          setActionState(`Действие ${String(body.actionId)} · ожидает согласования`);
        await load();
        setNotice(
          "Команда сохранена; результаты, черновики и неизменяемые проекции связей с дефектами обновлены.",
        );
      } catch (error) {
        setNotice(`Не удалось выполнить команду: ${String(error)}`);
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  const classify = (finding: Finding, classification: string) => {
    const membership = memberships[finding.findingId];
    if (!workItemId || !membership) return;
    void run(
      async () =>
        await request(
          `${base}/work-items/${workItemId}/qa/findings/${finding.findingId}/classification`,
          {
            method: "PUT",
            headers: { "if-match": `W/"${finding.resourceVersion}"` },
            body: JSON.stringify({
              classification,
              reason,
              expectedCurrentReviewRef: finding.latestReviewRevisionRef ?? null,
              expectedMembershipSetHash: membership.activeMembershipSetHash,
            }),
          },
        ),
    );
  };
  const dispose = (finding: Finding, dispositionDecision: string) => {
    const membership = memberships[finding.findingId];
    if (!workItemId || !membership || !finding.latestReviewRevisionRef) return;
    void run(
      async () =>
        await request(
          `${base}/work-items/${workItemId}/qa/findings/${finding.findingId}/disposition`,
          {
            method: "PUT",
            headers: { "if-match": `W/"${finding.resourceVersion}"` },
            body: JSON.stringify({
              dispositionDecision,
              dispositionReason: reason,
              expectedReviewContentHash: finding.latestReviewRevisionRef!.contentHash,
              expectedMembershipSetHash: membership.activeMembershipSetHash,
            }),
          },
        ),
    );
  };
  const requestProposal = async (finding: Finding) => {
    if (!workItemId || !finding.latestReviewRevisionRef) return;
    const response = await request(
      `${base}/work-items/${workItemId}/qa/findings/${finding.findingId}/defect-draft-proposals`,
      {
        method: "POST",
        body: JSON.stringify({ frozenFindingReviewRef: finding.latestReviewRevisionRef }),
      },
    );
    if (!response.ok) throw new Error(`Не удалось подготовить предложение: ${response.status}`);
    setProposal((await response.json()) as Proposal);
  };
  const createDraft = (finding: Finding) => {
    if (!workItemId) return;
    void run(
      async () =>
        await request(
          `${base}/work-items/${workItemId}/qa/findings/${finding.findingId}/defect-drafts`,
          {
            method: "POST",
            headers: { "if-match": `W/"${finding.resourceVersion}"` },
            body: JSON.stringify(
              proposal
                ? {
                    source: proposal.source,
                    acceptedProposalRef: {
                      id: proposal.proposalId,
                      contentHash: proposal.proposalHash,
                    },
                  }
                : { source: "DETERMINISTIC_TEMPLATE" },
            ),
          },
        ),
    );
  };
  const reject = (draft: Draft) => {
    if (!workItemId) return;
    void run(
      async () =>
        await request(
          `${base}/work-items/${workItemId}/qa/defect-drafts/${draft.defectDraftId}/rejection`,
          {
            method: "POST",
            headers: { "if-match": `W/"${draft.resourceVersion}"` },
            body: JSON.stringify({ expectedContentHash: draft.contentHash, reason }),
          },
        ),
    );
  };
  const publish = (draft: Draft) => {
    if (!workItemId) return;
    void run(
      async () =>
        await request(
          `${base}/work-items/${workItemId}/qa/defect-drafts/${draft.defectDraftId}/publication`,
          {
            method: "POST",
            headers: { "if-match": `W/"${draft.resourceVersion}"` },
            body: JSON.stringify({ expectedResourceVersion: draft.resourceVersion }),
          },
        ),
    );
  };
  const approve = (draft: Draft) => {
    if (!workItemId || !draft.approvalRef) return;
    void run(
      async () =>
        await request(
          `${base}/work-items/${workItemId}/qa/defect-approvals/${draft.approvalRef!.id}/approve`,
          { method: "POST", body: "{}" },
        ),
    );
  };

  const proposalDiff = useMemo(() => {
    if (!proposal) return undefined;
    return `${proposal.source}${proposal.fallbackReasonCode ? ` · ${proposal.fallbackReasonCode}` : ""}\n+ ${proposal.title}\n+ ${proposal.description}`;
  }, [proposal]);

  return (
    <Card>
      <CardContent>
        <Stack spacing={2}>
          <Typography variant="h5">Результаты и точная публикация дефектов</Typography>
          <Alert severity={/(?:не удалось|ошиб|failed|error)/iu.test(notice) ? "error" : "info"}>
            {notice}
          </Alert>
          <TextField
            label="Обоснование решения специалиста"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          {actionState && (
            <Alert severity="warning">
              {actionState}; до обработки решение должен принять другой руководитель QA.
            </Alert>
          )}
          {proposalDiff && (
            <Box
              component="pre"
              sx={{ whiteSpace: "pre-wrap", bgcolor: "background.default", p: 2 }}
            >
              {proposalDiff}
            </Box>
          )}
          {findings.map((finding) => (
            <Stack
              key={finding.findingId}
              spacing={1}
              sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1, p: 2 }}
            >
              <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
                <Typography sx={{ flex: 1 }}>{finding.summary ?? finding.findingId}</Typography>
                <Chip label={formatRuUiValue(finding.state)} />
                <Chip variant="outlined" label={`ETag ${finding.resourceVersion}`} />
              </Stack>
              <Typography variant="body2">
                Хеш набора связей: {memberships[finding.findingId]?.activeMembershipSetHash ?? "—"}
              </Typography>
              <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
                {finding.state !== "FROZEN" && (
                  <Button
                    size="small"
                    disabled={
                      (!!props.permissions && !props.permissions.includes("qa.finding.classify")) ||
                      busy
                    }
                    onClick={() => classify(finding, "PRODUCT")}
                  >
                    Классифицировать как продуктовый
                  </Button>
                )}
                {finding.state === "CLASSIFIED" && (
                  <Button
                    size="small"
                    disabled={
                      (!!props.permissions && !props.permissions.includes("qa.finding.classify")) ||
                      busy
                    }
                    onClick={() => dispose(finding, "CREATE_DEFECT")}
                  >
                    Создать дефект
                  </Button>
                )}
                {finding.state === "CLASSIFIED" && (
                  <Button
                    size="small"
                    disabled={
                      (!!props.permissions &&
                        !props.permissions.includes("qa.finding.accept-risk")) ||
                      busy
                    }
                    onClick={() => dispose(finding, "ACCEPTED_RISK")}
                  >
                    Запросить принятие риска
                  </Button>
                )}
                {finding.state === "FROZEN" && (
                  <Button
                    size="small"
                    disabled={
                      (!!props.permissions && !props.permissions.includes("qa.defect.draft")) ||
                      busy
                    }
                    onClick={() =>
                      void requestProposal(finding).catch((error: unknown) =>
                        setNotice(String(error)),
                      )
                    }
                  >
                    Предложить формулировку
                  </Button>
                )}
                {finding.state === "FROZEN" && (
                  <Button
                    size="small"
                    disabled={
                      (!!props.permissions && !props.permissions.includes("qa.defect.draft")) ||
                      busy
                    }
                    onClick={() => createDraft(finding)}
                  >
                    Принять формулировку
                  </Button>
                )}
              </Stack>
            </Stack>
          ))}
          <Divider />
          <Typography variant="h6">Жизненный цикл черновика дефекта</Typography>
          {drafts.map((draft) => (
            <Stack
              key={draft.defectDraftId}
              direction={{ xs: "column", md: "row" }}
              spacing={1}
              sx={{ alignItems: { md: "center" } }}
            >
              <Typography sx={{ flex: 1 }}>
                {draft.payload.title} · {formatRuUiValue(draft.state)}
              </Typography>
              <Chip label={`ETag ${draft.resourceVersion}`} />
              {draft.state === "DRAFT" && (
                <Button
                  disabled={
                    (!!props.permissions && !props.permissions.includes("qa.defect.draft")) || busy
                  }
                  onClick={() => reject(draft)}
                >
                  Отклонить
                </Button>
              )}
              {draft.state === "DRAFT" && (
                <Button
                  variant="contained"
                  disabled={
                    (!!props.permissions && !props.permissions.includes("qa.defect.publish")) ||
                    busy
                  }
                  onClick={() => publish(draft)}
                >
                  Опубликовать
                </Button>
              )}
              {draft.state === "AWAITING_APPROVAL" && draft.approvalRef && (
                <Button
                  variant="contained"
                  color="secondary"
                  disabled={
                    (!!props.permissions && !props.permissions.includes("approval.decide")) || busy
                  }
                  onClick={() => approve(draft)}
                >
                  Согласовать как другой руководитель
                </Button>
              )}
            </Stack>
          ))}
          <Divider />
          <Typography variant="h6">Подтверждённые связи с дефектами</Typography>
          {links.length === 0 ? (
            <Typography color="text.secondary">
              Подтверждённых внешних дефектов пока нет.
            </Typography>
          ) : (
            links.map((link) => (
              <Stack key={link.defectLinkId} direction="row" spacing={1}>
                <Chip color="success" label={formatRuUiValue(link.normalizedStatus)} />
                <Typography>
                  {link.externalDisplayKey} · {link.externalEntityId}
                </Typography>
              </Stack>
            ))
          )}
          <Button onClick={() => void load()} disabled={busy}>
            Обновить точное состояние
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
}

export const qaUs4UiContribution = Object.freeze({
  key: "competency-qa.us4",
  componentRef: "qa.ui.us4-findings-defects",
  Component: QaFindingsDefects,
});
