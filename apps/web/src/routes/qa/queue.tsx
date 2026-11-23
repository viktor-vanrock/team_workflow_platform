import type { ReactElement } from "react";

/** Queue route shell; story slices supply authorized projection data via HTTP. */
export function QaQueueRoute(): ReactElement {
  return <main data-route="qa-queue" aria-label="Очередь QA" />;
}
