/** Server-only contract selection. Request bodies/headers cannot opt a legacy call into another shape. */
const publishedRequests = new WeakSet<object>();
export function markPublishedOnboardingRequest(request: object): void {
  publishedRequests.add(request);
}
export function isPublishedOnboardingRequest(request: object): boolean {
  return publishedRequests.has(request);
}
