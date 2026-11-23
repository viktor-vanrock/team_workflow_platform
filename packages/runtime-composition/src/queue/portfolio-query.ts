import type { DataSource } from "typeorm";

import { type JsonValue, sha256 } from "@awp/platform-contracts";
import {
  addBusinessSeconds,
  authorizedProjectSetHash,
  type BusinessCalendarRevision,
  businessSecondsBetween,
  DenyByDefaultAuthorizationPolicy,
  type ProjectQueuePolicyFacet,
  type QueueAlgorithmRef,
  type QueueEntryReadToken,
  type QueueOrderEntry,
  type QueueVersionedContentRef,
  type SlaClockSegmentRevision,
  type SlaClockTransition,
  type SlaGoal,
  sortQueueOrderEntries,
} from "@awp/platform-core";
import { TypeOrmScopedAccessRepository } from "@awp/platform-persistence-typeorm";

import { applyQueueOrderMove } from "./order-service.ts";

type Row = Readonly<Record<string, unknown>>;
type QueueEntry = Readonly<Record<string, unknown>>;

export interface QueueCursor {
  readonly schemaVersion: "queue-cursor@1.0.0";
  readonly principalId: string;
  readonly workspaceId: string;
  readonly authorizedProjectSetHash: `sha256:${string}`;
  readonly normalizedQueryHash: `sha256:${string}`;
  readonly comparatorRef: "queue-order@1.0.0";
  readonly projectionGeneration: `sha256:${string}`;
  readonly asOf: string;
  readonly boundaryOrdinal: number;
}

const hashPattern = /^sha256:[a-f0-9]{64}$/u;

export function encodeQueueCursor(cursor: QueueCursor): string {
  if (
    !cursor.principalId ||
    !cursor.workspaceId ||
    !hashPattern.test(cursor.authorizedProjectSetHash) ||
    !hashPattern.test(cursor.normalizedQueryHash) ||
    !hashPattern.test(cursor.projectionGeneration) ||
    !Number.isFinite(Date.parse(cursor.asOf)) ||
    !Number.isSafeInteger(cursor.boundaryOrdinal) ||
    cursor.boundaryOrdinal < 1
  ) {
    throw new Error("QUEUE_CURSOR_INVALID");
  }
  const encoded = `q1.${Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url")}`;
  if (encoded.length > 4096) throw new Error("QUEUE_CURSOR_TOO_LARGE");
  return encoded;
}

export function decodeQueueCursor(value: string): QueueCursor {
  if (!value.startsWith("q1.") || value.length < 20 || value.length > 4096)
    throw new Error("QUEUE_CURSOR_INVALID");
  let parsed: QueueCursor;
  try {
    parsed = JSON.parse(Buffer.from(value.slice(3), "base64url").toString("utf8")) as QueueCursor;
  } catch {
    throw new Error("QUEUE_CURSOR_INVALID");
  }
  if (parsed.schemaVersion !== "queue-cursor@1.0.0") throw new Error("QUEUE_CURSOR_INVALID");
  encodeQueueCursor(parsed);
  return Object.freeze({ ...parsed });
}

export function queuePageEtag(page: Readonly<Record<string, unknown>>): `"sha256:${string}"` {
  return `"${sha256(page as JsonValue)}"`;
}

export function validateQueuePageRepresentation(
  page: Readonly<Record<string, unknown>>,
  expected: Readonly<{
    workspaceId: string;
    projectIds: readonly string[];
    fullFilteredCount: number;
    expectedOrdinals: readonly number[];
  }>,
): void {
  const scope = page.scope as Readonly<Record<string, unknown>> | undefined;
  const projectSet = new Set(expected.projectIds);
  if (
    page.workspaceId !== expected.workspaceId ||
    !scope ||
    (scope.kind === "PROJECT" &&
      (expected.projectIds.length !== 1 || scope.projectId !== expected.projectIds[0])) ||
    (scope.kind === "AUTHORIZED_PORTFOLIO" && scope.projectId !== undefined)
  )
    throw new Error("QUEUE_PAGE_SCOPE_MISMATCH");
  const items = Array.isArray(page.items)
    ? (page.items as readonly Readonly<Record<string, unknown>>[])
    : [];
  for (const item of items) {
    const entry = item.entry as Readonly<Record<string, unknown>> | undefined;
    if (
      !entry ||
      entry.workspaceId !== expected.workspaceId ||
      !projectSet.has(String(entry.projectId))
    )
      throw new Error("QUEUE_PAGE_ENTRY_SCOPE_MISMATCH");
    const override = item.appliedOrderOverride as Readonly<Record<string, unknown>> | undefined;
    if (override) {
      const forbidden = [
        "anchorProjectId",
        "anchorWorkItemId",
        "requestedAnchor",
        "actionHash",
      ].some((key) => key in override);
      const validState =
        override.applicationState === "APPLIED" ||
        override.applicationState === "ANCHOR_UNAVAILABLE_NO_OP";
      const expiryValid =
        override.applicationState === "APPLIED"
          ? typeof override.expiresAt === "string"
          : override.expiresAt === undefined;
      if (forbidden || !validState || !expiryValid)
        throw new Error("QUEUE_PAGE_OVERRIDE_DISCLOSURE_FORBIDDEN");
    }
  }
  const counts = page.visibleCounts as
    Readonly<{ total?: unknown; byStage?: Readonly<Record<string, unknown>> }> | undefined;
  const byStage = counts?.byStage;
  const stages = ["CANDIDATE", "BACKLOG", "READY", "ACTIVE", "COMPLETED"];
  const sum = stages.reduce((total, stage) => total + Number(byStage?.[stage] ?? Number.NaN), 0);
  if (counts?.total !== expected.fullFilteredCount || sum !== expected.fullFilteredCount)
    throw new Error("QUEUE_PAGE_COUNT_MISMATCH");
  const ordinals = items.map(({ ordinal }) => Number(ordinal));
  if (
    ordinals.length !== expected.expectedOrdinals.length ||
    ordinals.some((value, index) => value !== expected.expectedOrdinals[index]) ||
    ordinals.some((value, index) => index > 0 && value <= ordinals[index - 1]!)
  )
    throw new Error("QUEUE_PAGE_ORDINAL_MISMATCH");
  const order = page.orderState as Readonly<Record<string, unknown>> | undefined;
  if (
    !order ||
    !Number.isSafeInteger(order.resourceVersion) ||
    Number(order.resourceVersion) < 0 ||
    !Number.isSafeInteger(order.queueEpoch) ||
    Number(order.queueEpoch) < 1 ||
    !hashPattern.test(String(order.baseVisibleSetHash))
  )
    throw new Error("QUEUE_PAGE_ORDER_TOKEN_INVALID");
  if (
    page.nextCursor !== null &&
    (typeof page.nextCursor !== "string" ||
      page.nextCursor.length < 20 ||
      page.nextCursor.length > 4096)
  )
    throw new Error("QUEUE_PAGE_CURSOR_INVALID");
}

export interface ProjectQueueReadInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly principalId: string;
}

export interface ProjectQueueItemReadInput extends ProjectQueueReadInput {
  readonly workItemId: string;
}

