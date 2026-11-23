import { describe, expect, it } from "vitest";

import {
  addBusinessSeconds,
  type BusinessCalendarRevision,
  businessSecondsBetween,
  publishBusinessCalendar,
} from "../../../packages/platform-core/src/index.ts";
import { digest } from "../../helpers/006/triage-fixture.ts";

const id = (suffix: string): string => `60000000-0000-4000-8000-${suffix.padStart(12, "0")}`;

function calendar(
  overrides: Partial<Omit<BusinessCalendarRevision, "semanticHash">> = {},
): BusinessCalendarRevision {
  return publishBusinessCalendar({
    schemaVersion: "business-calendar@1.0.0",
    calendarId: id("1"),
    calendarKey: "qa-hours",
    workspaceId: id("2"),
    revision: 1,
    timeZone: "UTC",
    validFrom: "2026-01-01",
    validThrough: null,
    weeklyIntervals: [
      { dayOfWeek: "MONDAY", startLocalTime: "09:00:00", endLocalTime: "12:00:00" },
      { dayOfWeek: "MONDAY", startLocalTime: "12:00:00", endLocalTime: "17:00:00" },
    ],
    dateOverrides: [],
    dstAlgorithmRef: {
      key: "business-calendar-dst",
      version: "1.0.0",
      semanticHash: digest("calendar-dst"),
    },
    dstRules: {
      nonexistentBoundary: "SHIFT_TO_FIRST_VALID_INSTANT_AFTER_GAP",
      ambiguousStart: "EARLIEST_MATCHING_INSTANT",
      ambiguousEnd: "LATEST_MATCHING_INSTANT",
    },
    sourceKind: "MANUAL",
    sourceRef: "calendar-draft:1",
    sourceHash: digest("calendar-source"),
    ownerPrincipalId: id("3"),
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    publishedAt: "2026-01-01T00:00:00.000Z",
    publishedByPrincipalId: id("3"),
    ...overrides,
  });
}

describe("business-calendar@1.0.0 arithmetic", () => {
  it("accepts adjacent weekly intervals and crosses closed local days deterministically", () => {
    const value = calendar();
    expect(
      businessSecondsBetween(value, "2026-09-07T08:00:00.000Z", "2026-09-07T18:00:00.000Z"),
    ).toBe(8 * 3_600);
    expect(addBusinessSeconds(value, "2026-09-07T16:00:00.000Z", 2 * 3_600)).toBe(
      "2026-09-14T10:00:00.000Z",
    );
  });

  it("uses CLOSED and leap-day WORKING overrides without implicit precedence", () => {
    const value = calendar({
      validFrom: "2028-01-01",
      weeklyIntervals: [
        { dayOfWeek: "TUESDAY", startLocalTime: "09:00:00", endLocalTime: "17:00:00" },
      ],
      dateOverrides: [
        { kind: "CLOSED", date: "2028-02-29", reasonCode: "PUBLIC_HOLIDAY" },
        {
          kind: "WORKING",
          date: "2028-03-01",
          reasonCode: "WORKING_DAY_OVERRIDE",
          workingIntervals: [{ startLocalTime: "10:00:00", endLocalTime: "12:00:00" }],
        },
      ],
    });
    expect(
      businessSecondsBetween(value, "2028-02-29T00:00:00.000Z", "2028-03-02T00:00:00.000Z"),
    ).toBe(2 * 3_600);
    expect(() =>
      calendar({
        dateOverrides: [
          { kind: "CLOSED", date: "2026-09-07", reasonCode: "PUBLIC_HOLIDAY" },
          {
            kind: "WORKING",
            date: "2026-09-07",
            reasonCode: "WORKING_DAY_OVERRIDE",
            workingIntervals: [{ startLocalTime: "09:00:00", endLocalTime: "10:00:00" }],
          },
        ],
      }),
    ).toThrow("BUSINESS_CALENDAR_OVERRIDE_DUPLICATE");
  });

  it("honors 24:00 end boundaries", () => {
    const value = calendar({
      weeklyIntervals: [
        { dayOfWeek: "MONDAY", startLocalTime: "22:00:00", endLocalTime: "24:00:00" },
      ],
    });
    expect(
      businessSecondsBetween(value, "2026-09-07T21:00:00.000Z", "2026-09-08T01:00:00.000Z"),
    ).toBe(2 * 3_600);
  });

  it("shifts spring gaps forward and expands fall overlaps with earlier-start/later-end rules", () => {
    const spring = calendar({
      timeZone: "America/New_York",
      weeklyIntervals: [
        { dayOfWeek: "SUNDAY", startLocalTime: "02:30:00", endLocalTime: "04:00:00" },
      ],
    });
    expect(
      businessSecondsBetween(spring, "2026-03-08T05:00:00.000Z", "2026-03-08T10:00:00.000Z"),
    ).toBe(3_600);
    expect(addBusinessSeconds(spring, "2026-03-08T05:00:00.000Z", 3_600)).toBe(
      "2026-03-08T08:00:00.000Z",
    );

    const fall = calendar({
      timeZone: "America/New_York",
      weeklyIntervals: [
        { dayOfWeek: "SUNDAY", startLocalTime: "01:00:00", endLocalTime: "01:30:00" },
      ],
    });
    expect(
      businessSecondsBetween(fall, "2026-11-01T04:00:00.000Z", "2026-11-01T08:00:00.000Z"),
    ).toBe(90 * 60);
  });

  it("rejects invalid civil dates, fixed-offset aliases, overlaps, and finite exhaustion", () => {
    expect(() => calendar({ validFrom: "2026-02-30" })).toThrow(
      "BUSINESS_CALENDAR_COVERAGE_INVALID",
    );
    expect(() => calendar({ timeZone: "Etc/GMT+3" })).toThrow(
      "BUSINESS_CALENDAR_TIME_ZONE_INVALID",
    );
    expect(() =>
      calendar({
        weeklyIntervals: [
          { dayOfWeek: "MONDAY", startLocalTime: "09:00:00", endLocalTime: "13:00:00" },
          { dayOfWeek: "MONDAY", startLocalTime: "12:00:00", endLocalTime: "17:00:00" },
        ],
      }),
    ).toThrow("BUSINESS_CALENDAR_WEEKLY_OVERLAP");
    const finite = calendar({ validThrough: "2026-09-07" });
    expect(() => addBusinessSeconds(finite, "2026-09-07T16:00:00.000Z", 2 * 3_600)).toThrow(
      "BUSINESS_CALENDAR_COVERAGE_EXHAUSTED",
    );
  });

  it("pins a stable semantic hash for normalized UTC input", () => {
    expect(calendar().semanticHash).toBe(
      "sha256:74aa35255f9dbb41e5337541b38740d4b1d82c534d13a41dea87309fb9b4bdd3",
    );
  });
});
