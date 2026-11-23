/** Local bearer and corporate cookie callers share the same project forms. */
export function projectSessionHeaders(
  accessToken?: string,
  csrfToken?: string,
): Record<string, string> {
  return accessToken
    ? { authorization: `Bearer ${accessToken}` }
    : csrfToken
      ? { "x-csrf-token": csrfToken }
      : {};
}
export function readProjectDraft<T>(key?: string): T | undefined {
  if (!key) return;
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw || raw.length > 30_000) return;
    const draft = JSON.parse(raw) as { expiresAt: number; value: T };
    if (draft.expiresAt > Date.now() && draft.expiresAt <= Date.now() + 600_000) return draft.value;
    sessionStorage.removeItem(key);
  } catch {
    /* An unavailable browser store must not prevent normal form usage. */
  }
  return undefined;
}
export function saveProjectDraft(key: string | undefined, value: unknown): void {
  if (!key) return;
  // Fail before redirect if storage is unavailable, so the visible form is retained.
  sessionStorage.setItem(key, JSON.stringify({ expiresAt: Date.now() + 600_000, value }));
}
export function clearProjectDraft(key?: string): void {
  if (!key) return;
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* The server result already committed. */
  }
}
