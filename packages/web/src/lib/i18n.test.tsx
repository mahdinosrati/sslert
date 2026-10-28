import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LanguageSwitcher } from "../components/LanguageSwitcher";
import { getLanguage, setLanguage, t, formatNumber, errorMessage } from "./i18n";
import { formatDate, formatRelative } from "./format";
import { certErrorTitle } from "./cert-errors";

beforeEach(() => setLanguage("en"));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); setLanguage("en"); });

describe("language preference", () => {
  it("starts in English and updates direction, labels and storage when switched", () => {
    render(<LanguageSwitcher />);
    expect(getLanguage()).toBe("en");
    expect(document.documentElement.dir).toBe("ltr");
    fireEvent.change(screen.getByRole("combobox", { name: "Language" }), { target: { value: "fa" } });
    expect(screen.getByRole("combobox", { name: "زبان" })).toBeTruthy();
    expect(localStorage.getItem("sslert.language")).toBe("fa");
    expect(document.documentElement.lang).toBe("fa");
    expect(document.documentElement.dir).toBe("rtl");
    expect(t("Dashboard")).toBe("داشبورد");
    expect(certErrorTitle("cert_expired")).toBe("گواهی منقضی شده است");
  });

  it("handles cross-tab changes and falls back to English for unsupported preferences", () => {
    localStorage.setItem("sslert.language", "fa");
    window.dispatchEvent(new StorageEvent("storage", { key: "sslert.language" }));
    expect(getLanguage()).toBe("fa");
    localStorage.setItem("sslert.language", "xx");
    window.dispatchEvent(new StorageEvent("storage", { key: "sslert.language" }));
    expect(getLanguage()).toBe("en");
  });

  it("still switches when browser storage is blocked", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    setLanguage("fa");
    expect(getLanguage()).toBe("fa");
    expect(document.documentElement.dir).toBe("rtl");
  });

  it("preserves technical values and unknown diagnostics", () => {
    setLanguage("fa");
    expect(t("Remove {hostname}?", { hostname: "example.com" })).toContain("example.com");
    expect(t("unknown_server_code")).toBe("unknown_server_code");
    expect(errorMessage({ status: 401 })).toContain("توکن");
    expect(formatNumber(123)).toBe("۱۲۳");
  });
});

describe("localized dates", () => {
  it("uses the Persian calendar without changing the instant", () => {
    setLanguage("fa");
    expect(formatDate("2024-03-20T12:00:00Z")).toContain("۱۴۰۳");
    expect(formatDate("2024-03-20 12:00:00")).toBe(formatDate("2024-03-20T12:00:00Z"));
    expect(formatDate("invalid")).toBe("—");
    setLanguage("en");
    expect(formatDate("2024-03-20T12:00:00Z")).toContain("2024");
  });

  it("distinguishes future expiry from past checks in both languages", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-28T12:00:00Z"));
    expect(formatRelative("2026-10-28T11:55:00Z")).toBe("5m ago");
    expect(formatRelative("2026-10-30T12:00:00Z")).toBe("in 2 days");
    setLanguage("fa");
    expect(formatRelative("2026-10-28T11:55:00Z")).toContain("پیش");
    expect(formatRelative("2026-10-30T12:00:00Z")).toContain("دیگر");
    expect(formatRelative("invalid")).toBe("—");
  });
});
