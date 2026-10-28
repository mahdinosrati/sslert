import { and, eq, inArray, type AnyColumn } from "drizzle-orm";
import type { MiddlewareHandler } from "hono";
import type { DB } from "../db/index.js";
import { userDomains, userResources } from "../db/schema.js";
import type { AuthEnv, RequestActor } from "./auth.js";
export function domainScope(
  db: DB,
  actor: RequestActor | undefined,
  column: AnyColumn,
) {
  if (!actor || actor.role === "admin") return undefined;
  return inArray(
    column,
    db
      .select({ id: userDomains.domainId })
      .from(userDomains)
      .where(eq(userDomains.userId, actor.userId)),
  );
}
export function resourceScope(
  db: DB,
  actor: RequestActor | undefined,
  column: AnyColumn,
) {
  if (!actor || actor.role === "admin") return undefined;
  return inArray(
    column,
    db
      .select({ id: userResources.resourceId })
      .from(userResources)
      .where(eq(userResources.userId, actor.userId)),
  );
}
export function canAccessDomain(
  db: DB,
  actor: RequestActor | undefined,
  id: number,
) {
  return (
    !actor ||
    actor.role === "admin" ||
    !!db
      .select()
      .from(userDomains)
      .where(
        and(eq(userDomains.userId, actor.userId), eq(userDomains.domainId, id)),
      )
      .get()
  );
}
export function canAccessResource(
  db: DB,
  actor: RequestActor | undefined,
  id: number,
) {
  return (
    !actor ||
    actor.role === "admin" ||
    !!db
      .select()
      .from(userResources)
      .where(
        and(
          eq(userResources.userId, actor.userId),
          eq(userResources.resourceId, id),
        ),
      )
      .get()
  );
}
export function canAccessTarget(
  db: DB,
  actor: RequestActor | undefined,
  key: string,
) {
  const m = key.match(/^(domain|resource):([1-9]\d*)$/);
  return (
    !!m &&
    (m[1] === "domain"
      ? canAccessDomain(db, actor, Number(m[2]))
      : canAccessResource(db, actor, Number(m[2])))
  );
}
export function createPermissionsMiddleware(
  db: DB,
): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    const actor = c.get("actor");
    if (!actor) return c.json({ error: "Authentication required" }, 401);
    if (actor.role === "admin") return next();
    const path = c.req.path.replace(/\/$/, "");
    const method = c.req.method;
    if (path.startsWith("/api/auth/")) return next();
    if (/^\/api\/(users|settings|tokens|audit-log)(\/|$)/.test(path))
      return c.json({ error: "Administrator access required" }, 403);
    if (method === "DELETE")
      return c.json({ error: "Administrator access required" }, 403);
    if (method !== "GET") {
      const permission = path.endsWith("/test")
        ? actor.canTest
        : method === "POST" && /^\/api\/(domains|resources)$/.test(path)
          ? actor.canCreate
          : actor.canEdit;
      if (!permission) return c.json({ error: "Access denied" }, 403);
    }
    const match = path.match(/^\/api\/(domains|resources)\/([^/]+)(?:\/|$)/);
    if (
      match &&
      !(match[1] === "domains"
        ? canAccessDomain(db, actor, Number(match[2]))
        : canAccessResource(db, actor, Number(match[2])))
    )
      return c.json({ error: "Not found" }, 404);
    if (
      path === "/api/checks" &&
      c.req.query("domain_id") &&
      !canAccessDomain(db, actor, Number(c.req.query("domain_id")))
    )
      return c.json({ error: "Not found" }, 404);
    // Connection secrets and the legacy per-domain connection editor belong to administrators.
    if (
      path.includes("/channels") &&
      method !== "GET" &&
      !path.endsWith("/test")
    )
      return c.json({ error: "Administrator access required" }, 403);
    if (
      /^\/api\/(domains|resources|notifications|dashboard|checks|alerts|config)(\/|$)/.test(
        path,
      )
    )
      return next();
    return c.json({ error: "Access denied" }, 403);
  };
}
