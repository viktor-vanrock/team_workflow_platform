import { expect, it } from "vitest";

import { devBootstrapSubjects } from "../../../packages/runtime-composition/src/bootstrap/dev-superadmin.ts";

it("only enables an explicit dev environment and deduplicates multiple subjects", () => {
  const AWP_BOOTSTRAP_SUPERADMIN_SUBJECT = "first, second,first";
  expect(devBootstrapSubjects({ AWP_BOOTSTRAP_SUPERADMIN_SUBJECT })).toEqual([]);
  expect(
    devBootstrapSubjects({ AWP_BOOTSTRAP_SUPERADMIN_SUBJECT, AWP_SUPERADMIN_ENVIRONMENT: "prod" }),
  ).toEqual([]);
  expect(
    devBootstrapSubjects({ AWP_BOOTSTRAP_SUPERADMIN_SUBJECT, AWP_SUPERADMIN_ENVIRONMENT: "dev" }),
  ).toEqual(["first", "second"]);
});
