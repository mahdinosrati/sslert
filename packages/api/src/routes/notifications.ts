import { Hono } from "hono";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import type { DB } from "../db/index.js";
import type { AuthEnv, RequestActor } from "../middleware/auth.js";
import {
  connections,
  notificationPolicies,
  deliveries,
  domains,
  resources,
} from "../db/schema.js";
import { canAccessTarget } from "../middleware/permissions.js";
import { readPolicy, sendConnection } from "../services/notifications.js";
import { channelConfigSchema, validateChannelConfig } from "./channels.js";
import { recordAudit } from "../services/audit.js";
const policySchema = z
  .object({
    mode: z.enum(["inherit", "custom", "disabled"]),
    connectionIds: z.array(z.number().int().positive()).max(50),
    thresholds: z.array(z.number().int().min(0).max(3650)).min(1).max(20),
    repeatHours: z.number().int().min(1).max(8760),
  })
  .strict();
const connectionSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    channel: z.enum(["email", "telegram", "webhook", "slack", "ntfy"]),
    enabled: z.boolean(),
    shared: z.boolean(),
    config: channelConfigSchema,
  })
  .strict();
export function createNotificationsRouter(db: DB) {
  const app = new Hono<AuthEnv>();
  const exists = (key: string) => {
    const [kind, id] = key.split(":");
    return kind === "domain"
      ? !!db
          .select()
          .from(domains)
          .where(eq(domains.id, Number(id)))
          .get()
      : kind === "resource"
        ? !!db
            .select()
            .from(resources)
            .where(eq(resources.id, Number(id)))
            .get()
        : false;
  };
  const allowed = (a: RequestActor) => {
    if (a.role === "admin") return db.select().from(connections).all();
    const ids = new Set(readPolicy(db, "global").connectionIds);
    for (const p of db.select().from(notificationPolicies).all())
      if (canAccessTarget(db, a, p.key))
        for (const id of JSON.parse(p.connectionIds)) ids.add(id);
    return db
      .select()
      .from(connections)
      .all()
      .filter((r) => r.shared || ids.has(r.id));
  };
  const audit = (a: RequestActor, action: string, id: string) =>
    recordAudit(db, {
      actorType: a.kind,
      actorId: a.label,
      action,
      resourceType: "notification",
      resourceId: id,
    });
  app.get("/connections", (c) =>
    c.json({
      connections: allowed(c.get("actor")!).map((r) =>
        c.get("actor")!.role === "admin"
          ? { ...r, config: JSON.parse(r.config) }
          : {
              id: r.id,
              name: r.name,
              channel: r.channel,
              enabled: r.enabled,
              shared: r.shared,
              config: { language: JSON.parse(r.config).language ?? "en" },
            },
      ),
    }),
  );
  for (const method of ["post", "put"] as const)
    app[method](
      method === "post" ? "/connections" : "/connections/:id",
      async (c) => {
        const actor = c.get("actor")!;
        if (actor.role !== "admin")
          return c.json({ error: "Administrator access required" }, 403);
        const input = connectionSchema.safeParse(
          await c.req.json().catch(() => null),
        );
        if (!input.success)
          return c.json({ error: "Invalid connection settings" }, 400);
        const data = input.data;
        const invalid = await validateChannelConfig(data.channel, data.config);
        if (invalid)
          return c.json({ error: "Invalid connection settings" }, 400);
        if (data.channel === "email" && !data.config.to)
          return c.json({ error: "Recipient email is required" }, 400);
        if (
          data.channel === "telegram" &&
          (!data.config.botToken || !data.config.chatId)
        )
          return c.json({ error: "Bot token and chat ID are required" }, 400);
        const values = { ...data, config: JSON.stringify(data.config) };
        const row =
          method === "post"
            ? db.insert(connections).values(values).returning().get()
            : db
                .update(connections)
                .set(values)
                .where(eq(connections.id, Number(c.req.param("id"))))
                .returning()
                .get();
        if (!row) return c.json({ error: "Not found" }, 404);
        audit(actor, "connection.save", String(row.id));
        return c.json({
          connection: { ...row, config: JSON.parse(row.config) },
        });
      },
    );
  app.delete("/connections/:id", (c) => {
    if (c.get("actor")!.role !== "admin")
      return c.json({ error: "Administrator access required" }, 403);
    const id = Number(c.req.param("id"));
    db.transaction((tx) => {
      tx.delete(connections).where(eq(connections.id, id)).run();
      for (const p of tx.select().from(notificationPolicies).all())
        tx.update(notificationPolicies)
          .set({
            connectionIds: JSON.stringify(
              (JSON.parse(p.connectionIds) as number[]).filter((n) => n !== id),
            ),
          })
          .where(eq(notificationPolicies.key, p.key))
          .run();
    });
    audit(c.get("actor")!, "connection.delete", String(id));
    return c.json({ ok: true });
  });
  app.post("/connections/:id/test", async (c) => {
    const row = allowed(c.get("actor")!).find(
      (r) => r.id === Number(c.req.param("id")),
    );
    if (!row) return c.json({ error: "Not found" }, 404);
    const result = await sendConnection(
      db,
      row,
      `connection:${row.id}`,
      "test",
      row.name,
      null,
      "test",
      true,
    );
    audit(c.get("actor")!, "connection.test", String(row.id));
    return c.json(
      {
        ...result,
        ...(result.status === "failed"
          ? { error: "Delivery failed. Check connection settings." }
          : result.status === "deduped"
            ? { error: "Please wait 30 seconds before testing again." }
            : {}),
      },
      result.status === "failed"
        ? 502
        : result.status === "deduped"
          ? 429
          : 200,
    );
  });
  app.get("/policies/:key", (c) => {
    const key = c.req.param("key");
    if (
      key !== "global" &&
      (!canAccessTarget(db, c.get("actor"), key) || !exists(key))
    )
      return c.json({ error: "Not found" }, 404);
    return c.json({ policy: readPolicy(db, key) });
  });
  app.put("/policies/:key", async (c) => {
    const key = c.req.param("key"),
      actor = c.get("actor")!;
    if (
      key === "global"
        ? actor.role !== "admin"
        : !canAccessTarget(db, actor, key) || !exists(key)
    )
      return c.json({ error: "Access denied" }, 403);
    const parsed = policySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success || (key === "global" && parsed.data.mode === "inherit"))
      return c.json({ error: "Invalid notification policy" }, 400);
    const data = parsed.data;
    const ids = new Set(allowed(actor).map((r) => r.id));
    if (data.connectionIds.some((id) => !ids.has(id)))
      return c.json({ error: "Connection is unavailable" }, 403);
    const values = {
      key,
      ...data,
      connectionIds: JSON.stringify([...new Set(data.connectionIds)]),
      thresholds: JSON.stringify(
        [...new Set(data.thresholds)].sort((a, b) => b - a),
      ),
    };
    db.insert(notificationPolicies)
      .values(values)
      .onConflictDoUpdate({ target: notificationPolicies.key, set: values })
      .run();
    audit(actor, "policy.save", key);
    return c.json({ policy: readPolicy(db, key) });
  });
  app.get("/history", (c) => {
    const a = c.get("actor")!;
    const rows = db
      .select()
      .from(deliveries)
      .orderBy(desc(deliveries.id))
      .all()
      .filter((r) => a.role === "admin" || canAccessTarget(db, a, r.targetKey))
      .slice(0, 100);
    return c.json({ deliveries: rows });
  });
  return app;
}
