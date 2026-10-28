import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { eq } from "drizzle-orm";
import type { DB } from "../db/index.js";
import { apiTokens, sessions, users } from "../db/schema.js";
import { hashToken } from "../services/auth.js";

export const SESSION_COOKIE = "sslert_session";
export interface RequestActor {
  id: number;
  userId: number;
  label: string;
  role: "admin" | "user";
  kind: "user" | "api_token" | "system";
  mustChangePassword: boolean;
  canCreate?: boolean;
  canEdit?: boolean;
  canTest?: boolean;
}
export type AuthEnv = { Variables: { actor?: RequestActor } };
export function createAuthMiddleware(db: DB): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    if (process.env.AUTH_DISABLED === "1") {
      if (process.env.NODE_ENV === "production")
        throw new Error("AUTH_DISABLED=1 is forbidden in production");
      c.set("actor", {
        id: 0,
        userId: 0,
        label: "development",
        role: "admin",
        kind: "system",
        mustChangePassword: false,
      });
      return next();
    }
    const header = c.req.header("authorization");
    let userId: number;
    let tokenId: number | undefined;
    if (header) {
      if (!header.startsWith("Bearer "))
        return c.json({ error: "Invalid token" }, 401);
      const found = db
        .select()
        .from(apiTokens)
        .where(eq(apiTokens.tokenHash, hashToken(header.slice(7).trim())))
        .get();
      if (!found) return c.json({ error: "Invalid token" }, 401);
      if (found.expiresAt && new Date(found.expiresAt).getTime() <= Date.now())
        return c.json({ error: "Token expired" }, 401);
      if (!found.userId)
        return c.json(
          {
            error: "Legacy token has no owner. Create a new token for a user.",
          },
          401,
        );
      userId = found.userId;
      tokenId = found.id;
    } else {
      const cookie = getCookie(c, SESSION_COOKIE);
      const session = cookie
        ? db
            .select()
            .from(sessions)
            .where(eq(sessions.tokenHash, hashToken(cookie)))
            .get()
        : null;
      if (!session || Date.parse(session.expiresAt) <= Date.now())
        return c.json({ error: "Authentication required" }, 401);
      userId = session.userId;
      if (
        !["GET", "HEAD", "OPTIONS"].includes(c.req.method) &&
        c.req.header("X-SSLert-Request") !== "1"
      )
        return c.json({ error: "Invalid request origin" }, 403);
    }
    const user = db.select().from(users).where(eq(users.id, userId)).get();
    if (!user?.enabled)
      return c.json({ error: "Account disabled or unavailable" }, 401);
    c.set("actor", {
      id: tokenId ?? user.id,
      userId: user.id,
      label: user.username,
      role: user.role,
      canCreate: user.canCreate,
      canEdit: user.canEdit,
      canTest: user.canTest,
      kind: tokenId ? "api_token" : "user",
      mustChangePassword: user.mustChangePassword,
    });
    if (
      user.mustChangePassword &&
      !["/api/auth/me", "/api/auth/password", "/api/auth/logout"].includes(
        c.req.path,
      )
    )
      return c.json(
        { error: "Password change required", code: "PASSWORD_CHANGE_REQUIRED" },
        403,
      );
    if (tokenId)
      db.update(apiTokens)
        .set({ lastUsedAt: new Date().toISOString() })
        .where(eq(apiTokens.id, tokenId))
        .run();
    return next();
  };
}
