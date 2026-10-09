import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  isValidDate,
  isValidMonth,
  monthGridRange,
  monthRange,
  weekRange,
  weeksOfMonth,
} from "@/lib/dates";

describe("日期校验", () => {
  it("拒绝不存在的日期与错误格式", () => {
    expect(isValidDate("2026-10-09")).toBe(true);
    expect(isValidDate("2026-02-29")).toBe(false);
    expect(isValidDate("2024-02-29")).toBe(true);
    expect(isValidDate("2026-13-01")).toBe(false);
    expect(isValidDate("2026-1-1")).toBe(false);
    expect(isValidDate(20261009)).toBe(false);
    expect(isValidMonth("2026-12")).toBe(true);
    expect(isValidMonth("2026-00")).toBe(false);
  });
});

describe("自然周", () => {
  it("默认周一起始：周日属于上一个周一开始的周", () => {
    expect(weekRange("2026-10-09", 1)).toEqual({ start: "2026-10-05", end: "2026-10-11" });
    expect(weekRange("2026-10-11", 1)).toEqual({ start: "2026-10-05", end: "2026-10-11" });
    expect(weekRange("2026-10-05", 1)).toEqual({ start: "2026-10-05", end: "2026-10-11" });
  });
  it("可配置为周日起始", () => {
    expect(weekRange("2026-10-11", 0)).toEqual({ start: "2026-10-11", end: "2026-10-17" });
    expect(weekRange("2026-10-10", 0)).toEqual({ start: "2026-10-04", end: "2026-10-10" });
  });
  it("跨年、闰年日期运算正确", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2024-02-28", 2)).toBe("2024-03-01");
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
  });
});

describe("月份与跨月周", () => {
  it("月份范围", () => {
    expect(monthRange("2026-02")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
    expect(monthRange("2024-02").end).toBe("2024-02-29");
  });
  it("日历网格覆盖完整自然周", () => {
    expect(monthGridRange("2026-10", 1)).toEqual({ start: "2026-09-28", end: "2026-11-01" });
  });
  it("跨月周按日期归属拆分，只有完整周标记为 full", () => {
    const weeks = weeksOfMonth("2026-10", 1);
    expect(weeks[0]).toEqual({
      weekStart: "2026-09-28",
      weekEnd: "2026-10-04",
      from: "2026-10-01",
      to: "2026-10-04",
      full: false,
    });
    expect(weeks[1].full).toBe(true);
    expect(weeks[weeks.length - 1]).toMatchObject({ weekStart: "2026-10-26", from: "2026-10-26", to: "2026-10-31", full: false });
    // 各周落在本月的日期范围拼起来恰好覆盖整月且不重叠
    const days = weeks.flatMap((w) => [w.from, w.to]);
    expect(days[0]).toBe("2026-10-01");
    expect(days[days.length - 1]).toBe("2026-10-31");
  });
  it("月初恰好是周起始日时不产生空周", () => {
    const weeks = weeksOfMonth("2026-06", 1); // 2026-06-01 是周一
    expect(weeks[0]).toMatchObject({ weekStart: "2026-06-01", full: true });
  });
});
