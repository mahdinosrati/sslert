import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import type { DB } from "../db/index.js";
import { users, appSettings, sessions, apiTokens } from "../db/schema.js";

function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );
}
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  return `scrypt:${salt}:${(await derive(password, salt)).toString("hex")}`;
}
export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  const [kind, salt, value] = hash.split(":");
  if (kind !== "scrypt" || !salt || !value || password.length > 256)
    return false;
  const expected = Buffer.from(value, "hex");
  const actual = await derive(password, salt);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export async function ensureInitialAdmin(db: DB) {
  if (
    db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, "users_initialized"))
      .get()
  )
    return;
  const passwordHash = await hashPassword("admin");
  db.transaction((tx) => {
    if (
      tx
        .select()
        .from(appSettings)
        .where(eq(appSettings.key, "users_initialized"))
        .get()
    )
      return;
    if (!tx.select({ id: users.id }).from(users).get()) {
      tx.insert(users)
        .values({
          username: "admin",
          passwordHash,
          role: "admin",
          mustChangePassword: true,
        })
        .run();
    }
    tx.insert(appSettings)
      .values({ key: "users_initialized", value: "1" })
      .onConflictDoNothing()
      .run();
  });
}
export function publicUser(user: typeof users.$inferSelect) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    canCreate: user.canCreate,
    canEdit: user.canEdit,
    canTest: user.canTest,
    enabled: user.enabled,
    mustChangePassword: user.mustChangePassword,
    createdAt: user.createdAt,
  };
}
export function revokeUserAccess(db: DB, id: number) {
  db.delete(sessions).where(eq(sessions.userId, id)).run();
  db.delete(apiTokens).where(eq(apiTokens.userId, id)).run();
}
