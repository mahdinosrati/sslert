import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { createInMemoryDb } from "../db/index.js";
import { runSqlMigrations } from "../db/sqlmigrate.js";
import { createApp } from "../index.js";
import { ensureInitialAdmin } from "../services/users.js";
import { users, appSettings, sessions } from "../db/schema.js";
import {
  ldapDefaults,
  saveLdap,
  queryDirectory,
  escapeLdap,
  readLdap,
} from "../services/ldap.js";
import { __resetRateLimiterForTests } from "../middleware/rate-limit.js";
const mocks = vi.hoisted(() => ({
  construct: vi.fn(),
  bind: vi.fn(),
  search: vi.fn(),
  startTLS: vi.fn(),
  unbind: vi.fn(),
}));
vi.mock("ldapts", () => ({
  Client: class {
    constructor(options: unknown) {
      mocks.construct(options);
    }
    bind = mocks.bind;
    search = mocks.search;
    startTLS = mocks.startTLS;
    unbind = mocks.unbind;
  },
}));
const config = {
  ...ldapDefaults,
  enabled: true,
  host: "dc.internal",
  baseDn: "DC=example,DC=org",
  bindDn: "service@example.org",
  bindPassword: "directory-service-test",
  userGroup: "CN=PanelUsers,DC=example,DC=org",
  adminGroup: "CN=PanelAdmins,DC=example,DC=org",
};
const entry = {
  dn: "CN=Alice,DC=example,DC=org",
  sAMAccountName: "alice",
  objectGUID: Buffer.alloc(16, 1),
  userAccountControl: "512",
  accountExpires: "0",
};
describe("Active Directory integration", () => {
  let store: ReturnType<typeof createInMemoryDb>,
    app: ReturnType<typeof createApp>,
    folder: string,
    adminGroup: boolean,
    userGroup: boolean,
    entries: any[];
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
  beforeEach(async () => {
    folder = mkdtempSync(join(tmpdir(), "bamdad-ldap-"));
    vi.stubEnv("DATABASE_PATH", join(folder, "db.sqlite"));
    vi.stubEnv("AUTH_DISABLED", "");
    vi.stubEnv("RATE_LIMIT_PER_MINUTE", "10000");
    __resetRateLimiterForTests();
    store = createInMemoryDb();
    runSqlMigrations(store.sqlite);
    await ensureInitialAdmin(store.db);
    app = createApp({ db: store.db });
    adminGroup = false;
    userGroup = true;
    entries = [entry];
    vi.clearAllMocks();
    mocks.startTLS.mockResolvedValue(undefined);
    mocks.unbind.mockResolvedValue(undefined);
    mocks.bind.mockImplementation(async (_dn, password) => {
      if (!["directory-service-test", "alice-password"].includes(password))
        throw Error("sensitive provider rejection");
    });
    mocks.search.mockImplementation(async (_dn, options) => ({
      searchEntries: options.filter.includes("objectCategory")
        ? entries
        : options.filter.includes("memberOf:")
          ? (options.filter.includes("PanelAdmins") ? adminGroup : userGroup)
            ? [{ dn: entry.dn }]
            : []
          : [{ dn: config.baseDn }],
      searchReferences: [],
    }));
    saveLdap(store.db, config);
  });
  afterEach(() => {
    store.sqlite.close();
    vi.unstubAllEnvs();
    rmSync(folder, { recursive: true, force: true });
  });
  const ldapLogin = (password = "alice-password") =>
    req("/auth/login", "POST", {
      username: "alice",
      password,
      provider: "ldap",
    });
  async function localAdmin() {
    const login = await req("/auth/login", "POST", {
      username: "admin",
      password: "admin",
    });
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const changed = await req(
      "/auth/password",
      "POST",
      { currentPassword: "admin", password: "new-admin-password" },
      cookie,
    );
    return changed.headers.get("set-cookie")!.split(";")[0];
  }
  it("encrypts the service password and provisions a scoped directory user without storing their password", async () => {
    expect(JSON.stringify(readLdap(store.db))).not.toContain(
      config.bindPassword,
    );
    const response = await ldapLogin();
    expect(response.status).toBe(200);
    const user = (await response.json()).user;
    expect(user).toMatchObject({
      username: "ad:alice",
      role: "user",
      authSource: "ldap",
      mustChangePassword: false,
      canCreate: false,
    });
    const stored = store.db
      .select()
      .from(users)
      .where(eq(users.id, user.id))
      .get()!;
    expect(stored.passwordHash).toBe("!directory-account");
    expect(stored.ldapId).toBe("01".repeat(16));
    expect(mocks.construct).toHaveBeenCalledWith(
      expect.objectContaining({
        tlsOptions: expect.objectContaining({
          rejectUnauthorized: true,
          minVersion: "TLSv1.2",
        }),
      }),
    );
    expect(mocks.bind.mock.calls.at(-1)).toEqual([entry.dn, "alice-password"]);
    const cookie = response.headers.get("set-cookie")!.split(";")[0];
    expect((await req("/resources", "GET", undefined, cookie)).status).toBe(
      200,
    );
    expect((await req("/settings/ldap", "GET", undefined, cookie)).status).toBe(
      403,
    );
  });
  it("fails closed on wrong password, empty password, disabled or expired accounts, disallowed groups and duplicate results", async () => {
    expect((await ldapLogin("wrong")).status).toBe(401);
    expect((await ldapLogin("")).status).toBe(401);
    entries = [{ ...entry, userAccountControl: "514" }];
    expect((await ldapLogin()).status).toBe(401);
    entries = [{ ...entry, accountExpires: "1" }];
    expect((await ldapLogin()).status).toBe(401);
    entries = [entry];
    userGroup = false;
    expect((await ldapLogin()).status).toBe(401);
    userGroup = true;
    entries = [entry, entry];
    expect((await ldapLogin()).status).toBe(401);
    expect(store.db.select().from(users).all()).toHaveLength(1);
  });
  it("uses explicitly selected plain LDAP and limits administrator-only login to its group", async () => {
    const settings = {...config, security: "ldap" as const, port:389, adminOnly:true};
    await expect(queryDirectory(settings,{username:"alice",password:"alice-password"})).rejects.toThrow("Group not allowed");
    expect(mocks.bind).not.toHaveBeenCalledWith(entry.dn,"alice-password");
    adminGroup=true;
    const identity=await queryDirectory(settings,{username:"alice",password:"alice-password"});
    expect(identity?.role).toBe("admin");
    expect(mocks.construct).toHaveBeenLastCalledWith(expect.objectContaining({url:"ldap://dc.internal:389"}));
    expect(mocks.construct.mock.calls.at(-1)![0]).not.toHaveProperty("tlsOptions");
    expect(mocks.startTLS).not.toHaveBeenCalled();
    saveLdap(store.db,settings);
    expect((await (await ldapLogin()).json()).user.role).toBe("admin");
    adminGroup=false;
    expect((await ldapLogin()).status).toBe(401);
  });
  it("requires STARTTLS before binding and always closes on failure", async () => {
    mocks.startTLS.mockRejectedValueOnce(Error("certificate failure"));
    await expect(
      queryDirectory(
        { ...config, security: "starttls" },
        { username: "alice", password: "alice-password" },
      ),
    ).rejects.toThrow();
    expect(mocks.bind).not.toHaveBeenCalled();
    expect(mocks.unbind).toHaveBeenCalled();
    expect(escapeLdap("x*)(user=*)\\\0")).toBe(
      "x\\2a\\29\\28user=\\2a\\29\\5c\\00",
    );
  });
  it("maps only the explicit administrator group and preserves the last local administrator", async () => {
    adminGroup = true;
    const result = await ldapLogin();
    expect((await result.clone().json()).user.role).toBe("admin");
    const cookie = result.headers.get("set-cookie")!.split(";")[0];
    expect((await req("/users/1", "DELETE", undefined, cookie)).status).toBe(
      409,
    );
    expect(
      (await req("/users/1", "PATCH", { enabled: false }, cookie)).status,
    ).toBe(409);
  });
  it("revokes directory sessions after group removal or configuration changes while local login remains available", async () => {
    const result = await ldapLogin(),
      cookie = result.headers.get("set-cookie")!.split(";")[0];
    const user = (await result.json()).user;
    store.db
      .update(users)
      .set({ ldapCheckedAt: "2000-01-01T00:00:00Z" })
      .where(eq(users.id, user.id))
      .run();
    userGroup = false;
    expect((await req("/auth/me", "GET", undefined, cookie)).status).toBe(401);
    expect(store.db.select().from(sessions).all()).toHaveLength(0);
    userGroup = true;
    await ldapLogin();
    saveLdap(store.db, { ...config, enabled: false });
    expect(store.db.select().from(sessions).all()).toHaveLength(0);
    expect(
      (
        await req("/auth/login", "POST", {
          username: "admin",
          password: "admin",
        })
      ).status,
    ).toBe(200);
  });
  it("hides saved secrets, tests unsaved settings and rejects directory password reset", async () => {
    const cookie = await localAdmin();
    const read = await (
      await req("/settings/ldap", "GET", undefined, cookie)
    ).json();
    expect(read.settings.bindPassword).toBeUndefined();
    expect(read.settings.bindPasswordSet).toBe(true);
    const { bindPassword, ...settings } = config;
    const test = await req(
      "/settings/ldap/test",
      "POST",
      { settings, username: "alice" },
      cookie,
    );
    expect(test.status).toBe(200);
    expect((await test.json()).role).toBe("user");
    const login = await ldapLogin();
    const user = (await login.json()).user;
    expect(
      (
        await req(
          "/users/" + user.id,
          "PATCH",
          { password: "replacement-password" },
          cookie,
        )
      ).status,
    ).toBe(400);
    const invalid = await req(
      "/settings/ldap/save",
      "POST",
      { settings: { ...config, security: "none" } },
      cookie,
    );
    expect(invalid.status).toBe(400);
  });
});
