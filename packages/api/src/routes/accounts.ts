import { Hono, type Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { and, eq, lt, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "../db/index.js";
import {
  users,
  sessions,
  userDomains,
  userResources,
  resources,
  domains,
  loginAttempts,
  apiTokens,
} from "../db/schema.js";
import { generateToken, hashToken } from "../services/auth.js";
import {
  hashPassword,
  verifyPassword,
  publicUser,
  revokeUserAccess,
} from "../services/users.js";
import { recordAudit } from "../services/audit.js";
import { SESSION_COOKIE, type AuthEnv } from "../middleware/auth.js";

const passwordSchema = z
  .string()
  .min(12)
  .max(256)
  .refine((p) => p.trim().length >= 12, "Use at least 12 characters");
const usernameSchema = z
  .string()
  .trim()
  .min(3)
  .max(64)
  .regex(/^[a-zA-Z0-9_.-]+$/)
  .transform((s) => s.toLowerCase());
const permissionsShape = {
  canCreate: z.boolean().optional(),
  canEdit: z.boolean().optional(),
  canTest: z.boolean().optional(),
};
const roleSchema = z.enum(["admin", "user"]);
const cookieOptions = () => ({
  httpOnly: true,
  sameSite: "Strict" as const,
  secure: process.env.SESSION_COOKIE_SECURE === "1",
  path: "/",
  maxAge: 12 * 3600,
});
function issueSession(c: Context, db: DB, userId: number) {
  const raw = generateToken();
  db.delete(sessions)
    .where(lt(sessions.expiresAt, new Date().toISOString()))
    .run();
  db.insert(sessions)
    .values({
      userId,
      tokenHash: hashToken(raw),
      expiresAt: new Date(Date.now() + 12 * 3600_000).toISOString(),
    })
    .run();
  setCookie(c, SESSION_COOKIE, raw, cookieOptions());
}
function audit(
  c: Context<AuthEnv>,
  db: DB,
  action: string,
  id: number,
  metadata = {},
) {
  recordAudit(db, {
    actorType: c.get("actor")?.kind ?? "user",
    actorId: c.get("actor")?.label ?? "login",
    action,
    resourceType: "user",
    resourceId: String(id),
    metadata,
  });
}

export function createLoginRouter(db: DB) {
  const app = new Hono();
  app.post("/login", async (c) => {
    if (c.req.header("X-SSLert-Request") !== "1")
      return c.json({ error: "Invalid request origin" }, 403);
    const parsed = z
      .object({
        username: usernameSchema,
        password: z.string().min(1).max(256),
      })
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json({ error: "Invalid username or password" }, 401);
    const key = hashToken(parsed.data.username);
    const now = new Date().toISOString();
    db.delete(loginAttempts).where(lt(loginAttempts.expiresAt, now)).run();
    const prior = db
      .select()
      .from(loginAttempts)
      .where(eq(loginAttempts.key, key))
      .get();
    if (prior && prior.count >= 5)
      return c.json(
        { error: "Too many login attempts. Try again in 15 minutes." },
        429,
      );
    // Reserve an attempt before the asynchronous hash to cap concurrent guesses too.
    db.insert(loginAttempts)
      .values({
        key,
        count: 1,
        expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      })
      .onConflictDoUpdate({
        target: loginAttempts.key,
        set: { count: sql`${loginAttempts.count} + 1` },
      })
      .run();
    const user = db
      .select()
      .from(users)
      .where(eq(users.username, parsed.data.username))
      .get();
    const valid = user
      ? await verifyPassword(parsed.data.password, user.passwordHash)
      : (await hashPassword(parsed.data.password), false);
    if (!user?.enabled || !valid) {
      recordAudit(db, {
        actorType: "user",
        actorId: parsed.data.username,
        action: "auth.login.failure",
        resourceType: "auth",
        resourceId: null,
      });
      return c.json({ error: "Invalid username or password" }, 401);
    }
    // Password/account may have changed while scrypt was running.
    const current = db.select().from(users).where(eq(users.id, user.id)).get();
    if (!current?.enabled || current.passwordHash !== user.passwordHash)
      return c.json({ error: "Invalid username or password" }, 401);
    db.delete(loginAttempts).where(eq(loginAttempts.key, key)).run();
    issueSession(c, db, user.id);
    recordAudit(db, {
      actorType: "user",
      actorId: user.username,
      action: "auth.login.success",
      resourceType: "auth",
      resourceId: String(user.id),
    });
    return c.json({ user: publicUser(current) });
  });
  return app;
}

export function createAccountRouter(db: DB) {
  const app = new Hono<AuthEnv>();
  app.get("/auth/me", (c) => {
    const actor = c.get("actor")!;
    const user = db
      .select()
      .from(users)
      .where(eq(users.id, actor.userId))
      .get();
    return c.json({
      user: user
        ? publicUser(user)
        : {
            id: 0,
            username: "development",
            role: "admin",
            mustChangePassword: false,
            enabled: true,
          },
    });
  });
  app.post("/auth/logout", (c) => {
    const raw = getCookie(c, SESSION_COOKIE);
    if (raw)
      db.delete(sessions)
        .where(eq(sessions.tokenHash, hashToken(raw)))
        .run();
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: true });
  });
  app.post("/auth/password", async (c) => {
    const input = z
      .object({
        currentPassword: z.string().max(256),
        password: passwordSchema,
      })
      .safeParse(await c.req.json().catch(() => null));
    if (!input.success)
      return c.json(
        { error: "Password must contain at least 12 characters" },
        400,
      );
    const user = db
      .select()
      .from(users)
      .where(eq(users.id, c.get("actor")!.userId))
      .get();
    if (
      !user ||
      !(await verifyPassword(input.data.currentPassword, user.passwordHash))
    )
      return c.json({ error: "Current password is incorrect" }, 400);
    if (input.data.password === input.data.currentPassword)
      return c.json({ error: "Choose a different password" }, 400);
    const passwordHash = await hashPassword(input.data.password);
    db.transaction((tx) => {
      const updated = tx
        .update(users)
        .set({ passwordHash, mustChangePassword: false })
        .where(
          and(
            eq(users.id, user.id),
            eq(users.enabled, true),
            eq(users.passwordHash, user.passwordHash),
          ),
        )
        .run();
      if (!updated.changes)
        throw new Error("Account changed during password update");
      revokeUserAccess(tx, user.id);
    });
    issueSession(c, db, user.id);
    audit(c, db, "user.password.change", user.id);
    return c.json({
      user: publicUser(
        db.select().from(users).where(eq(users.id, user.id)).get()!,
      ),
    });
  });

  app.get("/users", (c) =>
    c.json({
      users: db
        .select()
        .from(users)
        .all()
        .map((user) => ({
          ...publicUser(user),
          resourceIds: db
            .select()
            .from(userResources)
            .where(eq(userResources.userId, user.id))
            .all()
            .map((r) => r.resourceId),
          domainIds: db
            .select()
            .from(userDomains)
            .where(eq(userDomains.userId, user.id))
            .all()
            .map((d) => d.domainId),
        })),
    }),
  );
  const createSchema = z.object({
    username: usernameSchema,
    password: passwordSchema,
    role: roleSchema,
    ...permissionsShape,
    resourceIds: z.array(z.number().int().positive()).max(1000).default([]),
    domainIds: z.array(z.number().int().positive()).max(1000).default([]),
  });
  app.post("/users", async (c) => {
    const parsed = createSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json(
        { error: "Invalid user details (password: 12 characters minimum)" },
        400,
      );
    const data = parsed.data;
    if (db.select().from(users).where(eq(users.username, data.username)).get())
      return c.json({ error: "Username already exists" }, 409);
    if (
      data.domainIds.some(
        (id) => !db.select().from(domains).where(eq(domains.id, id)).get(),
      )
    )
      return c.json({ error: "Invalid domain assignment" }, 400);
    if (
      data.resourceIds.some(
        (id) => !db.select().from(resources).where(eq(resources.id, id)).get(),
      )
    )
      return c.json({ error: "Invalid resource assignment" }, 400);
    const passwordHash = await hashPassword(data.password);
    const user = db.transaction((tx) => {
      const row = tx
        .insert(users)
        .values({
          username: data.username,
          passwordHash,
          role: data.role,
          canCreate: data.canCreate,
          canEdit: data.canEdit,
          canTest: data.canTest,
          mustChangePassword: true,
        })
        .returning()
        .get()!;
      for (const domainId of new Set(data.domainIds))
        tx.insert(userDomains).values({ userId: row.id, domainId }).run();
      for (const resourceId of new Set(data.resourceIds))
        tx.insert(userResources).values({ userId: row.id, resourceId }).run();
      return row;
    });
    audit(c, db, "user.create", user.id, { role: user.role });
    return c.json({ user: publicUser(user) }, 201);
  });
  app.patch("/users/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const parsed = z
      .object({
        ...permissionsShape,
        role: roleSchema.optional(),
        enabled: z.boolean().optional(),
        password: passwordSchema.optional(),
        resourceIds: z.array(z.number().int().positive()).max(1000).optional(),
        domainIds: z.array(z.number().int().positive()).max(1000).optional(),
      })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!Number.isSafeInteger(id) || !parsed.success)
      return c.json(
        { error: "Invalid user details (password: 12 characters minimum)" },
        400,
      );
    const input = parsed.data;
    const user = db.select().from(users).where(eq(users.id, id)).get();
    if (!user) return c.json({ error: "Not found" }, 404);
    if (
      input.domainIds?.some(
        (domainId) =>
          !db.select().from(domains).where(eq(domains.id, domainId)).get(),
      )
    )
      return c.json({ error: "Invalid domain assignment" }, 400);
    if (
      input.resourceIds?.some(
        (id) => !db.select().from(resources).where(eq(resources.id, id)).get(),
      )
    )
      return c.json({ error: "Invalid resource assignment" }, 400);
    const passwordHash = input.password
      ? await hashPassword(input.password)
      : undefined;
    const result = db.transaction((tx) => {
      const current = tx.select().from(users).where(eq(users.id, id)).get()!;
      if (
        current.role === "admin" &&
        current.enabled &&
        (input.enabled === false || (input.role && input.role !== "admin"))
      ) {
        const admins = tx
          .select()
          .from(users)
          .where(and(eq(users.role, "admin"), eq(users.enabled, true)))
          .all();
        if (admins.length <= 1) return null;
      }
      const update = {
        ...(input.canCreate !== undefined
          ? { canCreate: input.canCreate }
          : {}),
        ...(input.canEdit !== undefined ? { canEdit: input.canEdit } : {}),
        ...(input.canTest !== undefined ? { canTest: input.canTest } : {}),
        ...(input.role ? { role: input.role } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(passwordHash ? { passwordHash, mustChangePassword: true } : {}),
      };
      const updated = Object.keys(update).length
        ? tx
            .update(users)
            .set(update)
            .where(eq(users.id, id))
            .returning()
            .get()!
        : current;
      if (input.domainIds) {
        tx.delete(userDomains).where(eq(userDomains.userId, id)).run();
        for (const domainId of new Set(input.domainIds))
          tx.insert(userDomains).values({ userId: id, domainId }).run();
      }
      if (input.resourceIds) {
        tx.delete(userResources).where(eq(userResources.userId, id)).run();
        for (const resourceId of new Set(input.resourceIds))
          tx.insert(userResources).values({ userId: id, resourceId }).run();
      }
      // Revocation applies immediately to sessions and user-bound API tokens.
      revokeUserAccess(tx, id);
      return updated;
    });
    if (!result)
      return c.json(
        { error: "Cannot disable or demote the last administrator" },
        409,
      );
    audit(c, db, "user.update", id, {
      role: result.role,
      enabled: result.enabled,
      passwordReset: !!passwordHash,
    });
    return c.json({ user: publicUser(result) });
  });
  return app;
}
