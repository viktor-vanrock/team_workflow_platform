import { describe, expect, it } from "vitest";

import { formatRuDateTime, formatRuUiValue } from "../../../packages/platform-ui/src/index.ts";

describe("русский UI formatter", () => {
  it("переводит известные presentation values", () => {
    expect(formatRuUiValue("PENDING")).toBe("Ожидает решения");
    expect(formatRuUiValue("READY_TO_CLOSE")).toBe("Готово к закрытию");
    expect(formatRuUiValue("MANUAL_ONLY")).toBe("Только ручная проверка");
    expect(formatRuUiValue("ASSERTION_FAILED")).toBe("Проверка не пройдена");
  });

  it("сохраняет устойчивые термины и неизвестные значения", () => {
    expect(formatRuUiValue("QA")).toBe("QA");
    expect(formatRuUiValue("Jira")).toBe("Jira");
    expect(formatRuUiValue("VENDOR_NEW_STATE")).toBe("VENDOR_NEW_STATE");
  });

  it("форматирует валидную дату в русской локали и сохраняет неизвестное значение", () => {
    expect(formatRuDateTime("2026-09-07T12:30:00.000Z", "UTC")).toContain("07.09.2026");
    expect(formatRuDateTime("not-a-date")).toBe("not-a-date");
    expect(formatRuDateTime(undefined)).toBe("Нет данных");
  });
});
