import { readFileSync } from "node:fs";

import type { DataSource } from "typeorm";

import {
  type ExactRevisionRef,
  pilotContentHash,
  type ProjectScope,
  validateInputPackage008,
} from "@awp/platform-core";
import { RuntimeConfigurationRepository } from "@awp/platform-persistence-typeorm";

import type { PilotReportPolicyPort, PilotReportVerificationPolicy } from "./report-verifier.ts";

/** Operator-delivered public policy is pinned to the independently reviewed IN-07 hash. */
export class PublishedPilotReportPolicy implements PilotReportPolicyPort {
  readonly #configurations = new RuntimeConfigurationRepository();
  constructor(
    private readonly source: DataSource,
    private readonly inputPackageRef: ExactRevisionRef,
    private readonly policyFile: string,
  ) {
    if (!source.isInitialized || !policyFile.startsWith("/"))
      throw new Error("PILOT_REPORT_POLICY_CONFIGURATION_INVALID");
  }

  async current(scope: ProjectScope): Promise<PilotReportVerificationPolicy> {
    try {
      const publication = await this.source.transaction(
        "REPEATABLE READ",
        async (manager) =>
          await this.#configurations.current(manager, scope, this.inputPackageRef, "INPUT_PACKAGE"),
      );
      if (validateInputPackage008(publication.document, "N2").status !== "PASS") throw new Error();
      const entries = publication.document.entries;
      if (!Array.isArray(entries)) throw new Error();
      const matches = (entries as unknown[]).filter(
        (item) =>
          item &&
          typeof item === "object" &&
          !Array.isArray(item) &&
          (item as Record<string, unknown>).id === "IN-07",
      );
      if (matches.length !== 1) throw new Error();
      const metadata = (matches[0] as Record<string, unknown>).metadata as
        Record<string, unknown> | undefined;
      const approvedHash = metadata?.verificationPolicyRef;
      if (typeof approvedHash !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(approvedHash))
        throw new Error();
      const bytes = readFileSync(this.policyFile);
      if (!bytes.length || bytes.length > 1_048_576) throw new Error();
      const value = JSON.parse(bytes.toString("utf8")) as unknown;
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
      const input = value as Record<string, unknown>;
      if (
        Object.keys(input).some((key) => !["schemaVersion", "policies"].includes(key)) ||
        input.schemaVersion !== 1 ||
        !Array.isArray(input.policies) ||
        input.policies.length > 100
      )
        throw new Error();
      const policies = input.policies.filter(
        (item: unknown) =>
          item &&
          typeof item === "object" &&
          !Array.isArray(item) &&
          (item as Record<string, unknown>).workspaceId === scope.workspaceId &&
          (item as Record<string, unknown>).projectId === scope.projectId,
      ) as PilotReportVerificationPolicy[];
      if (policies.length !== 1) throw new Error();
      const policy = policies[0]!;
      const { policyRef, ...body } = policy;
      if (
        !policyRef ||
        policyRef.contentHash !== approvedHash ||
        pilotContentHash(body) !== approvedHash ||
        policy.keys.some((key) => "d" in key.publicKey)
      )
        throw new Error();
      return Object.freeze(structuredClone(policy));
    } catch {
      throw new Error("PILOT_REPORT_POLICY_UNAVAILABLE");
    }
  }
}
