import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
const domain = { id: 1, hostname: "example.com", port: 443, enabled: true };
const check = {
  id: 1,
  checkedAt: "2026-10-28T10:00:00Z",
  valid: true,
  daysRemaining: 5,
  error: null,
  issuer: "Example CA",
  issuerOrg: "Example CA",
  serial: "01:AB:23",
  notBefore: "2026-01-01T00:00:00Z",
  notAfter: "2026-11-02T00:00:00Z",
  domainExpiresAt: "2027-01-01T00:00:00Z",
  domainExpiresDaysRemaining: 65,
  domainRegistrar: "Example Registrar",
  domainRegistrarError: null,
};
test.beforeEach(async ({ page }) => {
  let signed = false;
  let user = {
    id: 1,
    username: "admin",
    role: "admin",
    enabled: true,
    mustChangePassword: true,
    canCreate: true,
    canEdit: true,
    canTest: true,
  };
  let resources = [
    {
      id: 1,
      kind: "license",
      title: "لایسنس سامانه پشتیبان‌گیری",
      provider: "Example Software",
      owner: "تیم زیرساخت",
      notes: "تمدید سالانه",
      expiresAt: "2026-11-02",
      enabled: true,
    },
    {
      id: 2,
      kind: "api",
      title: "اعتبار سرویس API",
      provider: "Example API",
      owner: "تیم توسعه",
      notes: "فقط تاریخ اعتبار ثبت شده است.",
      expiresAt: "2026-12-20",
      enabled: true,
    },
  ];
  const connections = [
    {
      id: 1,
      name: "ایمیل تیم فناوری اطلاعات",
      channel: "email",
      enabled: true,
      shared: true,
      config: { to: "alerts@example.com", language: "fa" },
    },
    {
      id: 2,
      name: "تلگرام تیم پشتیبانی",
      channel: "telegram",
      enabled: true,
      shared: true,
      config: { chatId: "example", language: "fa" },
    },
  ];
  const policies: Record<string, any> = {
    global: {
      mode: "custom",
      connectionIds: [1, 2],
      thresholds: [30, 7, 1, 0],
      repeatHours: 24,
    },
  };
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    let body: any = {};
    let status = 200;
    if (path === "/api/auth/login") {
      signed = true;
      body = { user };
    } else if (path === "/api/auth/me") {
      body = signed ? { user } : { error: "Authentication required" };
      status = signed ? 200 : 401;
    } else if (path === "/api/auth/password") {
      user = { ...user, mustChangePassword: false };
      body = { user };
    } else if (path === "/api/auth/logout") {
      signed = false;
      body = { ok: true };
    } else if (path === "/api/domains")
      body = { domains: [{ domain, lastCheck: check }] };
    else if (path === "/api/dashboard")
      body = {
        total: 1,
        healthy: 0,
        expired: 0,
        expiringSoon: 1,
        domainExpiringSoon: 0,
        domainExpired: 0,
      };
    else if (path === "/api/domains/1") body = { domain, checks: [check] };
    else if (path === "/api/resources") {
      if (method === "POST") {
        resources.push({
          ...route.request().postDataJSON(),
          id: resources.length + 1,
        });
      }
      body = { resources };
    } else if (path === "/api/notifications/connections") {
      if (method === "POST")
        connections.push({
          ...route.request().postDataJSON(),
          id: connections.length + 1,
        });
      body = { connections };
    } else if (path.endsWith("/test")) body = { status: "sent" };
    else if (path.startsWith("/api/notifications/policies/")) {
      const key = path.split("/").pop()!;
      if (method === "PUT") policies[key] = route.request().postDataJSON();
      body = {
        policy: policies[key] || {
          mode: "inherit",
          connectionIds: [],
          thresholds: [30, 7, 1, 0],
          repeatHours: 24,
        },
      };
    } else if (path === "/api/notifications/history")
      body = {
        deliveries: [
          {
            id: 1,
            targetKey: "domain:1",
            source: "cert",
            status: "sent",
            createdAt: check.checkedAt,
            isTest: false,
          },
        ],
      };
    else if (path === "/api/users")
      body = {
        users: [
          user,
          {
            id: 2,
            username: "operator",
            role: "user",
            enabled: true,
            canCreate: true,
            canEdit: false,
            canTest: false,
            domainIds: [1],
            resourceIds: [1],
          },
        ],
      };
    else if (path === "/api/settings")
      body = {
        desiredPort: 5173,
        command: "sudo bash scripts/set-web-port.sh 5173",
      };
    else if (path === "/api/audit-log")
      body = {
        total: 1,
        rows: [
          {
            id: 1,
            timestamp: check.checkedAt,
            actorType: "user",
            actorId: "admin",
            action: "resource.create",
            resourceType: "resource",
            resourceId: "1",
            metadata: {},
          },
        ],
      };
    await route.fulfill({ status, json: body });
  });
});
async function login(page: Page, fa = false) {
  await page.goto("/login");
  await page
    .getByRole("combobox", { name: /^(Language|زبان)$/ })
    .selectOption(fa ? "fa" : "en");
  await page
    .getByLabel(fa ? "نام کاربری" : "Username", { exact: true })
    .fill("admin");
  await page
    .getByLabel(fa ? "رمز عبور" : "Password", { exact: true })
    .fill("admin");
  await page
    .getByRole("button", { name: fa ? "ورود" : "Sign in", exact: true })
    .click();
  await expect(page).toHaveURL(/password/);
  await page
    .getByLabel(fa ? "رمز عبور فعلی" : "Current password", { exact: true })
    .fill("admin");
  await page
    .getByLabel(fa ? "رمز عبور جدید" : "New password", { exact: true })
    .fill("a-new-safe-password");
  await page
    .getByLabel(fa ? "تکرار رمز عبور" : "Confirm password", { exact: true })
    .fill("a-new-safe-password");
  await page
    .getByRole("button", { name: fa ? "ذخیره" : "Save", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: fa ? "داشبورد" : "Dashboard",
      exact: true,
    }),
  ).toBeVisible();
}
test("English default, mandatory password change and Persian persistence", async ({
  page,
}) => {
  await login(page);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.getByLabel("Language", { exact: true }).selectOption("fa");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(
    page.getByRole("heading", { name: "داشبورد", exact: true }),
  ).toBeVisible();
  await page.goto("/about");
  await expect(
    page.getByText("این برنامه توسط مهدی نصرتی توسعه داده شده است."),
  ).toBeVisible();
  await page.getByLabel("زبان", { exact: true }).selectOption("en");
  await expect(
    page.getByText("This application was developed by Mahdi Nosrati."),
  ).toBeVisible();
});
test("resource records only store API expiry and policy replaces defaults", async ({
  page,
}) => {
  await login(page);
  await page.goto("/resources");
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Type", exact: true })
    .selectOption("api");
  await page.getByLabel("Title", { exact: true }).fill("API expiry only");
  await page
    .getByLabel("Expiry date (Gregorian, UTC)", { exact: true })
    .fill("2027-01-01");
  const sent = page.waitForRequest(
    (r) => r.method() === "POST" && r.url().endsWith("/resources"),
  );
  await page.getByRole("button", { name: "Save", exact: true }).click();
  expect((await sent).postDataJSON()).toMatchObject({
    kind: "api",
    expiresAt: "2027-01-01",
  });
  await expect(
    page.getByRole("heading", { name: "API expiry only" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Notifications", exact: true })
    .first()
    .click();
  await page
    .getByRole("combobox", { name: "Mode", exact: true })
    .selectOption("disabled");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Saved");
});
test("test notification button works independently of expiry", async ({
  page,
}) => {
  await login(page);
  await page.goto("/notifications");
  await page
    .getByRole("button", { name: "Send test", exact: true })
    .first()
    .click();
  await expect(page.getByRole("status").first()).toHaveText(
    "Test notification sent",
  );
  await page
    .getByRole("button", { name: "Add connection", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Alert language", exact: true })
    .selectOption("fa");
  await expect(
    page.getByRole("combobox", { name: "Alert language", exact: true }),
  ).toHaveValue("fa");
});
test("Vazir, mobile and theme persistence", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, true);
  await page.getByLabel("ظاهر", { exact: true }).selectOption("dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const font = await page.evaluate(async () => {
    await document.fonts.load('16px "Vazir"', "فارسی");
    return getComputedStyle(document.body).fontFamily;
  });
  expect(font).toContain("Vazir");
  for (const path of [
    "/",
    "/resources",
    "/notifications",
    "/users",
    "/about",
  ]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});
test("documentation screenshots in light and dark themes", async ({
  page,
}, info) => {
  test.setTimeout(60000);
  const folder =
    process.env.SSLERT_DOC_SCREENSHOTS === "1"
      ? fileURLToPath(new URL("../../../docs/images/fa", import.meta.url))
      : info.outputPath("docs");
  await mkdir(folder, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.clock.setFixedTime(new Date("2026-10-28T12:00:00Z"));
  await page.goto("/login");
  await page.getByLabel("Language", { exact: true }).selectOption("fa");
  await page.getByLabel("ظاهر", { exact: true }).selectOption("light");
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: resolve(folder, "login.png"), fullPage: true });
  await page.getByLabel("ظاهر", { exact: true }).selectOption("dark");
  await page.screenshot({path:resolve(folder,"login-dark.png"),fullPage:true});
  await login(page);
  await page.getByLabel("Language", { exact: true }).selectOption("fa");
  for (const theme of ["light", "dark"]) {
    await page.getByLabel("ظاهر", { exact: true }).selectOption(theme);
    for (const [path, name] of [
      ["/", "dashboard"],
      ["/domains/1", "domain"],
      ["/resources", "resources"],
      ["/notifications", "notifications"],
      ["/users", "users"],
      ["/about", "about"],
      ["/audit", "audit"],
    ]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({
        path: resolve(folder, `${name}${theme === "dark" ? "-dark" : ""}.png`),
        fullPage: true,
      });
    }
  }
});
