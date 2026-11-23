import type { JiraAdapterFamily } from "@awp/platform-contracts";

export interface JiraReconciliationWatermark {
  readonly updatedAt: string;
  readonly key: string;
}
export interface JiraReconciliationPageInput {
  readonly family: JiraAdapterFamily;
  readonly watermark: JiraReconciliationWatermark;
  readonly overlapSeconds: number;
  readonly complete: boolean;
  readonly nextPageToken?: string;
  readonly offset?: number;
}
export function planJiraReconciliationPage(input: JiraReconciliationPageInput): Readonly<{
  queryStart: string;
  transientPageState: Readonly<Record<string, unknown>>;
  committedWatermark?: JiraReconciliationWatermark;
}> {
  const queryStart = new Date(
    Date.parse(input.watermark.updatedAt) - input.overlapSeconds * 1_000,
  ).toISOString();
  return Object.freeze({
    queryStart,
    transientPageState: Object.freeze(
      input.family === "jira-cloud-v3"
        ? { nextPageToken: input.nextPageToken }
        : { offset: input.offset ?? 0 },
    ),
    ...(input.complete ? { committedWatermark: Object.freeze({ ...input.watermark }) } : {}),
  });
}

export type JiraSchedulingLane =
  "COMMAND_CONFIRMATION" | "BOUND_REFRESH" | "IMPORT_DISCOVERY" | "FULL_DRIFT_SWEEP";
const priority: readonly JiraSchedulingLane[] = [
  "COMMAND_CONFIRMATION",
  "BOUND_REFRESH",
  "IMPORT_DISCOVERY",
  "FULL_DRIFT_SWEEP",
];
export class FairJiraScheduler {
  readonly #queues = new Map<JiraSchedulingLane, string[]>(priority.map((lane) => [lane, []]));
  readonly #schedule: readonly JiraSchedulingLane[] = [
    "COMMAND_CONFIRMATION",
    "COMMAND_CONFIRMATION",
    "COMMAND_CONFIRMATION",
    "COMMAND_CONFIRMATION",
    "BOUND_REFRESH",
    "BOUND_REFRESH",
    "BOUND_REFRESH",
    "IMPORT_DISCOVERY",
    "IMPORT_DISCOVERY",
    "FULL_DRIFT_SWEEP",
  ];
  #cursor = 0;
  enqueue(lane: JiraSchedulingLane, id: string): void {
    this.#queues.get(lane)!.push(id);
  }
  next(): string | undefined {
    for (let offset = 0; offset < this.#schedule.length; offset++) {
      const index = (this.#cursor + offset) % this.#schedule.length;
      const lane = this.#schedule[index]!;
      const value = this.#queues.get(lane)!.shift();
      if (value) {
        this.#cursor = (index + 1) % this.#schedule.length;
        return value;
      }
    }
    return undefined;
  }
}
