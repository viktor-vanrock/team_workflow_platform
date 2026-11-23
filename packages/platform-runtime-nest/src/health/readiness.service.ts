import { Injectable } from "@nestjs/common";

export type DependencyState = "UP" | "DOWN" | "DEGRADED" | "NOT_CONFIGURED";
export type DependencyKey = "db" | "schema" | "extensions" | "mockHub";
export interface DependencyProbe {
  readonly key: DependencyKey;
  check(): Promise<Readonly<{ state: DependencyState; detail?: string }>>;
}
export interface ReadinessReport {
  readonly status: "UP" | "DOWN";
  readonly runtime: Readonly<{ profile: string }>;
  readonly dependencies: Readonly<
    Record<DependencyKey, Readonly<{ state: DependencyState; detail?: string }>>
  >;
}

@Injectable()
export class ReadinessService {
  constructor(
    private readonly profile: string,
    private readonly probes: readonly DependencyProbe[] = [],
  ) {}
  liveness(): Readonly<{ status: "UP"; runtime: { profile: string } }> {
    return { status: "UP", runtime: { profile: this.profile } };
  }
  async readiness(): Promise<ReadinessReport> {
    const dependencies = Object.fromEntries(
      await Promise.all(this.probes.map(async (probe) => [probe.key, await probe.check()])),
    ) as Record<DependencyKey, Readonly<{ state: DependencyState; detail?: string }> | undefined>;
    for (const key of ["db", "schema", "extensions", "mockHub"] as const)
      dependencies[key] ??= { state: "NOT_CONFIGURED" };
    const down = Object.values(dependencies).some((dependency) => dependency?.state === "DOWN");
    return {
      status: down ? "DOWN" : "UP",
      runtime: { profile: this.profile },
      dependencies: dependencies as ReadinessReport["dependencies"],
    };
  }
}
