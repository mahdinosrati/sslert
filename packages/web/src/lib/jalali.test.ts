import { describe, it, expect } from "vitest";
import { fromJalaliDate, toJalaliDate } from "./jalali";
describe("Jalali date input", () => {
  it("converts Persian and Arabic digits without timezone changes", () => {
    expect(fromJalaliDate("۱۴۰۵/۰۸/۱۰")).toBe("2026-11-01");
    expect(fromJalaliDate("١٤٠٥/٠٨/١٠")).toBe("2026-11-01");
    expect(toJalaliDate("2026-11-01")).toBe("1405/08/10");
  });
  it("validates leap years and month boundaries", () => {
    expect(fromJalaliDate("1399/12/30")).toBe("2021-03-20");
    expect(fromJalaliDate("1400/12/30")).toBeNull();
    expect(fromJalaliDate("1405/07/31")).toBeNull();
    expect(fromJalaliDate("1405/13/01")).toBeNull();
    expect(fromJalaliDate("1405/00/10")).toBeNull();
  });
  it("round trips end of year and preserves existing ISO dates", () => {
    for (const date of ["2025-03-20", "2025-03-21", "2026-11-01", "2030-12-31"])
      expect(fromJalaliDate(toJalaliDate(date))).toBe(date);
  });
});
