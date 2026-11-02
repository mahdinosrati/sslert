import { toJalaali, toGregorian, isValidJalaaliDate } from "jalaali-js";
export const asciiDigits = (s: string) =>
  s.replace(/[۰-۹٠-٩]/g, (c) =>
    String(c.charCodeAt(0) - (c >= "۰" ? 1776 : 1632)),
  );
const pad = (n: number) => String(n).padStart(2, "0");
export function toJalaliDate(iso: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "";
  const [y, m, d] = iso.split("-").map(Number);
  try {
    const j = toJalaali(y, m, d);
    return `${j.jy}/${pad(j.jm)}/${pad(j.jd)}`;
  } catch {
    return "";
  }
}
export function fromJalaliDate(value: string): string | null {
  const parts = asciiDigits(value)
    .trim()
    .match(/^(\d{1,4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (!parts) return null;
  const [y, m, d] = parts.slice(1).map(Number);
  try {
    if (!isValidJalaaliDate(y, m, d)) return null;
    const g = toGregorian(y, m, d);
    return `${String(g.gy).padStart(4, "0")}-${pad(g.gm)}-${pad(g.gd)}`;
  } catch {
    return null;
  }
}