export interface ProjectQueueLaneReadInput extends ProjectQueueReadInput {
  readonly pageSize?: number;
  readonly stage?: string;
  readonly serviceClass?: string;
  readonly freshness?: string;
  readonly cursor?: string;
}

export interface PortfolioQueueReadInput {
  readonly workspaceId: string;
  readonly principalId: string;
  readonly pageSize?: number;
  readonly stage?: string;
  readonly serviceClass?: string;
  readonly freshness?: string;
  readonly cursor?: string;
}

export interface ProjectQueueProjectionReadPort {
  read(input: ProjectQueueItemReadInput): Promise<QueueEntry | undefined>;
  list?(
    input: ProjectQueueLaneReadInput & Readonly<{ projectionAsOf: string }>,
  ): Promise<readonly QueueEntry[]>;
  orderState?(
    input: ProjectQueueReadInput,
    baseVisibleSetHash: `sha256:${string}`,
  ): Promise<
    Readonly<{
      resourceVersion: number;
      queueEpoch: number;
      baseVisibleSetHash: `sha256:${string}`;
    }>
  >;
  portfolioOrderState?(
    input: PortfolioQueueReadInput,
    authorizedProjectSetHash: `sha256:${string}`,
    baseVisibleSetHash: `sha256:${string}`,
  ): Promise<
    Readonly<{
      resourceVersion: number;
      queueEpoch: number;
      baseVisibleSetHash: `sha256:${string}`;
    }>
  >;
  activeOrderOverrides?(
    input: Readonly<{
      workspaceId: string;
      scopeKind: "PROJECT" | "AUTHORIZED_PORTFOLIO";
      projectId?: string;
      authorizedProjectSetHash: `sha256:${string}`;
      asOf: string;
    }>,
  ): Promise<
    readonly Readonly<{
      orderScopeId: string;
      overrideId: string;
      projectId: string;
      workItemId: string;
      moveSequence: number;
      placement: "FIRST" | "LAST" | "BEFORE" | "AFTER";
      anchorProjectId?: string;
      anchorWorkItemId?: string;
      reason: string;
      acceptedAt: string;
      expiresAt: string;
    }>[]
  >;
}

export interface ProjectQueueQueryDependencies {
  readonly authorize: (input: ProjectQueueReadInput) => Promise<boolean>;
  readonly authorizedProjects?: (
    input: Readonly<{ workspaceId: string; principalId: string }>,
  ) => Promise<readonly string[]>;
  readonly projection: ProjectQueueProjectionReadPort;
  readonly metrics?: Readonly<{
    observe(
      value: Readonly<{
        visibleProjectCount: number;
        visibleEntryCount: number;
        exportBatchSize: number;
      }>,
    ): void | Promise<void>;
  }>;
  readonly now?: () => string;
  /** Deliberately never used by queue reads; retained as an executable isolation seam. */
  readonly provider?: Readonly<{ read(...args: readonly unknown[]): Promise<unknown> }>;
}

const json = <T>(value: unknown): T =>
  typeof value === "string" ? (JSON.parse(value) as T) : (value as T);
const iso = (value: unknown): string =>
  value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();

function materializeQueueEntry(row: Row): QueueEntry {
  const reconciledAt =
    row.reconciled_at === null || row.reconciled_at === undefined
      ? {}
      : { reconciledAt: iso(row.reconciled_at) };
  return Object.freeze({
    schemaVersion: "queue-entry@1.0.0",
    queueEntryId: String(row.queue_entry_id),
    revision: Number(row.revision_number),
    workspaceId: String(row.workspace_id),
    projectId: String(row.project_id),
    subject: json(row.subject_ref),
    stage: String(row.stage),
    stageDetails: json(row.stage_details),
    stageReasonCodes: json(row.stage_reason_codes),
    operational: json(row.operational_facet),
    qa: json(row.qa_facet),
    control: json(row.control_facet),
    capacity: json(row.capacity_facet),
    sla: json(row.sla_facet),
    ordering: json(row.ordering_facet),
    consistencyWarnings: json(row.consistency_warnings),
    freshness: json(row.freshness),
    sourceRefs: json(row.source_refs),
    sourceSetHash: String(row.source_set_hash),
    policyFacetRef: json(row.policy_facet_ref),
    derivationRuleRef: json(row.derivation_rule_ref),
    inputFingerprint: String(row.input_fingerprint),
    calculatedAt: iso(row.calculated_at),
    ...reconciledAt,
    semanticHash: String(row.semantic_hash),
  });
}

function assertEntryScope(entry: QueueEntry, input: ProjectQueueReadInput): void {
  if (
    (entry.workspaceId !== undefined && entry.workspaceId !== input.workspaceId) ||
    (entry.projectId !== undefined && entry.projectId !== input.projectId)
  ) {
    throw new Error("QUEUE_PROJECTION_SCOPE_VIOLATION");
  }
}

export function exactQueueEntryReadToken(entry: QueueEntry): QueueEntryReadToken {
  const control = entry.control as Readonly<Record<string, unknown>> | undefined;
  const token = Object.freeze({
    queueEntryId: String(entry.queueEntryId),
    revision: Number(entry.revision),
    semanticHash: String(entry.semanticHash) as `sha256:${string}`,
    inputFingerprint: String(entry.inputFingerprint) as `sha256:${string}`,
    controlResourceVersion: Number(control?.resourceVersion ?? 0),
  });
  if (
    !token.queueEntryId ||
    !Number.isSafeInteger(token.revision) ||
    token.revision < 1 ||
    !/^sha256:[a-f0-9]{64}$/u.test(token.semanticHash) ||
    !/^sha256:[a-f0-9]{64}$/u.test(token.inputFingerprint) ||
    !Number.isSafeInteger(token.controlResourceVersion) ||
    token.controlResourceVersion < 0
  ) {
    throw new Error("QUEUE_ENTRY_READ_TOKEN_INVALID");
  }
  return token;
}

function entryFreshness(entry: QueueEntry): string {
  const freshness = entry.freshness as Readonly<Record<string, unknown>> | undefined;
  return String(freshness?.state ?? "ERROR");
}

function serviceClass(entry: QueueEntry): string {
  const control = entry.control as Readonly<Record<string, unknown>> | undefined;
  return String(control?.serviceClass ?? "STANDARD");
}

function comparatorRef(entry: QueueEntry | undefined) {
  const ordering = entry?.ordering as Readonly<Record<string, unknown>> | undefined;
  const exact = ordering?.comparatorRef as Readonly<Record<string, unknown>> | undefined;
  return (
    exact ??
    Object.freeze({
      key: "queue-order",
      version: "1.0.0",
      semanticHash: sha256({ key: "queue-order", version: "1.0.0" }),
    })
  );
}

function normalizedQueryHash(
  input: Readonly<{ stage?: string; serviceClass?: string; freshness?: string }>,
): `sha256:${string}` {
  return sha256({
    stage: input.stage ?? null,
    serviceClass: input.serviceClass ?? null,
    freshness: input.freshness ?? null,
  });
}

