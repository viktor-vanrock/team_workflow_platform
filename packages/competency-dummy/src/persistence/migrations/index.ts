import { M1000DummyRequests1700000001000 } from "./1000-dummy-requests.ts";

export const dummyMigrationRegistry = Object.freeze([
  { order: 1000, owner: "pack:dummy" as const, migration: M1000DummyRequests1700000001000 },
]);
export { M1000DummyRequests1700000001000 };
