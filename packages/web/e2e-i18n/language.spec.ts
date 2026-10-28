import { test, expect } from "@playwright/test";
import type { AlertChannel } from "../src/lib/api";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const domain = { id: 1, hostname: "example.com", port: 443, enabled: true };
const check = {
  id: 1, checkedAt: "2026-10-28T10:00:00Z", valid: false, daysRemaining: 5,
  error: "hostname_mismatch", issuer: "Example CA", issuerOrg: "Example CA",
  serial: "01:AB:23", notBefore: "2026-01-01T00:00:00Z", notAfter: "2026-11-02T00:00:00Z",
  domainExpiresAt: "2027-01-01T00:00:00Z", domainExpiresDaysRemaining: 65,
  domainRegistrar: "Example Registrar", domainRegistrarError: null,
};
test.beforeEach(async ({ page }) => {
  const channels: AlertChannel[] = [];
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url());
    let body: unknown = {};
    if (url.pathname === "/api/domains") body = { domains: [{ domain, lastCheck: check }] };
    if (url.pathname === "/api/dashboard") body = { total: 1, healthy: 0, expired: 0, expiringSoon: 1, domainExpiringSoon: 0, domainExpired: 0 };
    if (url.pathname === "/api/domains/1") body = { domain, checks: [check] };
    if (url.pathname === "/api/domains/1/channels") {
      if (route.request().method() === "POST") {
        const data = route.request().postDataJSON();
        const index = channels.findIndex(c => c.channel === data.channel);
        const saved = { ...data, id: index < 0 ? channels.length + 1 : channels[index].id, domainId: 1 };
        if (index < 0) channels.push(saved); else channels[index] = saved;
        body = { channel: saved };
      } else body = { channels };
    }
    if (url.pathname === "/api/audit-log") body = { total: 1, rows: [{ id: 1, timestamp: check.checkedAt, actorType: "api_token", actorId: "1", action: "domain.create", resourceType: "domain", resourceId: "1", metadata: { hostname: "example.com" } }] };
    await route.fulfill({ json: body });
  });
});

test("English default, Persian login, preference persistence and switch back", async ({ page }) => {
  await page.goto("/login");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { name: "Sign in to SSLert" })).toBeVisible();
  await page.getByLabel("API token").fill("cp_example_token");
  await page.getByRole("combobox", { name: "Language" }).selectOption("fa");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByLabel("توکن API")).toHaveValue("cp_example_token");
  await expect(page.getByLabel("توکن API")).toHaveAttribute("dir", "ltr");
  await page.reload();
  await expect(page.getByRole("heading", { name: "ورود به SSLert" })).toBeVisible();
  await expect(page).toHaveTitle("ورود · SSLert");
  await page.getByRole("combobox", { name: "زبان" }).selectOption("en");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.getByRole("heading", { name: "Sign in to SSLert" })).toBeVisible();
});

test("Persian dashboard, forms, details and audit keep API values intact", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("combobox").selectOption("fa");
  await page.getByLabel("توکن API").fill("cp_example_token");
  await page.getByRole("button", { name: "ورود", exact: true }).click();
  await expect(page.getByRole("heading", { name: "داشبورد" })).toBeVisible();
  await page.getByRole("button", { name: "+ افزودن" }).click();
  await expect(page.getByLabel("نام میزبان")).toHaveAttribute("dir", "ltr");
  await expect(page.getByRole("button", { name: "افزودن و بررسی", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "انصراف" }).click();
  await page.getByRole("cell", { name: "example.com:443" }).click();
  await expect(page.getByRole("heading", { name: "example.com:443" })).toBeVisible();
  await expect(page.getByText("نام میزبان با گواهی مطابقت ندارد", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "تلگرام", exact: true }).click();
  await page.getByLabel("توکن ربات").fill("123:abc");
  await page.getByLabel("شناسهٔ گفتگو").fill("-100123");
  await expect(page.getByLabel("زبان هشدار", { exact: true })).toHaveValue("en");
  await page.getByLabel("زبان هشدار", { exact: true }).selectOption("fa");
  const requestPromise = page.waitForRequest(request => request.method() === "POST" && request.url().endsWith("/channels"));
  await page.getByRole("button", { name: "ذخیره", exact: true }).click();
  expect((await requestPromise).postDataJSON()).toEqual({ channel: "telegram", enabled: true, config: { botToken: "123:abc", chatId: "-100123", language: "fa" } });
  await expect(page.getByRole("button", { name: "ویرایش کانال" })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "ویرایش کانال" }).click();
  await expect(page.getByLabel("زبان هشدار", { exact: true })).toHaveValue("fa");
  await expect(page.getByLabel("توکن ربات")).toHaveValue("123:abc");
  await expect(page.getByLabel("شناسهٔ گفتگو")).toHaveValue("-100123");
  await page.getByRole("combobox", { name: "زبان", exact: true }).selectOption("en");
  await expect(page.getByLabel("Alert language", { exact: true })).toHaveValue("fa");
  await page.getByLabel("Alert language", { exact: true }).selectOption("en");
  const updatePromise = page.waitForRequest(request => request.method() === "POST" && request.url().endsWith("/channels"));
  await page.getByRole("button", { name: "Save", exact: true }).click();
  expect((await updatePromise).postDataJSON().config).toEqual({ botToken: "123:abc", chatId: "-100123", language: "en" });
  await page.getByRole("combobox", { name: "Language", exact: true }).selectOption("fa");
  await page.getByRole("link", { name: "فعالیت‌ها", exact: true }).click();
  await expect(page.getByRole("heading", { name: "گزارش فعالیت‌ها" })).toBeVisible();
  await expect(page.getByText("domain.create", { exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "زبان" }).selectOption("en");
  await expect(page.getByRole("heading", { name: "Audit log" })).toBeVisible();
});

