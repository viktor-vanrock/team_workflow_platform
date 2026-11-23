import type { AuthorizedProjectQueryToken } from "@awp/platform-core";

export interface ProjectSearchDocument {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly classificationRank: number;
  readonly workItemIds: readonly string[];
  readonly queueEntryIds: readonly string[];
}

const unavailable = Object.freeze({ status: "NOT_AVAILABLE" as const });

export class InMemoryProjectSearchIndex {
  readonly #documents: readonly ProjectSearchDocument[];

  constructor(documents: readonly ProjectSearchDocument[]) {
    this.#documents = Object.freeze(documents.map((document) => Object.freeze({ ...document })));
  }

  #visible(token: AuthorizedProjectQueryToken): readonly ProjectSearchDocument[] {
    return this.#documents.filter(
      (document) =>
        document.workspaceId === token.workspaceId &&
        token.allows(document.projectId, document.classificationRank, "READ"),
    );
  }

  catalog(token: AuthorizedProjectQueryToken): readonly ProjectSearchDocument[] {
    return this.#visible(token);
  }

  onboarding(
    token: AuthorizedProjectQueryToken,
    projectId: string,
  ): ProjectSearchDocument | typeof unavailable {
    return this.#visible(token).find((document) => document.projectId === projectId) ?? unavailable;
  }

  workItem(
    token: AuthorizedProjectQueryToken,
    projectId: string,
    workItemId: string,
  ): Readonly<{ projectId: string; workItemId: string }> | typeof unavailable {
    const document = this.#visible(token).find(
      (candidate) =>
        candidate.projectId === projectId && candidate.workItemIds.includes(workItemId),
    );
    return document ? Object.freeze({ projectId, workItemId }) : unavailable;
  }

  queue(token: AuthorizedProjectQueryToken): readonly ProjectSearchDocument[] {
    return this.#visible(token).filter(({ queueEntryIds }) => queueEntryIds.length > 0);
  }

  search(
    token: AuthorizedProjectQueryToken,
    query: string,
    limit: number,
    cursor?: string,
  ): Readonly<{
    items: readonly ProjectSearchDocument[];
    visibleCount: number;
    nextCursor?: string;
  }> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new Error("PROJECT_SEARCH_LIMIT_INVALID");
    const scope = encodeURIComponent(token.visibilityHash);
    let offset = 0;
    if (cursor !== undefined) {
      const match = /^scope:([^:]*):offset:(\d+)$/u.exec(cursor);
      if (!match || match[1] !== scope) throw new Error("PROJECT_SEARCH_CURSOR_SCOPE_MISMATCH");
      offset = Number(match[2]);
    }
    const normalized = query.trim().toLocaleLowerCase();
    const matching = this.#visible(token).filter(({ projectName }) =>
      projectName.toLocaleLowerCase().includes(normalized),
    );
    const items = matching.slice(offset, offset + limit);
    const nextOffset = offset + items.length;
    return Object.freeze({
      items,
      visibleCount: items.length,
      ...(nextOffset < matching.length
        ? { nextCursor: `scope:${scope}:offset:${nextOffset}` }
        : {}),
    });
  }
}
