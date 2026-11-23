import type { JsonValue } from "../../packages/platform-contracts/src/index.ts";

export function requiredFixture<T>(value: T | null | undefined): T {
  if (value === undefined || value === null) throw new Error("Required fixture value is missing");
  return value;
}

export type FixtureOverrides<T> = { [K in keyof T]?: T[K] | undefined };

/** An undefined override removes an optional default instead of serializing it. */
export function fixtureWithOverrides<T extends object>(base: T, overrides: FixtureOverrides<T>): T {
  return Object.fromEntries(
    Object.entries({ ...base, ...overrides }).filter(([, value]) => value !== undefined),
  ) as T;
}

/** Validate untyped JSON/YAML fixtures before using the canonical hash API. */
export function fixtureJson(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(fixtureJson);
  if (
    typeof value === "object" &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, fixtureJson(child)]),
    );
  }
  throw new Error("Fixture must contain only JSON values");
}