test("email language can be selected and edited independently", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("API token").fill("cp_example_token");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.goto("/domains/1");
  await page.getByRole("button", { name: "Email (Resend)", exact: true }).click();
  await page.getByLabel("To", { exact: true }).fill("alerts@example.com");
  await page.getByLabel("From", { exact: true }).fill("sslert@example.com");
  await page.getByLabel("Alert language", { exact: true }).selectOption("fa");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit channel" })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Edit channel" }).click();
  await expect(page.getByLabel("To", { exact: true })).toHaveValue("alerts@example.com");
  await expect(page.getByLabel("From", { exact: true })).toHaveValue("sslert@example.com");
  await expect(page.getByLabel("Alert language", { exact: true })).toHaveValue("fa");
});

test("capture Persian documentation screens with demo data", async ({ page }, testInfo) => {
  const folder = process.env.SSLERT_DOC_SCREENSHOTS === "1"
    ? fileURLToPath(new URL("../../../docs/images/fa", import.meta.url)) : testInfo.outputPath("docs");
  await mkdir(folder, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 960 });
  await page.clock.setFixedTime(new Date("2026-10-28T12:00:00Z"));
  await page.goto("/login");
  await page.getByRole("combobox").selectOption("fa");
  await page.evaluate(async () => { await document.fonts.ready; });
  await page.screenshot({ path: resolve(folder, "login.png"), fullPage: true });
  await page.getByLabel("توکن API").fill("cp_example_token");
  await page.getByRole("button", { name: "ورود", exact: true }).click();
  await expect(page.getByRole("heading", { name: "داشبورد" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "example.com:443" })).toBeVisible();
  await page.screenshot({ path: resolve(folder, "dashboard.png"), fullPage: true });
  await page.goto("/domains/1");
  await expect(page.getByRole("heading", { name: "example.com:443" })).toBeVisible();
  await expect(page.getByRole("button", { name: "تلگرام", exact: true })).toBeVisible();
  await page.screenshot({ path: resolve(folder, "domain.png"), fullPage: true });
  await page.getByRole("button", { name: "تلگرام", exact: true }).click();
  await page.getByLabel("زبان هشدار", { exact: true }).selectOption("fa");
  await page.screenshot({ path: resolve(folder, "alert-language.png"), fullPage: true });
  await page.goto("/audit");
  await expect(page.getByText("domain.create", { exact: true })).toBeVisible();
  await page.screenshot({ path: resolve(folder, "audit.png"), fullPage: true });
});

test("Vazir loads locally and Persian layouts fit mobile", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login");
  await page.getByRole("combobox").selectOption("fa");
  const fonts = await page.evaluate(async () => {
    await document.fonts.load('16px "Vazir"', 'فارسی');
    await document.fonts.ready;
    return { family: getComputedStyle(document.body).fontFamily, loaded: document.fonts.check('16px "Vazir"', 'فارسی') };
  });
  expect(fonts.family).toContain("Vazir");
  expect(fonts.loaded).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("persian-login.png"), fullPage: true });
  await page.getByLabel("توکن API").fill("cp_example_token");
  await page.getByRole("button", { name: "ورود", exact: true }).click();
  await expect(page.getByRole("heading", { name: "داشبورد" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("persian-dashboard-mobile.png"), fullPage: true });
  await page.goto("/domains/1");
  await expect(page.getByRole("heading", { name: "example.com:443" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: testInfo.outputPath("persian-detail-desktop.png"), fullPage: true });
});