function visibleProjectHash(projectId: string, entries: readonly QueueEntry[]): `sha256:${string}` {
  return sha256({
    projectId,
    entries: entries
      .filter((entry) => entry.projectId === projectId)
      .map(exactQueueEntryReadToken)
      .sort((left, right) =>
        left.queueEntryId < right.queueEntryId
          ? -1
          : left.queueEntryId > right.queueEntryId
            ? 1
            : 0,
      ),
  } as unknown as JsonValue);
}

const appliedOverrideUuid = (namespace: string): string => {
  const hex = sha256(namespace).slice(7).split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 3) | 8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20, 32).join("")}`;
};

export function createViewLocalAppliedOrderOverride(
  input: Readonly<{
    orderScopeId: string;
    subjectWorkItemId: string;
    overrideId: string;
    orderScopeResourceVersion: number;
    scopeKind: "PROJECT" | "AUTHORIZED_PORTFOLIO";
    placement: "FIRST" | "LAST" | "BEFORE" | "AFTER";
    reason: string;
    acceptedAt: string;
    expiresAt: string;
    anchorVisible: boolean;
  }>,
) {
  const applicationState =
    (input.placement === "BEFORE" || input.placement === "AFTER") && !input.anchorVisible
      ? ("ANCHOR_UNAVAILABLE_NO_OP" as const)
      : ("APPLIED" as const);
  const body = Object.freeze({
    scopeKind: input.scopeKind,
    placement: input.placement,
    applicationState,
    reason: input.reason,
    acceptedAt: input.acceptedAt,
    ...(applicationState === "APPLIED" ? { expiresAt: input.expiresAt } : {}),
  });
  return Object.freeze({
    appliedOverrideRef: Object.freeze({
      id: appliedOverrideUuid(
        `queue-applied-override:${input.orderScopeId}:${input.subjectWorkItemId}:${input.overrideId}`,
      ),
      version: input.orderScopeResourceVersion,
      semanticHash: sha256(body as JsonValue),
    }),
    ...body,
  });
}

export class ProjectQueueQueryService {
  constructor(private readonly dependencies: ProjectQueueQueryDependencies) {}

  async item(input: ProjectQueueItemReadInput): Promise<QueueEntry> {
    if (!(await this.dependencies.authorize(input))) throw new Error("QUEUE_ITEM_NOT_FOUND");
    const entry = await this.dependencies.projection.read(input);
    if (!entry) throw new Error("QUEUE_ITEM_NOT_FOUND");
    assertEntryScope(entry, input);
    return entry;
  }

  async lane(input: ProjectQueueLaneReadInput): Promise<Readonly<Record<string, unknown>>> {
    if (!(await this.dependencies.authorize(input))) throw new Error("QUEUE_PROJECT_NOT_FOUND");
    if (!this.dependencies.projection.list) throw new Error("QUEUE_PROJECT_LANE_UNAVAILABLE");
    const cursor = input.cursor ? decodeQueueCursor(input.cursor) : undefined;
    const asOf = cursor?.asOf ?? this.dependencies.now?.() ?? new Date().toISOString();
    const all = await this.dependencies.projection.list({ ...input, projectionAsOf: asOf });
    for (const entry of all) assertEntryScope(entry, input);
    return await this.composePage(input, [input.projectId], all, "PROJECT", asOf, cursor);
  }

  async portfolio(input: PortfolioQueueReadInput): Promise<Readonly<Record<string, unknown>>> {
    if (!this.dependencies.authorizedProjects)
      throw new Error("QUEUE_PORTFOLIO_AUTHORIZATION_UNAVAILABLE");
    const projectIds = [...new Set(await this.dependencies.authorizedProjects(input))].sort();
    const cursor = input.cursor ? decodeQueueCursor(input.cursor) : undefined;
    const asOf = cursor?.asOf ?? this.dependencies.now?.() ?? new Date().toISOString();
    const all: QueueEntry[] = [];
    if (projectIds.length > 0 && !this.dependencies.projection.list)
      throw new Error("QUEUE_PORTFOLIO_UNAVAILABLE");
    for (const projectId of projectIds) {
      const entries = await this.dependencies.projection.list!({
        ...input,
        projectId,
        projectionAsOf: asOf,
      });
      for (const entry of entries) assertEntryScope(entry, { ...input, projectId });
      all.push(...entries);
    }
    const page = await this.composePage(
      input,
      projectIds,
      all,
      "AUTHORIZED_PORTFOLIO",
      asOf,
      cursor,
    );
    await this.dependencies.metrics?.observe({
      visibleProjectCount: projectIds.length,
      visibleEntryCount: all.length,
      exportBatchSize: Math.min(all.length, Math.max(1, Math.min(100, input.pageSize ?? 50))),
    });
    return page;
  }

  private async composePage(
    input: ProjectQueueLaneReadInput | PortfolioQueueReadInput,
    projectIds: readonly string[],
    all: readonly QueueEntry[],
    scopeKind: "PROJECT" | "AUTHORIZED_PORTFOLIO",
    asOf: string,
    decoded: QueueCursor | undefined,
  ): Promise<Readonly<Record<string, unknown>>> {
    const filtered = all.filter(
      (entry) =>
        (!input.stage || entry.stage === input.stage) &&
        (!input.serviceClass || serviceClass(entry) === input.serviceClass) &&
        (!input.freshness || entryFreshness(entry) === input.freshness),
    );
    const baseOrdered = sortQueueOrderEntries(
      filtered as readonly unknown[] as readonly QueueOrderEntry[],
    ) as readonly unknown[] as readonly QueueEntry[];
    const pageSize = Math.max(1, Math.min(100, input.pageSize ?? 50));
    const visibleSetHash = sha256(
      baseOrdered.map((entry) => exactQueueEntryReadToken(entry)) as unknown as JsonValue,
    );
    const setHash = authorizedProjectSetHash(projectIds);
    const selectedComparator = comparatorRef(baseOrdered[0]);
    const generation = sha256({
      authorizedProjectSetHash: setHash,
      comparatorRef: selectedComparator,
      projectVisibleSetHashes: projectIds.map((projectId) =>
        Object.freeze({ projectId, visibleSetHash: visibleProjectHash(projectId, baseOrdered) }),
      ),
    } as JsonValue);
    const queryHash = normalizedQueryHash(input);
    if (
      decoded &&
      (decoded.principalId !== input.principalId ||
        decoded.workspaceId !== input.workspaceId ||
        decoded.authorizedProjectSetHash !== setHash ||
        decoded.normalizedQueryHash !== queryHash ||
        decoded.projectionGeneration !== generation ||
        decoded.comparatorRef !== "queue-order@1.0.0")
    )
      throw new Error("QUEUE_CURSOR_CONFLICT");
    if (!Number.isFinite(Date.parse(asOf))) throw new Error("QUEUE_AS_OF_INVALID");
    const projectInput = scopeKind === "PROJECT" ? (input as ProjectQueueLaneReadInput) : undefined;
    const orderState = projectInput
      ? await this.dependencies.projection.orderState?.(projectInput, visibleSetHash)
      : await this.dependencies.projection.portfolioOrderState?.(input, setHash, visibleSetHash);
    const exactOrderState =
      orderState ??
      Object.freeze({ resourceVersion: 0, queueEpoch: 1, baseVisibleSetHash: visibleSetHash });
    let ordered = baseOrdered;
    const applied = new Map<string, ReturnType<typeof createViewLocalAppliedOrderOverride>>();
    const overrides =
      (await this.dependencies.projection.activeOrderOverrides?.({
        workspaceId: input.workspaceId,
        scopeKind,
        ...(projectInput ? { projectId: projectInput.projectId } : {}),
        authorizedProjectSetHash: setHash,
        asOf,
      })) ?? [];
    for (const override of overrides) {
      const subject = { projectId: override.projectId, workItemId: override.workItemId };
      if (
        !ordered.some(
          (entry) =>
            entry.projectId === subject.projectId &&
            (entry.subject as Readonly<Record<string, unknown>> | undefined)?.id ===
              subject.workItemId,
        )
      )
        continue;
      const keyed = ordered.map((entry) =>
        Object.freeze({
          entry,
          projectId: String(entry.projectId),
          workItemId: String((entry.subject as Readonly<Record<string, unknown>>).id),
        }),
      );
      const anchor =
        override.anchorProjectId && override.anchorWorkItemId
          ? { projectId: override.anchorProjectId, workItemId: override.anchorWorkItemId }
          : undefined;
      const outcome = applyQueueOrderMove(keyed, {
        subject,
        placement: override.placement,
        ...(anchor ? { anchor } : {}),
      });
      ordered = outcome.entries.map(({ entry }) => entry);
      applied.set(
        `${subject.projectId}\0${subject.workItemId}`,
        createViewLocalAppliedOrderOverride({
          orderScopeId: override.orderScopeId,
          subjectWorkItemId: override.workItemId,
          overrideId: override.overrideId,
          orderScopeResourceVersion: exactOrderState.resourceVersion,
          scopeKind,
          placement: override.placement,
          reason: override.reason,
          acceptedAt: override.acceptedAt,
          expiresAt: override.expiresAt,
          anchorVisible: outcome.applicationState === "APPLIED",
        }),
      );
    }
    const start = decoded?.boundaryOrdinal ?? 0;
    const selected = ordered.slice(start, start + pageSize);
    const nextBoundary = start + selected.length;
    const nextCursor =
      nextBoundary < ordered.length
        ? encodeQueueCursor({
            schemaVersion: "queue-cursor@1.0.0",
            principalId: input.principalId,
            workspaceId: input.workspaceId,
            authorizedProjectSetHash: setHash,
            normalizedQueryHash: queryHash,
            comparatorRef: "queue-order@1.0.0",
            projectionGeneration: generation,
            asOf,
            boundaryOrdinal: nextBoundary,
          })
        : null;
    const byStage = { CANDIDATE: 0, BACKLOG: 0, READY: 0, ACTIVE: 0, COMPLETED: 0 };
    for (const entry of ordered) {
      const stage = String(entry.stage) as keyof typeof byStage;
      if (stage in byStage) byStage[stage] += 1;
    }
    const freshnessStates = ordered.map(entryFreshness);
    const freshness = freshnessStates.includes("ERROR")
      ? "ERROR"
      : freshnessStates.includes("REBUILDING")
        ? "REBUILDING"
        : freshnessStates.includes("STALE")
          ? "STALE"
          : "CURRENT";
    const page = Object.freeze({
      schemaVersion: "queue-page@1.0.0",
      workspaceId: input.workspaceId,
      scope:
        scopeKind === "PROJECT"
          ? Object.freeze({
              kind: scopeKind,
              projectId: (input as ProjectQueueLaneReadInput).projectId,
              authorizedProjectSetHash: setHash,
            })
          : Object.freeze({ kind: scopeKind, authorizedProjectSetHash: setHash }),
      asOf,
      projectionGeneration: generation,
      comparatorRef: "queue-order@1.0.0",
      orderState: exactOrderState,
      freshness,
      visibleCounts: Object.freeze({ total: ordered.length, byStage: Object.freeze(byStage) }),
      items: Object.freeze(
        selected.map((entry, index) => {
          const subjectId = String(
            (entry.subject as Readonly<Record<string, unknown>> | undefined)?.id ?? "",
          );
          const explanation = applied.get(`${entry.projectId}\0${subjectId}`);
          return Object.freeze({
            ordinal: start + index + 1,
            entry,
            ...(explanation ? { appliedOrderOverride: explanation } : {}),
          });
        }),
      ),
      nextCursor,
    });
    validateQueuePageRepresentation(page, {
      workspaceId: input.workspaceId,
      projectIds,
      fullFilteredCount: ordered.length,
      expectedOrdinals: selected.map((_entry, index) => start + index + 1),
    });
    return page;
  }
}

export type SlaSnapshot = Readonly<Record<string, unknown>> &
  Readonly<{
    schemaVersion: "sla-snapshot@1.0.0";
    workspaceId: string;
    projectId: string;
    workItemId: string;
    goal: SlaGoal;
    clockState: "NOT_STARTED" | "RUNNING" | "PAUSED" | "STOPPED";
    targetState:
      "NOT_STARTED" | "NOT_CONFIGURED" | "ON_TRACK" | "AT_RISK" | "BREACHED" | "COMPLETED";
    elapsedBusinessSeconds: number;
    freshness: "CURRENT" | "STALE" | "ERROR" | "REBUILDING";
    asOf: string;
    evaluationHash: `sha256:${string}`;
  }>;

export interface SlaTargetGoalConfiguration {
  readonly goal: SlaGoal;
  readonly targetBusinessSeconds: number | null;
  readonly warningThresholds: readonly Readonly<{ key: string; elapsedBusinessSeconds: number }>[];
}

const evaluatedSnapshot = (body: Readonly<Record<string, unknown>>): SlaSnapshot =>
  Object.freeze({
    ...body,
    evaluationHash: sha256(body as JsonValue),
  }) as SlaSnapshot;

function assertTargetGoal(value: SlaTargetGoalConfiguration): void {
  if (
    value.targetBusinessSeconds !== null &&
    (!Number.isSafeInteger(value.targetBusinessSeconds) || value.targetBusinessSeconds < 1)
  ) {
    throw new Error("SLA_SNAPSHOT_TARGET_INVALID");
  }
  let previous = 0;
  const keys = new Set<string>();
  for (const warning of value.warningThresholds) {
    if (
      !warning.key ||
      keys.has(warning.key) ||
      !Number.isSafeInteger(warning.elapsedBusinessSeconds) ||
      warning.elapsedBusinessSeconds <= previous ||
      (value.targetBusinessSeconds !== null &&
        warning.elapsedBusinessSeconds >= value.targetBusinessSeconds)
    ) {
      throw new Error("SLA_SNAPSHOT_WARNINGS_INVALID");
    }
    previous = warning.elapsedBusinessSeconds;
    keys.add(warning.key);
  }
}

export function evaluateSlaSnapshot(
  input: Readonly<{
    transition: SlaClockTransition;
    openSegment?: SlaClockSegmentRevision;
    calendar: BusinessCalendarRevision;
    target: SlaTargetGoalConfiguration;
    asOf: string;
    freshness?: "CURRENT" | "STALE" | "ERROR" | "REBUILDING";
    providerStartObservedAt?: string;
  }>,
): SlaSnapshot {
  const { transition, calendar, target } = input;
  assertTargetGoal(target);
  if (
    target.goal !== transition.goal ||
    transition.calendarRef.id !== calendar.calendarId ||
    transition.calendarRef.version !== calendar.revision ||
    transition.calendarRef.semanticHash !== calendar.semanticHash
  ) {
    throw new Error("SLA_SNAPSHOT_PIN_MISMATCH");
  }
  if (
    !Number.isFinite(Date.parse(input.asOf)) ||
    Date.parse(input.asOf) < Date.parse(transition.effectiveAt)
  ) {
    throw new Error("SLA_SNAPSHOT_AS_OF_INVALID");
  }
  const needsOpen = transition.currentClockState !== "STOPPED";
  if (
    needsOpen &&
    (!input.openSegment ||
      input.openSegment.endedAt ||
      input.openSegment.slaClockId !== transition.slaClockId ||
      input.openSegment.clockCycle !== transition.clockCycle ||
      input.openSegment.state !== transition.currentClockState ||
      !sameSlaRef(input.openSegment.startClockRevisionRef, transition.clockRevisionRef))
  ) {
    throw new Error("SLA_SNAPSHOT_OPEN_SEGMENT_INVALID");
  }
  if (!needsOpen && input.openSegment) throw new Error("SLA_SNAPSHOT_STOPPED_SEGMENT_INVALID");
  const elapsed =
    transition.elapsedBusinessSecondsAtTransition +
    (transition.currentClockState === "RUNNING"
      ? businessSecondsBetween(calendar, input.openSegment!.startedAt, input.asOf)
      : 0);
  const targetConfiguration =
    target.targetBusinessSeconds === null
      ? Object.freeze({ state: "NOT_CONFIGURED" as const })
      : (() => {
          const remainingBusinessSeconds = Math.max(0, target.targetBusinessSeconds - elapsed);
          const base =
            transition.currentClockState === "STOPPED" ? transition.effectiveAt : input.asOf;
          return Object.freeze({
            state: "CONFIGURED" as const,
            targetBusinessSeconds: target.targetBusinessSeconds,
            warningThresholds: Object.freeze(
              target.warningThresholds.map((value) => Object.freeze({ ...value })),
            ),
            computedTargetAt: addBusinessSeconds(calendar, base, remainingBusinessSeconds),
            remainingBusinessSeconds,
          });
        })();
  const targetState =
    transition.currentClockState === "STOPPED"
      ? target.targetBusinessSeconds === null
        ? ("NOT_CONFIGURED" as const)
        : ("COMPLETED" as const)
      : target.targetBusinessSeconds === null
        ? ("NOT_CONFIGURED" as const)
        : elapsed >= target.targetBusinessSeconds
          ? ("BREACHED" as const)
          : target.warningThresholds.some(
                ({ elapsedBusinessSeconds }) => elapsed >= elapsedBusinessSeconds,
              )
            ? ("AT_RISK" as const)
            : ("ON_TRACK" as const);
  const mappedPauseReasonCode =
    "mappedPauseReasonCode" in transition ? transition.mappedPauseReasonCode : undefined;
  if (
    transition.currentClockState === "PAUSED" &&
    (!mappedPauseReasonCode ||
      transition.transitionSourceRef.sourceType !== "JIRA_OPERATIONAL_PROJECTION_REVISION")
  ) {
    throw new Error("SLA_SNAPSHOT_PAUSE_INVALID");
  }
  const pause =
    transition.currentClockState === "PAUSED"
      ? Object.freeze({
          state: "PAUSED" as const,
          mappedReasonCode: mappedPauseReasonCode!,
          mappingRef: transition.mappingRef,
          sourceRef: transition.transitionSourceRef,
          pausedAt: transition.effectiveAt,
        })
      : Object.freeze({ state: "NOT_PAUSED" as const });
  const body = Object.freeze({
    schemaVersion: "sla-snapshot@1.0.0" as const,
    workspaceId: transition.workspaceId,
    projectId: transition.projectId,
    workItemId: transition.workItemId,
    goal: transition.goal,
    clockState: transition.currentClockState,
    targetState,
    targetConfiguration,
    slaClockId: transition.slaClockId,
    clockCycle: transition.clockCycle,
    clockRevisionRef: transition.clockRevisionRef,
    policyFacetRef: transition.policyFacetRef,
    calendarRef: transition.calendarRef,
    mappingRef: transition.mappingRef,
    algorithmRef: transition.algorithmRef,
    startSourceRef: transition.startSourceRef,
    startedAt: transition.startedAt,
    ...(input.providerStartObservedAt
      ? { providerStartObservedAt: input.providerStartObservedAt }
      : transition.startSourceRef.sourceType === "JIRA_OPERATIONAL_PROJECTION_REVISION" &&
          transition.startSourceRef.observedAt
        ? { providerStartObservedAt: transition.startSourceRef.observedAt }
        : {}),
    lastTransition: transition.transition,
    effectiveAt: transition.effectiveAt,
    pause,
    ...(input.openSegment
      ? {
          openSegment: Object.freeze({
            segmentRef: input.openSegment.segmentRef,
            state: input.openSegment.state,
            startedAt: input.openSegment.startedAt,
          }),
        }
      : {}),
    ...(transition.currentClockState === "STOPPED"
      ? {
          stoppedAt: transition.effectiveAt,
          stopSourceRef: transition.transitionSourceRef,
        }
      : {}),
    elapsedBusinessSeconds: elapsed,
    inputFingerprint: transition.inputFingerprint,
    freshness: input.freshness ?? "CURRENT",
    asOf: input.asOf,
  });
  return evaluatedSnapshot(body);
}

function sameSlaRef(left: QueueVersionedContentRef, right: QueueVersionedContentRef): boolean {
  return (
    left.id === right.id &&
    left.version === right.version &&
    left.semanticHash === right.semanticHash
  );
}

export function notStartedSlaSnapshot(
  input: Readonly<{
    workspaceId: string;
    projectId: string;
    workItemId: string;
    goal: SlaGoal;
    asOf: string;
    reason:
      | "NO_CONFIRMED_START_EVENT"
      | "ROLLOUT_CONFIRMATION_REQUIRED"
      | "POLICY_NOT_PUBLISHED"
      | "SOURCE_STALE"
      | "SOURCE_CONFLICT";
    policyFacetRef?: QueueVersionedContentRef;
    calendarRef?: QueueVersionedContentRef;
    mappingRef?: ProjectQueuePolicyFacet["statusMappingRef"];
    algorithmRef?: QueueAlgorithmRef;
    target?: SlaTargetGoalConfiguration;
    freshness?: "CURRENT" | "STALE" | "ERROR" | "REBUILDING";
  }>,
): SlaSnapshot {
  if (!Number.isFinite(Date.parse(input.asOf))) throw new Error("SLA_SNAPSHOT_AS_OF_INVALID");
  const configured = input.target?.targetBusinessSeconds !== null && input.target !== undefined;
  if (
    (input.reason === "POLICY_NOT_PUBLISHED") !== !input.policyFacetRef ||
    (input.policyFacetRef !== undefined &&
      (!input.calendarRef || !input.mappingRef || !input.algorithmRef || !input.target))
  ) {
    throw new Error("SLA_SNAPSHOT_NOT_STARTED_CONFIGURATION_INVALID");
  }
  if (input.target) assertTargetGoal(input.target);
  const body = Object.freeze({
    schemaVersion: "sla-snapshot@1.0.0" as const,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    workItemId: input.workItemId,
    goal: input.goal,
    clockState: "NOT_STARTED" as const,
    targetState: "NOT_STARTED" as const,
    targetConfiguration: configured
      ? Object.freeze({
          state: "CONFIGURED" as const,
          targetBusinessSeconds: input.target!.targetBusinessSeconds,
          warningThresholds: input.target!.warningThresholds,
        })
      : Object.freeze({ state: "NOT_CONFIGURED" as const }),
    notStartedReason: input.reason,
    ...(input.policyFacetRef
      ? {
          policyFacetRef: input.policyFacetRef,
          calendarRef: input.calendarRef,
          mappingRef: input.mappingRef,
          algorithmRef: input.algorithmRef,
          inputFingerprint: sha256({
            goal: input.goal,
            policyFacetRef: input.policyFacetRef,
            calendarRef: input.calendarRef,
            mappingRef: input.mappingRef,
            algorithmRef: input.algorithmRef,
          } as unknown as JsonValue),
        }
      : {}),
    pause: Object.freeze({ state: "NOT_PAUSED" as const }),
    elapsedBusinessSeconds: 0,
    freshness: input.freshness ?? "CURRENT",
    asOf: input.asOf,
  });
  return evaluatedSnapshot(body);
}

export function validateSlaSnapshotSet(
  input: Readonly<{
    snapshots: readonly SlaSnapshot[];
    workspaceId: string;
    projectId: string;
    workItemId: string;
    asOf: string;
    expectedGoals: readonly SlaGoal[];
  }>,
): void {
  const expected = [...new Set(input.expectedGoals)].sort();
  const actual = input.snapshots.map(({ goal }) => goal).sort();
  if (
    input.snapshots.length !== expected.length ||
    JSON.stringify(actual) !== JSON.stringify(expected) ||
    input.snapshots.some(
      (snapshot) =>
        snapshot.workspaceId !== input.workspaceId ||
        snapshot.projectId !== input.projectId ||
        snapshot.workItemId !== input.workItemId ||
        snapshot.asOf !== input.asOf ||
        snapshot.evaluationHash !==
          sha256(
            Object.fromEntries(
              Object.entries(snapshot).filter(([key]) => key !== "evaluationHash"),
            ) as JsonValue,
          ),
    )
  ) {
    throw new Error("SLA_SNAPSHOT_SET_INVALID");
  }
}

export function slaSnapshotSetEtag(snapshots: readonly SlaSnapshot[]): `"sha256:${string}"` {
  return `"${sha256(snapshots as unknown as JsonValue)}"`;
}

export interface ProjectSlaQueryDependencies {
  readonly authorize: (input: ProjectQueueItemReadInput) => Promise<boolean>;
  readonly workItemExists: (input: ProjectQueueItemReadInput) => Promise<boolean>;
  readonly currentPolicyFacet: (
    input: ProjectQueueItemReadInput,
  ) => Promise<ProjectQueuePolicyFacet | undefined>;
  readonly policyFacetByRef: (
    input: ProjectQueueItemReadInput,
    ref: QueueVersionedContentRef,
  ) => Promise<ProjectQueuePolicyFacet | undefined>;
  readonly calendarByRef: (
    workspaceId: string,
    ref: QueueVersionedContentRef,
  ) => Promise<BusinessCalendarRevision | undefined>;
  readonly currentClock: (
    input: ProjectQueueItemReadInput,
    goal: SlaGoal,
  ) => Promise<SlaClockTransition | undefined>;
  readonly openSegment: (
    input: ProjectQueueItemReadInput,
    slaClockId: string,
  ) => Promise<SlaClockSegmentRevision | undefined>;
  readonly rolloutProviderObservedAt?: (
    input: ProjectQueueItemReadInput,
    sourceId: string,
  ) => Promise<string | undefined>;
  readonly notStartedReason?: (
    input: ProjectQueueItemReadInput,
    goal: SlaGoal,
  ) => Promise<
    | "NO_CONFIRMED_START_EVENT"
    | "ROLLOUT_CONFIRMATION_REQUIRED"
    | "SOURCE_STALE"
    | "SOURCE_CONFLICT"
  >;
  readonly freshness?: (
    input: ProjectQueueItemReadInput,
  ) => Promise<"CURRENT" | "STALE" | "ERROR" | "REBUILDING">;
  readonly now?: () => string;
  /** Executable isolation seam: SLA GET never reads a provider or model. */
  readonly provider?: Readonly<{ read(...args: readonly unknown[]): Promise<unknown> }>;
  readonly model?: Readonly<{ invoke(...args: readonly unknown[]): Promise<unknown> }>;
}

const closedSlaGoals = Object.freeze([
  "READY_TO_FIRST_QA_START",
  "READY_TO_SIGNED_VERDICT",
] as const);
const defaultSlaAlgorithmRef = Object.freeze({
  key: "sla-business-time",
  version: "1.0.0",
  semanticHash: sha256({ key: "sla-business-time", version: "1.0.0" }),
});

export class ProjectSlaQueryService {
  constructor(private readonly dependencies: ProjectSlaQueryDependencies) {}

  async read(
    input: ProjectQueueItemReadInput,
  ): Promise<Readonly<{ snapshots: readonly SlaSnapshot[]; etag: `"sha256:${string}"` }>> {
    if (
      !(await this.dependencies.authorize(input)) ||
      !(await this.dependencies.workItemExists(input))
    )
      throw new Error("QUEUE_ITEM_NOT_FOUND");
    const asOf = this.dependencies.now?.() ?? new Date().toISOString();
    if (!Number.isFinite(Date.parse(asOf))) throw new Error("SLA_SNAPSHOT_AS_OF_INVALID");
    const [policy, freshness] = await Promise.all([
      this.dependencies.currentPolicyFacet(input),
      this.dependencies.freshness?.(input) ?? Promise.resolve("CURRENT" as const),
    ]);
    const goals = policy ? policy.slaGoals.map(({ goal }) => goal) : closedSlaGoals;
    const snapshots: SlaSnapshot[] = [];
    for (const goal of goals) {
      const transition = await this.dependencies.currentClock(input, goal);
      if (!policy) {
        snapshots.push(
          notStartedSlaSnapshot({
            ...input,
            goal,
            asOf,
            reason: "POLICY_NOT_PUBLISHED",
            freshness,
          }),
        );
        continue;
      }
      if (!transition) {
        const target = policy.slaGoals.find((candidate) => candidate.goal === goal)!;
        const reason =
          (await this.dependencies.notStartedReason?.(input, goal)) ?? "NO_CONFIRMED_START_EVENT";
        snapshots.push(
          notStartedSlaSnapshot({
            ...input,
            goal,
            asOf,
            reason,
            policyFacetRef: policy.policyFacetRef,
            calendarRef: policy.calendarRef,
            mappingRef: policy.statusMappingRef,
            algorithmRef: defaultSlaAlgorithmRef,
            target,
            freshness,
          }),
        );
        continue;
      }
      const pinnedPolicy = await this.dependencies.policyFacetByRef(
        input,
        transition.policyFacetRef,
      );
      const pinnedTarget = pinnedPolicy?.slaGoals.find((candidate) => candidate.goal === goal);
      const calendar = await this.dependencies.calendarByRef(
        input.workspaceId,
        transition.calendarRef,
      );
      if (
        !pinnedPolicy ||
        !sameSlaRef(pinnedPolicy.policyFacetRef, transition.policyFacetRef) ||
        !pinnedTarget ||
        !calendar
      ) {
        throw new Error("SLA_SNAPSHOT_PIN_NOT_FOUND");
      }
      const openSegment = await this.dependencies.openSegment(input, transition.slaClockId);
      const providerStartObservedAt =
        transition.startSourceRef.sourceType === "SLA_ROLLOUT_AUTHORITY_VERIFICATION"
          ? await this.dependencies.rolloutProviderObservedAt?.(
              input,
              transition.startSourceRef.sourceId,
            )
          : undefined;
      snapshots.push(
        evaluateSlaSnapshot({
          transition,
          ...(openSegment ? { openSegment } : {}),
          calendar,
          target: pinnedTarget,
          asOf,
          freshness,
          ...(providerStartObservedAt ? { providerStartObservedAt } : {}),
        }),
      );
    }
    validateSlaSnapshotSet({ snapshots, ...input, asOf, expectedGoals: goals });
    return Object.freeze({
      snapshots: Object.freeze(snapshots),
      etag: slaSnapshotSetEtag(snapshots),
    });
  }
}

export class PostgresAuthorizedQueueProjects {
  constructor(private readonly source: DataSource) {}
  async resolveIdentity(
    input: Readonly<
      { workspaceId: string; permissions?: readonly string[] } & (
        { principalId: string } | { issuer: string; subject: string }
      )
    >,
  ): Promise<Readonly<{ principalId: string; projectIds: readonly string[] }>> {
    const byPrincipal = "principalId" in input;
    const result = (await this.source.query(
      `SELECT DISTINCT identity.id AS principal_id,project.id AS project_id
         FROM identities identity
         JOIN workspace_memberships membership
           ON membership.principal_id=identity.id AND membership.workspace_id=$1
          AND membership.state='ACTIVE' AND membership.revoked_at IS NULL
          AND membership.valid_from<=clock_timestamp() AND (membership.valid_until IS NULL OR membership.valid_until>clock_timestamp())
         JOIN project_entitlements entitlement
           ON entitlement.principal_id=identity.id AND entitlement.workspace_id=membership.workspace_id
          AND entitlement.effect='ALLOW' AND entitlement.revoked_at IS NULL
          AND entitlement.valid_from<=clock_timestamp() AND (entitlement.valid_until IS NULL OR entitlement.valid_until>clock_timestamp())
         JOIN projects project
           ON project.workspace_id=entitlement.workspace_id AND project.id=entitlement.project_id AND project.state='ACTIVE'
        WHERE ${byPrincipal ? "identity.id=$2" : "identity.issuer=$2 AND identity.subject=$3"}
        ORDER BY project.id`,
      byPrincipal
        ? [input.workspaceId, input.principalId]
        : [input.workspaceId, input.issuer, input.subject],
    )) as readonly Readonly<{ principal_id: string; project_id: string }>[];
    const principalId = result[0]?.principal_id;
    if (!principalId) {
      const identity = (await this.source.query(
        `SELECT identity.id AS principal_id FROM identities identity
          JOIN workspace_memberships membership ON membership.principal_id=identity.id AND membership.workspace_id=$1
           AND membership.state='ACTIVE' AND membership.revoked_at IS NULL
           AND membership.valid_from<=clock_timestamp() AND (membership.valid_until IS NULL OR membership.valid_until>clock_timestamp())
         WHERE ${byPrincipal ? "identity.id=$2" : "identity.issuer=$2 AND identity.subject=$3"}`,
        byPrincipal
          ? [input.workspaceId, input.principalId]
          : [input.workspaceId, input.issuer, input.subject],
      )) as readonly Readonly<{ principal_id: string }>[];
      if (!identity[0]) throw new Error("QUEUE_PORTFOLIO_IDENTITY_NOT_FOUND");
      return Object.freeze({
        principalId: identity[0].principal_id,
        projectIds: Object.freeze([]),
      });
    }
    const repository = new TypeOrmScopedAccessRepository(this.source),
      at = new Date();
    const workspace = await repository.getWorkspace({
      kind: "WORKSPACE",
      workspaceId: input.workspaceId,
    });
    if (workspace?.state !== "ACTIVE") throw new Error("QUEUE_PORTFOLIO_IDENTITY_NOT_FOUND");
    const projectIds: string[] = [];
    for (const { project_id: projectId } of result) {
      const scope = { kind: "PROJECT" as const, workspaceId: input.workspaceId, projectId };
      const project = await repository.getProject(scope);
      if (!project || project.state !== "ACTIVE") continue;
      const facts = await repository.authorizationFacts(scope, principalId, at);
      const permissions = new Set([
        "queue.project.read",
        ...(input.permissions ?? []).filter((p) => p !== "queue.portfolio.read"),
      ]);
      if (
        [...permissions].every(
          (permission) =>
            new DenyByDefaultAuthorizationPolicy().decide({
              context: {
                actor: {
                  kind: "HUMAN",
                  principalId,
                  issuer: "persisted-queue-identity",
                  subject: principalId,
                },
                scope,
                correlationId: principalId,
                causationId: principalId,
              },
              permission,
              resourceClassification: project.classification,
              facts,
              operationClass: "READ",
              at,
            }).allowed,
        )
      )
        projectIds.push(projectId);
    }
    return Object.freeze({ principalId, projectIds: Object.freeze(projectIds) });
  }

  async resolve(
    input: Readonly<{ workspaceId: string; principalId: string }>,
  ): Promise<readonly string[]> {
    return (await this.resolveIdentity(input)).projectIds;
  }
}

export class PostgresProjectQueueProjection implements ProjectQueueProjectionReadPort {
  constructor(
    private readonly source: DataSource,
    private readonly sessionCeiling?: (input: ProjectQueueReadInput) => Promise<number | undefined>,
  ) {}
  private async classes(input: ProjectQueueReadInput): Promise<readonly string[]> {
    const ceiling = await this.sessionCeiling?.(input);
    const repository = new TypeOrmScopedAccessRepository(this.source),
      scope = {
        kind: "PROJECT" as const,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
      },
      at = new Date();
    const workspace = await repository.getWorkspace({
        kind: "WORKSPACE",
        workspaceId: input.workspaceId,
      }),
      project = await repository.getProject(scope);
    if (workspace?.state !== "ACTIVE" || !project || project.state !== "ACTIVE") return [];
    const facts = await repository.authorizationFacts(scope, input.principalId, at);
    const context = {
      actor: {
        kind: "HUMAN" as const,
        principalId: input.principalId,
        issuer: "persisted-queue-identity",
        subject: input.principalId,
      },
      scope,
      correlationId: input.principalId,
      causationId: input.principalId,
    };
    const policy = new DenyByDefaultAuthorizationPolicy();
    if (
      !policy.decide({
        context,
        permission: "queue.project.read",
        resourceClassification: project.classification,
        facts,
        operationClass: "READ",
        at,
      }).allowed
    )
      return [];
    const classifications = (await this.source.query(
      "SELECT key,rank FROM classification_catalog",
    )) as { key: string; rank: number }[];
    return classifications
      .filter(
        (resourceClassification) =>
          (ceiling === undefined || resourceClassification.rank <= ceiling) &&
          policy.decide({
            context,
            permission: "queue.project.read",
            resourceClassification,
            facts,
            operationClass: "READ",
            at,
          }).allowed,
      )
      .map((c) => c.key);
  }

  async read(input: ProjectQueueItemReadInput): Promise<QueueEntry | undefined> {
    const result = (await this.source.query(
      `SELECT revision.*
         FROM queue_entry_heads head
         JOIN queue_entry_revisions revision
           ON revision.workspace_id=head.workspace_id AND revision.project_id=head.project_id
          AND revision.queue_entry_revision_id=head.current_revision_id
        WHERE head.workspace_id=$1 AND head.project_id=$2 AND head.work_item_id=$3
          AND head.suppressed_by_work_item_id IS NULL AND (CASE WHEN head.subject_kind='WORK_ITEM' THEN (SELECT classification_key FROM work_items WHERE workspace_id=head.workspace_id AND project_id=head.project_id AND id=head.work_item_id) ELSE (SELECT classification_key FROM projects WHERE workspace_id=head.workspace_id AND id=head.project_id) END)=ANY($4::text[])`,
      [input.workspaceId, input.projectId, input.workItemId, await this.classes(input)],
    )) as readonly Row[];
    return result[0] ? materializeQueueEntry(result[0]) : undefined;
  }

  async list(
    input: ProjectQueueLaneReadInput & Readonly<{ projectionAsOf: string }>,
  ): Promise<readonly QueueEntry[]> {
    const result = (await this.source.query(
      `SELECT DISTINCT ON (revision.queue_entry_id) revision.*
         FROM queue_entry_heads head
         JOIN queue_entry_revisions revision
           ON revision.workspace_id=head.workspace_id AND revision.project_id=head.project_id
          AND revision.queue_entry_id=head.queue_entry_id AND revision.calculated_at<=$3
        WHERE head.workspace_id=$1 AND head.project_id=$2 AND head.suppressed_by_work_item_id IS NULL AND (CASE WHEN head.subject_kind='WORK_ITEM' THEN (SELECT classification_key FROM work_items WHERE workspace_id=head.workspace_id AND project_id=head.project_id AND id=head.work_item_id) ELSE (SELECT classification_key FROM projects WHERE workspace_id=head.workspace_id AND id=head.project_id) END)=ANY($4::text[])
        ORDER BY revision.queue_entry_id,revision.revision_number DESC`,
      [input.workspaceId, input.projectId, input.projectionAsOf, await this.classes(input)],
    )) as readonly Row[];
    return Object.freeze(result.map(materializeQueueEntry));
  }

  async orderState(input: ProjectQueueReadInput, baseVisibleSetHash: `sha256:${string}`) {
    const result = (await this.source.query(
      `SELECT resource_version,queue_epoch,base_visible_set_hash
         FROM queue_order_scope_heads
        WHERE workspace_id=$1 AND project_id=$2 AND scope_kind='PROJECT'`,
      [input.workspaceId, input.projectId],
    )) as readonly Row[];
    const row = result[0];
    if (!row) return Object.freeze({ resourceVersion: 0, queueEpoch: 1, baseVisibleSetHash });
    return Object.freeze({
      resourceVersion: Number(row.resource_version),
      queueEpoch: Number(row.queue_epoch),
      baseVisibleSetHash: String(row.base_visible_set_hash) as `sha256:${string}`,
    });
  }

  async portfolioOrderState(
    input: PortfolioQueueReadInput,
    setHash: `sha256:${string}`,
    baseVisibleSetHash: `sha256:${string}`,
  ) {
    const result = (await this.source.query(
      `SELECT resource_version,queue_epoch,base_visible_set_hash
         FROM queue_order_scope_heads
        WHERE workspace_id=$1 AND authorized_project_set_hash=$2 AND scope_kind='AUTHORIZED_PORTFOLIO'`,
      [input.workspaceId, setHash],
    )) as readonly Row[];
    const row = result[0];
    if (!row) return Object.freeze({ resourceVersion: 0, queueEpoch: 1, baseVisibleSetHash });
    return Object.freeze({
      resourceVersion: Number(row.resource_version),
      queueEpoch: Number(row.queue_epoch),
      baseVisibleSetHash: String(row.base_visible_set_hash) as `sha256:${string}`,
    });
  }

  async activeOrderOverrides(
    input: Readonly<{
      workspaceId: string;
      scopeKind: "PROJECT" | "AUTHORIZED_PORTFOLIO";
      projectId?: string;
      authorizedProjectSetHash: `sha256:${string}`;
      asOf: string;
    }>,
  ) {
    const result = (await this.source.query(
      `WITH selected_scope AS (
         SELECT order_scope_id FROM queue_order_scope_heads
          WHERE workspace_id=$1 AND scope_kind=$2
            AND (($2='PROJECT' AND project_id=$3) OR ($2='AUTHORIZED_PORTFOLIO' AND authorized_project_set_hash=$4))
       ), latest AS (
         SELECT DISTINCT ON (override.work_item_id) override.*,candidate.public_candidate
           FROM queue_order_overrides override
           JOIN selected_scope scope ON scope.order_scope_id=override.order_scope_id
           LEFT JOIN queue_action_candidates candidate
             ON candidate.workspace_id=override.workspace_id AND candidate.action_id=(override.action_candidate_ref->>'sourceId')::uuid
          WHERE override.workspace_id=$1 AND override.effective_at<=$5
          ORDER BY override.work_item_id,override.move_sequence DESC
       ) SELECT * FROM latest WHERE expires_at>$5
          ORDER BY move_sequence,override_id`,
      [
        input.workspaceId,
        input.scopeKind,
        input.projectId ?? null,
        input.authorizedProjectSetHash,
        input.asOf,
      ],
    )) as readonly Row[];
    return Object.freeze(
      result.map((row) => {
        const candidate = json<Readonly<Record<string, unknown>>>(row.public_candidate ?? {});
        return Object.freeze({
          orderScopeId: String(row.order_scope_id),
          overrideId: String(row.override_id),
          projectId: String(row.project_id),
          workItemId: String(row.work_item_id),
          moveSequence: Number(row.move_sequence),
          placement: String(row.placement) as "FIRST" | "LAST" | "BEFORE" | "AFTER",
          ...(row.anchor_project_id ? { anchorProjectId: String(row.anchor_project_id) } : {}),
          ...(row.anchor_work_item_id ? { anchorWorkItemId: String(row.anchor_work_item_id) } : {}),
          reason: String(candidate.reason ?? "Accepted QA Lead order"),
          acceptedAt: iso(row.effective_at),
          expiresAt: iso(row.expires_at),
        });
      }),
    );
  }
}
