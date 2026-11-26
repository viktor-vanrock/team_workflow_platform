import type { DataSource } from "typeorm";

import {
  type QaAutomationSuiteValidationReport,
  type QaAutomationSuiteVersion,
  TypeOrmAutomationSuiteRepository,
} from "@awp/competency-qa/node";
import type { ConnectorCommand } from "@awp/platform-core";
import { TypeOrmCommandDeliveryStore } from "@awp/platform-persistence-typeorm";

import {
  qaAutomationSuiteValidationCapabilityKey,
  qaAutomationSuiteValidationOperation,
} from "./suite-validation.ts";

export interface GitLabSuiteValidationExecution {
  readonly previousVersion: QaAutomationSuiteVersion;
  readonly nextVersion: QaAutomationSuiteVersion;
  readonly report: QaAutomationSuiteValidationReport;
}

export interface GitLabSuiteValidationExecutor {
  validate(command: ConnectorCommand): Promise<GitLabSuiteValidationExecution>;
}

export class GitLabSuiteValidationWorker {
  readonly #delivery: TypeOrmCommandDeliveryStore;

  constructor(
    source: DataSource,
    private readonly executor: GitLabSuiteValidationExecutor,
    private readonly deploymentScope?: Readonly<{
      workspaceId: string;
      projectIds: readonly string[];
    }>,
  ) {
    if (deploymentScope && (!deploymentScope.workspaceId || !deploymentScope.projectIds.length))
      throw new Error("GITLAB_SUITE_VALIDATION_SCOPE_INVALID");
    this.#delivery = new TypeOrmCommandDeliveryStore(source);
  }

  async runOne(now = new Date()): Promise<"IDLE" | "VALID" | "INVALID"> {
    const claims = await this.#delivery.claim(
      now,
      new Date(now.getTime() + 30_000),
      1,
      [qaAutomationSuiteValidationCapabilityKey],
      this.deploymentScope
        ? { ...this.deploymentScope, operations: [qaAutomationSuiteValidationOperation] }
        : undefined,
    );
    const claim = claims[0];
    if (!claim) return "IDLE";
    const dispatched = await this.#delivery.markDispatched(claim.outbox, now, 30_000);
    const scope = {
      workspaceId: dispatched.workspaceId,
      projectId: dispatched.projectId,
      commandId: dispatched.id,
    };
    try {
      const execution = await this.executor.validate(dispatched);
      await this.#delivery.confirmWith(
        scope,
        Object.freeze({
          status: execution.report.status,
          reportId: execution.report.id,
          reportContentHash: execution.report.contentHash,
        }),
        now,
        async (manager) => {
          await new TypeOrmAutomationSuiteRepository(manager).persistValidation({
            scope,
            previousVersion: execution.previousVersion,
            nextVersion: execution.nextVersion,
            report: execution.report,
          });
        },
        Object.freeze({
          attemptCount: dispatched.attemptCount,
          leaseExpiresAt: dispatched.executionLeaseExpiresAt!,
        }),
      );
      return execution.report.status;
    } catch (error) {
      await this.#delivery.fail(scope, "QA_AUTOMATION_SUITE_VALIDATION_FAILED", now);
      throw error;
    }
  }
}
