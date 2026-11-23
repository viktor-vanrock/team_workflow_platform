import { describe, expect, it } from "vitest";

import {
  safeProjectProblem,
  safeVisiblePage,
} from "../../../../packages/platform-runtime-nest/src/http/problem-details.filter.ts";

describe("Feature 007 US3 side-channel resistance", () => {
  it("uses one public shape and only low-cardinality dimensions", () => {
    expect(safeProjectProblem("NO_ENTITLEMENT", "correlation")).toEqual(
      safeProjectProblem("RESOURCE_NOT_FOUND", "correlation"),
    );
    const page = safeVisiblePage([{ id: "a" }, { id: "b" }], "visibility-hash", 1);
    expect(page).toMatchObject({ visibleCount: 1, items: [{ id: "a" }] });
    expect(JSON.stringify(page)).not.toMatch(/hidden|forbidden|totalCount|Secret/u);
    expect(page.nextCursor).toMatch(/^scope:/u);
  });
});
