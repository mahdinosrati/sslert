import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { createInMemoryDb } from "../db/index.js";
import { runSqlMigrations } from "../db/sqlmigrate.js";
import { createApp } from "../index.js";
import { ensureInitialAdmin, hashPassword } from "../services/users.js";
import {
  users,
  domains,
  userDomains,
  resources,
  userResources,
  connections,
  notificationPolicies,
  deliveries,
  alertChannels,
} from "../db/schema.js";
import {
  initializeNotifications,
  dispatchExpiry,
  checkResourceExpiry,
} from "../services/notifications.js";
import { __resetRateLimiterForTests } from "../middleware/rate-limit.js";
import { eq } from "drizzle-orm";
const send = vi.hoisted(() =>
  vi.fn(
    async (
      ..._args: any[]
    ): Promise<{
      id?: string;
      partial?: boolean;
      error?: string;
      failureCode?: string;
    }> => ({
      id: "sent-1",
    }),
  ),
);
vi.mock("../services/channels.js", () => ({
  getChannelSender: () => ({ send }),
}));
describe("Bamdad accounts, access, resources and notification policies", () => {
  let store: ReturnType<typeof createInMemoryDb>;
  let app: ReturnType<typeof createApp>;
  beforeEach(async () => {
    vi.stubEnv("AUTH_DISABLED", "");
    vi.stubEnv("RATE_LIMIT_PER_MINUTE", "10000");
    vi.stubEnv("ALERT_EMAIL_TO", "");
    __resetRateLimiterForTests();
    store = createInMemoryDb();
    runSqlMigrations(store.sqlite);
    await ensureInitialAdmin(store.db);
    initializeNotifications(store.db);
    store.db.update(notificationPolicies).set({ scheduleMode: "repeat" }).run();
    app = createApp({ db: store.db });
    send.mockClear();
  });
  afterEach(() => {
    store.sqlite.close();
    vi.unstubAllEnvs();
  });
  const req = (path: string, method = "GET", body?: unknown, cookie = "") =>
    app.request("/api" + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-SSLert-Request": "1",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  async function login(username = "admin", password = "admin") {
    const r = await req("/auth/login", "POST", { username, password });
    expect(r.status).toBe(200);
    return r.headers.get("set-cookie")!.split(";")[0];
  }
  async function admin() {
    const cookie = await login();
    const r = await req(
      "/auth/password",
      "POST",
      { currentPassword: "admin", password: "a-new-safe-password" },
      cookie,
    );
    expect(r.status).toBe(200);
    return r.headers.get("set-cookie")!.split(";")[0];
  }
  async function ordinary() {
    const u = store.db
      .insert(users)
      .values({
        username: "viewer",
        passwordHash: await hashPassword("viewer-password"),
        role: "user",
        mustChangePassword: false,
      })
      .returning()
      .get()!;
    return { u, cookie: await login("viewer", "viewer-password") };
  }
  it("forces the initial password change, rotates sessions, and never resets admin on restart", async () => {
    const cookie = await login();
    expect((await req("/resources", "GET", undefined, cookie)).status).toBe(
      403,
    );
    const r = await req(
      "/auth/password",
      "POST",
      { currentPassword: "admin", password: "a-new-safe-password" },
      cookie,
    );
    expect(r.status).toBe(200);
    expect((await req("/auth/me", "GET", undefined, cookie)).status).toBe(401);
    await ensureInitialAdmin(store.db);
    expect(
      (
        await req("/auth/login", "POST", {
          username: "admin",
          password: "admin",
        })
      ).status,
    ).toBe(401);
    expect(store.db.select().from(users).all()).toHaveLength(1);
  });
  it("requires CSRF header for login and session writes", async () => {
    expect(
      (
        await app.request("/api/auth/login", {
          method: "POST",
          body: JSON.stringify({ username: "admin", password: "admin" }),
        })
      ).status,
    ).toBe(403);
    const c = await admin();
    expect(
      (
        await app.request("/api/auth/logout", {
          method: "POST",
          headers: { Cookie: c },
        })
      ).status,
    ).toBe(403);
  });
  it("hides unassigned domains/resources and forbids writes/admin endpoints", async () => {
    const { u, cookie } = await ordinary();
    const d = store.db
      .insert(domains)
      .values({ hostname: "example.com" })
      .returning()
      .get()!;
    const r = store.db
      .insert(resources)
      .values({
        kind: "api",
        title: "API subscription",
        expiresAt: "2027-01-01",
      })
      .returning()
      .get()!;
    expect(
      (await req("/domains/" + d.id, "GET", undefined, cookie)).status,
    ).toBe(404);
    expect(
      (await (await req("/resources", "GET", undefined, cookie)).json())
        .resources,
    ).toEqual([]);
    for (const path of ["/users", "/settings", "/audit-log"])
      expect((await req(path, "GET", undefined, cookie)).status).toBe(403);
    expect(
      (
        await req(
          "/resources",
          "POST",
          { kind: "api", title: "A", expiresAt: "2027-01-01" },
          cookie,
        )
      ).status,
    ).toBe(403);
    store.db
      .insert(userResources)
      .values({ userId: u.id, resourceId: r.id })
      .run();
    expect(
      (await (await req("/resources", "GET", undefined, cookie)).json())
        .resources,
    ).toHaveLength(1);
    expect(
      (await req("/resources/" + r.id, "DELETE", undefined, cookie)).status,
    ).toBe(403);
  });
  it("honors create/edit/test independently and auto-assigns created resources", async () => {
    const { u, cookie } = await ordinary();
    store.db
      .update(users)
      .set({ canCreate: true })
      .where(eq(users.id, u.id))
      .run();
    const input = {
      kind: "api",
      title: "API validity only",
      expiresAt: "2027-01-01",
    };
    const created = await req("/resources", "POST", input, cookie);
    expect(created.status).toBe(201);
    const id = (await created.json()).resource.id;
    expect(store.db.select().from(userResources).get()?.resourceId).toBe(id);
    expect((await req("/resources/" + id, "PUT", input, cookie)).status).toBe(
      403,
    );
    store.db
      .update(users)
      .set({ canEdit: true })
      .where(eq(users.id, u.id))
      .run();
    expect((await req("/resources/" + id, "PUT", input, cookie)).status).toBe(
      200,
    );
    expect(
      (
        await req(
          "/resources",
          "POST",
          { ...input, token: "must-not-store" },
          cookie,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await req(
          "/resources",
          "POST",
          { ...input, expiresAt: "2027-02-30" },
          cookie,
        )
      ).status,
    ).toBe(400);
    expect(
      (await req("/resources", "POST", { ...input, expiresAt: null }, cookie))
        .status,
    ).toBe(400);
  });
  it("protects the last administrator and revokes sessions on privilege change", async () => {
    const c = await admin();
    expect((await req("/users/1", "PATCH", { enabled: false }, c)).status).toBe(
      409,
    );
    const { u, cookie } = await ordinary();
    expect(
      (await req("/users/" + u.id, "PATCH", { canCreate: true }, c)).status,
    ).toBe(200);
    expect((await req("/auth/me", "GET", undefined, cookie)).status).toBe(401);
  });
  it("redacts private connection configs and rejects unauthorized selection/test", async () => {
    const { u, cookie } = await ordinary();
    const conn = store.db
      .insert(connections)
      .values({
        name: "Private",
        channel: "telegram",
        config: JSON.stringify({
          botToken: "secret",
          chatId: "123",
          language: "fa",
        }),
      })
      .returning()
      .get()!;
    expect(
      (
        await (
          await req("/notifications/connections", "GET", undefined, cookie)
        ).json()
      ).connections,
    ).toEqual([]);
    store.db
      .update(connections)
      .set({ shared: true })
      .where(eq(connections.id, conn.id))
      .run();
    const json = await (
      await req("/notifications/connections", "GET", undefined, cookie)
    ).json();
    expect(JSON.stringify(json)).not.toContain("secret");
    expect(
      (
        await req(
          `/notifications/connections/${conn.id}/test`,
          "POST",
          {},
          cookie,
        )
      ).status,
    ).toBe(403);
    store.db
      .update(users)
      .set({ canTest: true })
      .where(eq(users.id, u.id))
      .run();
    expect(
      (
        await req(
          `/notifications/connections/${conn.id}/test`,
          "POST",
          {},
          cookie,
        )
      ).status,
    ).toBe(200);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].text).toContain("آزمایشی");
    expect(
      (
        await req(
          `/notifications/connections/${conn.id}/test`,
          "POST",
          {},
          cookie,
        )
      ).status,
    ).toBe(429);
    expect(
      (
        await req(
          "/notifications/policies/global",
          "PUT",
          {
            mode: "disabled",
            connectionIds: [],
            thresholds: [0],
            repeatHours: 24,
          },
          cookie,
        )
      ).status,
    ).toBe(403);
  });
  it("inherits, replaces and disables receivers; deduplicates each connection independently", async () => {
    const ids = [1, 2].map(
      (n) =>
        store.db
          .insert(connections)
          .values({
            name: "C" + n,
            channel: "telegram",
            config: JSON.stringify({
              language: n === 1 ? "fa" : "en",
              chatId: String(n),
            }),
          })
          .returning()
          .get()!.id,
    );
    store.db
      .update(notificationPolicies)
      .set({ connectionIds: JSON.stringify(ids) })
      .where(eq(notificationPolicies.key, "global"))
      .run();
    await Promise.all([
      dispatchExpiry(store.db, "resource:1", "api", "API expiry", 5),
      dispatchExpiry(store.db, "resource:1", "api", "API expiry", 5),
    ]);
    expect(send).toHaveBeenCalledTimes(2);
    store.db
      .insert(notificationPolicies)
      .values({
        key: "resource:2",
        scheduleMode: "repeat",
        mode: "custom",
        connectionIds: JSON.stringify([ids[1]]),
      })
      .run();
    await dispatchExpiry(store.db, "resource:2", "license", "License", 5);
    expect(send).toHaveBeenCalledTimes(3);
    store.db
      .update(notificationPolicies)
      .set({ mode: "disabled" })
      .where(eq(notificationPolicies.key, "resource:2"))
      .run();
    await dispatchExpiry(store.db, "resource:2", "license", "License", 0);
    expect(send).toHaveBeenCalledTimes(3);
  });
  it("retries failed delivery after fifteen minutes without waiting the seven-day repeat window", async () => {
    const conn = store.db
      .insert(connections)
      .values({
        name: "SMTP",
        channel: "email",
        config: '{"to":"recipient@example.org"}',
      })
      .returning()
      .get()!;
    store.db
      .update(notificationPolicies)
      .set({ connectionIds: JSON.stringify([conn.id]), repeatHours: 168 })
      .where(eq(notificationPolicies.key, "global"))
      .run();
    send.mockResolvedValueOnce({
      error: "provider password must never appear",
      failureCode: "smtp_timeout",
    });
    await dispatchExpiry(store.db, "domain:4", "cert", "example.org", 10);
    expect(store.db.select().from(deliveries).get()).toMatchObject({
      status: "failed",
      error: "SMTP connection timed out.",
    });
    await dispatchExpiry(store.db, "domain:4", "cert", "example.org", 10);
    expect(send).toHaveBeenCalledTimes(1);
    store.db
      .update(deliveries)
      .set({ createdAt: new Date(Date.now() - 16 * 60_000).toISOString() })
      .run();
    await Promise.all([
      dispatchExpiry(store.db, "domain:4", "cert", "example.org", 10),
      dispatchExpiry(store.db, "domain:4", "cert", "example.org", 10),
    ]);
    expect(send).toHaveBeenCalledTimes(2);
    expect(
      store.db
        .select()
        .from(deliveries)
        .all()
        .map((x) => x.status),
    ).toEqual(["failed", "sent"]);
    store.db
      .update(deliveries)
      .set({ createdAt: new Date(Date.now() - 60 * 60_000).toISOString() })
      .where(eq(deliveries.status, "sent"))
      .run();
    await dispatchExpiry(store.db, "domain:4", "cert", "example.org", 10);
    expect(send).toHaveBeenCalledTimes(2);
  });
  it("checks API/license dates but skips perpetual and disabled records", async () => {
    const conn = store.db
      .insert(connections)
      .values({
        name: "Email",
        channel: "email",
        config: '{"to":"recipient@example.org"}',
      })
      .returning()
      .get()!;
    store.db
      .update(notificationPolicies)
      .set({ connectionIds: JSON.stringify([conn.id]) })
      .where(eq(notificationPolicies.key, "global"))
      .run();
    store.db
      .insert(resources)
      .values([
        { kind: "api", title: "Old API", expiresAt: "2020-01-01" },
        { kind: "license", title: "Forever", expiresAt: null },
        {
          kind: "license",
          title: "Off",
          expiresAt: "2020-01-01",
          enabled: false,
        },
      ])
      .run();
    await checkResourceExpiry(store.db);
    await checkResourceExpiry(store.db);
    expect(send).toHaveBeenCalledTimes(1);
    expect(store.db.select().from(deliveries).all()).toHaveLength(1);
  });
  it("migration preserves old per-domain receivers and is idempotent", async () => {
    store.db.delete(notificationPolicies).run();
    store.db.delete(connections).run();
    store.sqlite
      .prepare("DELETE FROM app_settings WHERE key = ?")
      .run("central_notifications");
    const d = store.db
      .insert(domains)
      .values({ hostname: "example.org" })
      .returning()
      .get()!;
    store.db
      .insert(alertChannels)
      .values({
        domainId: d.id,
        channel: "telegram",
        config: '{"language":"fa","to":"recipient@example.org"}',
      })
      .run();
    initializeNotifications(store.db);
    initializeNotifications(store.db);
    expect(store.db.select().from(connections).all()).toHaveLength(1);
    const p = store.db
      .select()
      .from(notificationPolicies)
      .where(eq(notificationPolicies.key, `domain:${d.id}`))
      .get()!;
    expect(p.mode).toBe("custom");
    expect(JSON.parse(p.connectionIds)).toHaveLength(1);
  });

  it("accepts internal manual domains/certificates, validates dates and dispatches their expiry", async () => {
    const cookie = await admin();
    for (const kind of ["domain", "cert"]) {
      const input = {
        kind,
        title: "Internal service",
        hostname: "service.corp.local",
        provider: "Organization CA",
        validFrom: "2020-01-01",
        expiresAt: "2021-01-01",
        serial: "01:AB",
      };
      const result = await req("/resources", "POST", input, cookie);
      expect(result.status).toBe(201);
      expect((await result.json()).resource.hostname).toBe(input.hostname);
      expect(
        (await req("/resources", "POST", { ...input, hostname: "" }, cookie))
          .status,
      ).toBe(400);
      expect(
        (await req("/resources", "POST", { ...input, expiresAt: null }, cookie))
          .status,
      ).toBe(400);
      expect(
        (
          await req(
            "/resources",
            "POST",
            { ...input, validFrom: "2022-01-01" },
            cookie,
          )
        ).status,
      ).toBe(400);
    }
    const conn = store.db
      .insert(connections)
      .values({
        name: "Alerts",
        channel: "email",
        config: '{"language":"fa","to":"recipient@example.org"}',
      })
      .returning()
      .get()!;
    store.db
      .update(notificationPolicies)
      .set({ connectionIds: JSON.stringify([conn.id]) })
      .where(eq(notificationPolicies.key, "global"))
      .run();
    await checkResourceExpiry(store.db);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls.map((call) => call[0].source)).toEqual([
      "domain",
      "cert",
    ]);
    expect(send.mock.calls[0][0].text).toContain("service.corp.local");
  });

  it("deletes accounts, revokes sessions and preserves monitored resources", async () => {
    const c = await admin();
    const { u, cookie } = await ordinary();
    const r = store.db
      .insert(resources)
      .values({ title: "Keep", kind: "license" })
      .returning()
      .get()!;
    store.db
      .insert(userResources)
      .values({ userId: u.id, resourceId: r.id })
      .run();
    expect((await req("/users/1", "DELETE", undefined, c)).status).toBe(409);
    expect((await req("/users/1", "DELETE", undefined, cookie)).status).toBe(
      403,
    );
    expect((await req("/users/" + u.id, "DELETE", undefined, c)).status).toBe(
      200,
    );
    expect((await req("/auth/me", "GET", undefined, cookie)).status).toBe(401);
    expect(store.db.select().from(resources).all()).toHaveLength(1);
    expect(store.db.select().from(userResources).all()).toHaveLength(0);
  });
  it("encrypts SMTP credentials, hides them and preserves them on edits", async () => {
    const c = await admin();
    const body = {
      name: "SMTP",
      channel: "email",
      enabled: true,
      shared: true,
      config: {
        emailProvider: "smtp",
        to: "recipient@example.com",
        from: "sender@example.com",
        smtpHost: "mail.internal",
        smtpPort: 587,
        smtpSecurity: "starttls",
        smtpAuth: true,
        smtpUsername: "sender",
        smtpPassword: "smtp-test-secret",
      },
    };
    const response = await req("/notifications/connections", "POST", body, c);
    expect(response.status).toBe(200);
    const result = await response.json();
    const id = result.connection.id;
    expect(result.connection.config.smtpPassword).toBeUndefined();
    expect(result.connection.config.smtpPasswordSet).toBe(true);
    expect(
      store.db.select().from(connections).where(eq(connections.id, id)).get()!
        .config,
    ).not.toContain("smtp-test-secret");
    const { smtpPassword, ...config } = body.config;
    expect(
      (
        await req(
          "/notifications/connections/" + id,
          "PUT",
          { ...body, name: "Edited", config },
          c,
        )
      ).status,
    ).toBe(200);
    expect(
      (await req("/notifications/connections/" + id + "/test", "POST", {}, c))
        .status,
    ).toBe(200);
    expect(send.mock.calls.at(-1)?.[1]).toMatchObject({
      smtpPassword: "smtp-test-secret",
    });
    const { cookie } = await ordinary();
    const viewed = await (
      await req("/notifications/connections", "GET", undefined, cookie)
    ).json();
    expect(JSON.stringify(viewed)).not.toContain("smtpUsername");
  });
  it("filters and paginates history without exposing unassigned targets", async () => {
    const c = await admin();
    const { u, cookie } = await ordinary();
    const r = store.db
      .insert(resources)
      .values({ title: "Allowed", kind: "license" })
      .returning()
      .get()!;
    store.db
      .insert(userResources)
      .values({ userId: u.id, resourceId: r.id })
      .run();
    for (let i = 0; i < 55; i++)
      store.db
        .insert(deliveries)
        .values({
          targetKey: "resource:" + r.id,
          source: "license",
          level: "7",
          status: "sent",
          createdAt: new Date().toISOString(),
        })
        .run();
    store.db
      .insert(deliveries)
      .values({
        targetKey: "resource:999",
        source: "license",
        level: "7",
        status: "failed",
        createdAt: new Date().toISOString(),
      })
      .run();
    const first = await (
      await req("/notifications/history", "GET", undefined, cookie)
    ).json();
    expect(first.deliveries).toHaveLength(50);
    expect(first.hasMore).toBe(true);
    expect(first.deliveries[0].targetName).toBe("Allowed");
    const second = await (
      await req("/notifications/history?page=1", "GET", undefined, cookie)
    ).json();
    expect(second.deliveries).toHaveLength(5);
    expect(
      (
        await (
          await req(
            "/notifications/history?status=failed",
            "GET",
            undefined,
            cookie,
          )
        ).json()
      ).deliveries,
    ).toHaveLength(0);
    expect(
      (
        await (
          await req("/notifications/history?status=failed", "GET", undefined, c)
        ).json()
      ).deliveries,
    ).toHaveLength(1);
  });

  it("reports scoped effective alert coverage without secrets", async () => {
    const c = await admin();
    const { u, cookie } = await ordinary();
    const r = store.db
      .insert(resources)
      .values({ kind: "license", title: "Assigned" })
      .returning()
      .get()!;
    const hidden = store.db
      .insert(resources)
      .values({ kind: "license", title: "Hidden" })
      .returning()
      .get()!;
    store.db
      .insert(userResources)
      .values({ userId: u.id, resourceId: r.id })
      .run();
    const conn = store.db
      .insert(connections)
      .values({
        name: "SMTP",
        channel: "email",
        enabled: true,
        config: JSON.stringify({
          emailProvider: "smtp",
          smtpPassword: "secret",
          to: "recipient@example.org",
        }),
      })
      .returning()
      .get()!;
    store.db
      .update(notificationPolicies)
      .set({ connectionIds: JSON.stringify([conn.id]) })
      .where(eq(notificationPolicies.key, "global"))
      .run();
    const result = await (
      await req("/notifications/coverage", "GET", undefined, cookie)
    ).json();
    expect(result.coverage).toEqual({ ["resource:" + r.id]: true });
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(
      (await (await req("/notifications/coverage", "GET", undefined, c)).json())
        .coverage["resource:" + hidden.id],
    ).toBe(true);
    store.db
      .update(connections)
      .set({ enabled: false })
      .where(eq(connections.id, conn.id))
      .run();
    expect(
      (
        await (
          await req("/notifications/coverage", "GET", undefined, cookie)
        ).json()
      ).coverage["resource:" + r.id],
    ).toBe(false);
  });
  it("saves multiple recipients and tests the complete saved list", async () => {
    const c = await admin();
    const body = {
      name: "Team",
      channel: "email",
      enabled: true,
      shared: false,
      config: {
        to: "one@example.com, two@example.com\none@example.com",
        from: "sender@example.com",
      },
    };
    const response = await req("/notifications/connections", "POST", body, c);
    expect(response.status).toBe(200);
    const connection = (await response.json()).connection;
    expect(connection.config.to).toEqual([
      "one@example.com",
      "two@example.com",
    ]);
    send.mockResolvedValueOnce({ id: "partial-delivery", partial: true });
    await req(
      "/notifications/connections/" + connection.id + "/test",
      "POST",
      {},
      c,
    );
    expect(send.mock.calls.slice(-2).map((call) => call[1].to)).toEqual([
      "one@example.com",
      "two@example.com",
    ]);
    expect(
      store.db
        .select()
        .from(deliveries)
        .all()
        .slice(-2)
        .map((row) => row.status),
    ).toEqual(["partial", "sent"]);
    expect(
      (
        await req(
          "/notifications/connections",
          "POST",
          { ...body, config: { to: "bad,email" } },
          c,
        )
      ).status,
    ).toBe(400);
  });

  it("creates contracts, validates date ranges and dispatches contract alerts", async () => {
    const cookie = await admin();
    const body = {
      kind: "contract",
      title: "Support contract",
      contractNumber: "CT-2026",
      provider: "Example partner",
      owner: "IT",
      validFrom: "2026-01-01",
      expiresAt: "2026-11-01",
    };
    const response = await req("/resources", "POST", body, cookie);
    expect(response.status).toBe(201);
    const record = (await response.json()).resource;
    expect(record).toMatchObject(body);
    expect(
      (
        await req(
          "/resources",
          "POST",
          { ...body, validFrom: "2027-01-01" },
          cookie,
        )
      ).status,
    ).toBe(400);
    expect(
      (await req("/resources", "POST", { ...body, expiresAt: null }, cookie))
        .status,
    ).toBe(400);
    const conn = store.db
      .insert(connections)
      .values({
        name: "Contract mail",
        channel: "email",
        config: JSON.stringify({ to: "ops@example.com", language: "fa" }),
      })
      .returning()
      .get()!;
    store.db
      .update(notificationPolicies)
      .set({ connectionIds: JSON.stringify([conn.id]) })
      .where(eq(notificationPolicies.key, "global"))
      .run();
    await dispatchExpiry(
      store.db,
      "resource:" + record.id,
      "contract",
      body.title,
      7,
    );
    expect(send.mock.calls.at(-1)?.[0]).toMatchObject({ source: "contract" });
    expect(send.mock.calls.at(-1)?.[0].subject).toContain("قرارداد");
  });

  it("saves user contacts and administrator-selected routes without changing LDAP permissions", async () => {
    const cookie = await admin();
    const user = store.db
      .insert(users)
      .values({
        username: "ad:reader",
        authSource: "ldap",
        passwordHash: "!",
        role: "user",
        mustChangePassword: false,
      })
      .returning()
      .get()!;
    const contact = await req(
      "/users/" + user.id,
      "PATCH",
      {
        email: "reader@example.org",
        mobile: "+989120000000",
        notificationChannels: ["email", "sms"],
      },
      cookie,
    );
    expect(contact.status).toBe(200);
    expect((await contact.json()).user).toMatchObject({
      role: "user",
      canEdit: false,
      email: "reader@example.org",
      notificationChannels: ["email", "sms"],
    });
    const conn = store.db
      .insert(connections)
      .values({
        name: "SMTP",
        channel: "email",
        config: '{"to":"other@example.org"}',
      })
      .returning()
      .get()!;
    const policy = {
      mode: "custom",
      connectionIds: [],
      recipients: [{ userId: user.id, connectionId: conn.id }],
      thresholds: [30, 20, 10, 7, 6, 5, 4, 3, 2, 1, 0],
      scheduleMode: "milestones",
      repeatHours: 24,
    };
    expect(
      (await req("/notifications/policies/global", "PUT", policy, cookie))
        .status,
    ).toBe(200);
    const resource = store.db
      .insert(resources)
      .values({
        kind: "contract",
        title: "Contract",
        expiresAt: new Date().toISOString().slice(0, 10),
      })
      .returning()
      .get()!;
    expect(
      (
        await (
          await req(
            "/notifications/recipients/" + user.id,
            "GET",
            undefined,
            cookie,
          )
        ).json()
      ).targets,
    ).toContainEqual({
      key: "resource:" + resource.id,
      name: "Contract",
      subscribed: true,
      inherited: true,
    });
    await checkResourceExpiry(store.db);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][1].to).toBe("reader@example.org");
    const { cookie: ordinaryCookie } = await ordinary();
    expect(
      (
        await req(
          "/notifications/recipients/" + user.id,
          "GET",
          undefined,
          ordinaryCookie,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await (
          await req(
            "/notifications/policies/global",
            "GET",
            undefined,
            ordinaryCookie,
          )
        ).json()
      ).policy.recipients,
    ).toEqual([]);
    expect(
      (
        await req(
          "/notifications/policies/global",
          "PUT",
          policy,
          ordinaryCookie,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await req(
          "/users/" + user.id,
          "PATCH",
          { email: "bad\r\nheader" },
          cookie,
        )
      ).status,
    ).toBe(400);
  });
  it("keeps SMS drafts disabled, encrypts tokens and refuses real test delivery", async () => {
    const cookie = await admin();
    const result = await req(
      "/notifications/connections",
      "POST",
      {
        name: "SMS draft",
        channel: "sms",
        enabled: true,
        shared: false,
        config: {
          smsUrl: "http://192.0.2.1:1111/api/sms/send-pattern",
          smsAuthToken: "test-secret",
        },
      },
      cookie,
    );
    expect(result.status).toBe(200);
    const { connection } = await result.json();
    expect(connection.enabled).toBe(false);
    expect(JSON.stringify(connection)).not.toContain("test-secret");
    expect(
      store.db
        .select()
        .from(connections)
        .where(eq(connections.id, connection.id))
        .get()!.config,
    ).not.toContain("test-secret");
    expect(
      (
        await req(
          "/notifications/connections/" + connection.id + "/test",
          "POST",
          {},
          cookie,
        )
      ).status,
    ).toBe(409);
    expect(send).not.toHaveBeenCalled();
  });
  it("accepts panel port 80 without changing the running listener", async () => {
    const cookie = await admin();
    const result = await req("/settings/port", "PUT", { port: 80 }, cookie);
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({
      desiredPort: 80,
      requiresServerCommand: true,
      command: "sudo bash scripts/set-web-port.sh 80",
    });
    expect(
      (await req("/settings/port", "PUT", { port: 0 }, cookie)).status,
    ).toBe(400);
  });
});
