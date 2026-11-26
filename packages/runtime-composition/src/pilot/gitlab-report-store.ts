import { createHash } from "node:crypto";

import type { GitLabRestClient } from "@awp/connector-gitlab";
import {
  assertExactRevisionRef,
  pilotContentHash,
  samePilotRef,
  type ExactRevisionRef,
  type ProjectScope,
} from "@awp/platform-core";

import type {
  PilotReportArtifactStore,
  PilotReportDocument,
  PilotReportReference,
} from "./report-verifier.ts";

export interface GitLabPilotReportLocator extends ProjectScope {
  readonly reportRef: ExactRevisionRef;
  readonly numericProjectId: number;
  readonly jobId: number;
  readonly path: string;
  readonly signature: PilotReportDocument["signature"];
}
/** The implementation must recheck current scoped artifact policy and locator approval. */
export interface GitLabPilotReportLocatorAuthority {
  report(scope: ProjectScope, ref: ExactRevisionRef): Promise<GitLabPilotReportLocator>;
  prerequisite(
    scope: ProjectScope,
    parent: ExactRevisionRef,
    ref: PilotReportReference,
  ): Promise<GitLabPilotReportLocator>;
  client(scope: ProjectScope, locator: GitLabPilotReportLocator): Promise<GitLabRestClient>;
}

const denied = () => new Error("PILOT_REPORT_ARTIFACT_UNAVAILABLE");
const pathAllowed = (path: string) =>
  /^reports\/008-pilot-hardening-and-conformance\/[A-Za-z0-9._/-]+$/u.test(path) &&
  path.length <= 1024 &&
  path.split("/").every((part) => part && part !== "." && part !== "..");
const hash = (bytes: Uint8Array) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

/** Reads pinned GitLab CI artifacts; the separate verifier checks signatures and policy. */
export class GitLabPilotReportStore implements PilotReportArtifactStore {
  constructor(private readonly authority: GitLabPilotReportLocatorAuthority) {}

  async report(
    scope: ProjectScope,
    ref: ExactRevisionRef,
    signal: AbortSignal,
  ): Promise<PilotReportDocument> {
    assertExactRevisionRef(ref);
    const locator = await this.authority.report(scope, ref);
    if (!samePilotRef(ref, locator.reportRef)) throw denied();
    const result = await this.document(scope, locator, signal);
    if (pilotContentHash(locator) !== pilotContentHash(await this.authority.report(scope, ref)))
      throw denied();
    return result;
  }

  async prerequisite(
    scope: ProjectScope,
    parent: ExactRevisionRef,
    ref: PilotReportReference,
    signal: AbortSignal,
  ): Promise<PilotReportDocument> {
    assertExactRevisionRef(parent);
    if (!pathAllowed(ref.path) || !/^sha256:[a-f0-9]{64}$/u.test(ref.sha256)) throw denied();
    const locator = await this.authority.prerequisite(scope, parent, ref);
    if (locator.path !== ref.path || locator.reportRef.contentHash !== ref.sha256) throw denied();
    const result = await this.document(scope, locator, signal);
    if (
      pilotContentHash(locator) !==
      pilotContentHash(await this.authority.prerequisite(scope, parent, ref))
    )
      throw denied();
    return result;
  }

  async evidence(
    scope: ProjectScope,
    parent: ExactRevisionRef,
    ref: PilotReportReference,
    signal: AbortSignal,
  ): Promise<Uint8Array> {
    assertExactRevisionRef(parent);
    if (!pathAllowed(ref.path) || !/^sha256:[a-f0-9]{64}$/u.test(ref.sha256)) throw denied();
    const locator = await this.authority.report(scope, parent);
    if (!samePilotRef(parent, locator.reportRef)) throw denied();
    const bytes = await this.read(scope, locator, ref.path, 20_000_000, signal);
    if (
      hash(bytes) !== ref.sha256 ||
      pilotContentHash(locator) !== pilotContentHash(await this.authority.report(scope, parent))
    )
      throw denied();
    return bytes;
  }

  private async document(
    scope: ProjectScope,
    locator: GitLabPilotReportLocator,
    signal: AbortSignal,
  ) {
    assertExactRevisionRef(locator.reportRef);
    assertExactRevisionRef(locator.signature.keyRef);
    assertExactRevisionRef(locator.signature.subjectRef);
    const bytes = await this.read(scope, locator, locator.path, 2_000_000, signal);
    if (hash(bytes) !== locator.reportRef.contentHash) throw denied();
    return {
      reportRef: structuredClone(locator.reportRef),
      bytes,
      signature: structuredClone(locator.signature),
    };
  }

  private async read(
    scope: ProjectScope,
    locator: GitLabPilotReportLocator,
    path: string,
    maximum: number,
    signal: AbortSignal,
  ): Promise<Uint8Array> {
    if (
      scope.workspaceId !== locator.workspaceId ||
      scope.projectId !== locator.projectId ||
      !Number.isSafeInteger(locator.numericProjectId) ||
      locator.numericProjectId < 1 ||
      !Number.isSafeInteger(locator.jobId) ||
      locator.jobId < 1 ||
      !pathAllowed(path) ||
      signal.aborted
    )
      throw denied();
    const client = await this.authority.client(scope, locator);
    const encodedPath = path.split("/").map(encodeURIComponent).join("/");
    const response = await client.request({
      operation: "artifact.stream",
      authOperation: "artifactStream",
      method: "GET",
      path: `/api/v4/projects/${locator.numericProjectId}/jobs/${locator.jobId}/artifacts/${encodedPath}`,
      signal,
      maxResponseBytes: maximum,
    });
    if (!response.body) throw denied();
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const item = await reader.read();
        if (item.done) break;
        total += item.value.byteLength;
        if (total > maximum || signal.aborted) {
          await reader.cancel();
          throw denied();
        }
        chunks.push(item.value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  }
}
