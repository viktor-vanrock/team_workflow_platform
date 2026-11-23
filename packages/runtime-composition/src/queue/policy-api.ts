import type { DataSource } from "typeorm";

import type { QueuePolicyNeutralView } from "@awp/platform-core";

import type { QueueHttpAuthority } from "./http-authority.ts";
import type { QueueRuntimeRequest, QueueRuntimeResponse } from "./query-api.ts";
import { PostgresBusinessCalendarRevisionReader } from "./temporal-transition-worker.ts";

type Row = Readonly<Record<string, unknown>>;
const rows = (value: unknown): readonly Row[] => {
  const raw = value as readonly unknown[];
  if (!Array.isArray(raw)) return Object.freeze([]);
  return (Array.isArray(raw[0]) ? raw[0] : raw) as readonly Row[];
};
const json = <T>(value: unknown): T =>
  typeof value === "string" ? (JSON.parse(value) as T) : (value as T);

export class RuntimeQueuePoliciesApi {
  constructor(
    private readonly source: DataSource,
    private readonly authority: QueueHttpAuthority,
  ) {}

  async policy(request: QueueRuntimeRequest, workspaceId: string, response: QueueRuntimeResponse) {
    await this.authority.workspace(request, workspaceId, "queue.policy.read");
    const found = rows(
      await this.source.query(
        `SELECT revision.safe_body FROM workspace_queue_policy_view_heads head
         JOIN workspace_queue_policy_view_revisions revision
           ON revision.workspace_id=head.workspace_id AND revision.policy_view_revision_id=head.current_revision_id
        WHERE head.workspace_id=$1 ORDER BY head.updated_at DESC LIMIT 1`,
        [workspaceId],
      ),
    );
    if (!found[0]) throw new Error("QUEUE_POLICY_NOT_CONFIGURED");
    const view = json<QueuePolicyNeutralView>(found[0].safe_body);
    if (view.workspaceId !== workspaceId) throw new Error("QUEUE_POLICY_NOT_CONFIGURED");
    response.setHeader("ETag", `"${view.policyViewRef.semanticHash}"`);
    return view;
  }

  async calendar(
    request: QueueRuntimeRequest,
    workspaceId: string,
    calendarRevisionId: string,
    response: QueueRuntimeResponse,
  ) {
    await this.authority.workspace(request, workspaceId, "queue.calendar.read");
    const refs = rows(
      await this.source.query(
        `SELECT calendar_id,revision_number,semantic_hash FROM workspace_business_calendar_revisions
        WHERE workspace_id=$1 AND calendar_revision_id=$2`,
        [workspaceId, calendarRevisionId],
      ),
    );
    if (!refs[0]) throw new Error("BUSINESS_CALENDAR_NOT_FOUND");
    const calendar = await new PostgresBusinessCalendarRevisionReader(this.source).read(
      workspaceId,
      {
        id: String(refs[0].calendar_id),
        version: Number(refs[0].revision_number),
        semanticHash: String(refs[0].semantic_hash) as `sha256:${string}`,
      },
    );
    if (!calendar) throw new Error("BUSINESS_CALENDAR_NOT_FOUND");
    response.setHeader("ETag", `"${calendar.semanticHash}"`);
    return calendar;
  }
}
