import {
  canonicalize,
  type JsonValue,
  type OfflineSchemaRegistry,
  sha256,
} from "@awp/platform-contracts";

import type { ExtensionKind, ExtensionRegistry } from "./extension-registry.ts";

export interface StaticExtensionCandidate {
  readonly sourceComponentRef: string;
  readonly manifestSchemaId: string;
  readonly manifest: Readonly<Record<string, unknown>>;
  readonly required: boolean;
}

export interface ExtensionReadiness {
  readonly status: "READY" | "DEGRADED" | "DOWN";
  readonly results: readonly Readonly<{
    sourceComponentRef: string;
    required: boolean;
    outcome: "ACCEPTED" | "REJECTED";
    diagnostics: readonly string[];
  }>[];
}

const semver = /^([0-9]+)\.([0-9]+)\.([0-9]+)$/u;
function compatible(version: string, range: string | undefined): boolean {
  const match = semver.exec(version);
  if (!match || !range) return false;
  const major = Number(match[1]);
  const lower = />=([0-9]+)\./u.exec(range);
  const upper = /<([0-9]+)\./u.exec(range);
  return lower !== null && upper !== null && major >= Number(lower[1]) && major < Number(upper[1]);
}

function identity(
  manifest: Readonly<Record<string, unknown>>,
): Readonly<{ kind?: string; key?: string; version?: string; coreRange?: string }> {
  const metadata =
    manifest.metadata && typeof manifest.metadata === "object"
      ? (manifest.metadata as Record<string, unknown>)
      : undefined;
  const requires =
    manifest.requires && typeof manifest.requires === "object"
      ? (manifest.requires as Record<string, unknown>)
      : undefined;
  return {
    ...(typeof manifest.kind === "string" ? { kind: manifest.kind } : {}),
    ...(typeof (metadata?.key ?? manifest.key) === "string"
      ? { key: String(metadata?.key ?? manifest.key) }
      : {}),
    ...(typeof (metadata?.version ?? manifest.version) === "string"
      ? { version: String(metadata?.version ?? manifest.version) }
      : {}),
    ...(typeof requires?.coreContracts === "string" ? { coreRange: requires.coreContracts } : {}),
  };
}

export async function reconcileExtensions(
  options: Readonly<{
    candidates: readonly StaticExtensionCandidate[];
    schemas: OfflineSchemaRegistry;
    registry: ExtensionRegistry;
    bootInstanceId: string;
    coreContractVersion?: string;
  }>,
): Promise<ExtensionReadiness> {
  const results: ExtensionReadiness["results"][number][] = [];
  for (const candidate of options.candidates) {
    const manifestHash = sha256(candidate.manifest as JsonValue);
    const observed = identity(candidate.manifest);
    const diagnostics: string[] = [];
    try {
      options.schemas.validateById(candidate.manifestSchemaId, candidate.manifest);
    } catch (error) {
      diagnostics.push(
        `MANIFEST_SCHEMA_INVALID:${error instanceof Error ? error.message : "unknown"}`,
      );
    }
    if (
      !observed.kind ||
      !new Set<ExtensionKind>(["CompetencyPack", "Connector", "CapabilityContract"]).has(
        observed.kind as ExtensionKind,
      )
    )
      diagnostics.push("MANIFEST_KIND_INVALID");
    if (!observed.key) diagnostics.push("MANIFEST_KEY_MISSING");
    if (!observed.version || !semver.test(observed.version))
      diagnostics.push("MANIFEST_SEMVER_INVALID");
    if (
      observed.kind !== "CapabilityContract" &&
      !compatible(options.coreContractVersion ?? "1.0.0", observed.coreRange)
    )
      diagnostics.push("CORE_CONTRACT_RANGE_INCOMPATIBLE");
    if (canonicalize(candidate.manifest as JsonValue).length === 0)
      diagnostics.push("MANIFEST_EMPTY");
    if (diagnostics.length > 0 || !observed.kind || !observed.key || !observed.version) {
      await options.registry.rejectMalformed({
        sourceComponentRef: candidate.sourceComponentRef,
        bootInstanceId: options.bootInstanceId,
        observedHash: manifestHash,
        ...(observed.kind ? { observedKind: observed.kind } : {}),
        ...(observed.key ? { observedKey: observed.key } : {}),
        ...(observed.version ? { observedVersion: observed.version } : {}),
        diagnostics,
      });
      results.push({
        sourceComponentRef: candidate.sourceComponentRef,
        required: candidate.required,
        outcome: "REJECTED",
        diagnostics,
      });
      continue;
    }
    const result = await options.registry.register({
      kind: observed.kind as ExtensionKind,
      key: observed.key,
      version: observed.version,
      manifestHash,
      manifest: candidate.manifest,
      sourceComponentRef: candidate.sourceComponentRef,
      bootInstanceId: options.bootInstanceId,
    });
    results.push({
      sourceComponentRef: candidate.sourceComponentRef,
      required: candidate.required,
      outcome: result.outcome,
      diagnostics: result.diagnostics,
    });
  }
  const requiredFailure = results.some(
    (result) => result.required && result.outcome === "REJECTED",
  );
  const optionalFailure = results.some(
    (result) => !result.required && result.outcome === "REJECTED",
  );
  return Object.freeze({
    status: requiredFailure ? "DOWN" : optionalFailure ? "DEGRADED" : "READY",
    results: Object.freeze(results),
  });
}
