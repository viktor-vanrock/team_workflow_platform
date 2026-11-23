export interface OidcHttpPolicy {
  readonly mode: "CORPORATE" | "LOCAL_FIXTURE";
  readonly deadlineMs: number;
  readonly maximumResponseBytes: number;
}
export interface OidcTransport {
  readonly authorizeEndpoint: (
    url: string,
    method: "GET" | "POST",
    signal: AbortSignal,
  ) => Promise<boolean>;
  readonly fetch?: typeof fetch;
  readonly clock?: () => number;
}

export function assertOidcEndpoint(value: string, policy: OidcHttpPolicy): void {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    (policy.mode === "CORPORATE"
      ? url.protocol !== "https:"
      : url.protocol !== "http:" || url.hostname !== "127.0.0.1")
  )
    throw new Error("OIDC_POLICY_INVALID");
  if (
    !Number.isSafeInteger(policy.deadlineMs) ||
    policy.deadlineMs < 1 ||
    policy.deadlineMs > 30_000 ||
    !Number.isSafeInteger(policy.maximumResponseBytes) ||
    policy.maximumResponseBytes < 1024 ||
    policy.maximumResponseBytes > 1_000_000
  )
    throw new Error("OIDC_POLICY_INVALID");
}

export async function oidcJsonRequest(
  url: string,
  policy: OidcHttpPolicy,
  transport: OidcTransport,
  request: Readonly<{
    method: "GET" | "POST";
    body?: string;
    headers?: Readonly<Record<string, string>>;
  }>,
  callerSignal?: AbortSignal,
): Promise<Record<string, unknown>> {
  assertOidcEndpoint(url, policy);
  const deadline = AbortSignal.timeout(policy.deadlineMs);
  const signal = callerSignal ? AbortSignal.any([callerSignal, deadline]) : deadline;
  let abort!: () => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    abort = () => {
      reject(new Error("OIDC_REQUEST_FAILED"));
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const chunks: Buffer[] = [];
  try {
    if (!(await Promise.race([transport.authorizeEndpoint(url, request.method, signal), aborted])))
      throw new Error();
    signal.throwIfAborted();
    if (request.body && Buffer.byteLength(request.body) > 65_536) throw new Error();
    const response = await Promise.race([
      (transport.fetch ?? fetch)(url, {
        method: request.method,
        headers: { accept: "application/json", ...request.headers },
        ...(request.body !== undefined ? { body: request.body } : {}),
        signal,
        redirect: "error",
      }),
      aborted,
    ]);
    if (!response.ok || !response.body) {
      void response.body?.cancel().catch(() => undefined);
      throw new Error();
    }
    reader = response.body.getReader();
    let size = 0;
    while (true) {
      const item = await Promise.race([reader.read(), aborted]);
      if (item.done) break;
      size += item.value.length;
      if (size > policy.maximumResponseBytes) throw new Error();
      chunks.push(Buffer.from(item.value));
    }
    const bytes = Buffer.concat(chunks);
    try {
      const result: unknown = JSON.parse(bytes.toString("utf8"));
      if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error();
      return result as Record<string, unknown>;
    } finally {
      bytes.fill(0);
    }
  } catch {
    throw new Error("OIDC_REQUEST_FAILED");
  } finally {
    signal.removeEventListener("abort", abort);
    void reader?.cancel().catch(() => undefined);
    chunks.forEach((chunk) => {
      chunk.fill(0);
    });
  }
}
