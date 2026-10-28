import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import type { DB } from "../db/index.js";
import type { AuthEnv } from "../middleware/auth.js";
import {
  resources,
  userResources,
  notificationPolicies,
} from "../db/schema.js";
import { resourceScope } from "../middleware/permissions.js";
import { recordAudit } from "../services/audit.js";
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(s);
    return Number.isFinite(+d) && d.toISOString().slice(0, 10) === s;
  });
const shape = z
  .object({
    kind: z.enum(["license", "api"]),
    title: z.string().trim().min(1).max(200),
    provider: z.string().max(200).default(""),
    owner: z.string().max(200).default(""),
    notes: z.string().max(4000).default(""),
    expiresAt: date.nullable(),
    enabled: z.boolean().default(true),
  })
  .strict()
  .refine(
    (r) => r.kind !== "api" || r.expiresAt !== null,
    "API expiry date is required",
  );
export function createResourcesRouter(db: DB) {
  const app = new Hono<AuthEnv>();
  const audit = (c: any, action: string, id: number) =>
    recordAudit(db, {
      actorType: c.get("actor").kind,
      actorId: c.get("actor").label,
      action,
      resourceType: "resource",
      resourceId: String(id),
    });
  app.get("/", (c) =>
    c.json({
      resources: db
        .select()
        .from(resources)
        .where(resourceScope(db, c.get("actor"), resources.id))
        .all(),
    }),
  );
  app.post("/", async (c) => {
    const parsed = shape.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json({ error: "Invalid resource details or expiry date" }, 400);
    const row = db.transaction((tx) => {
      const r = tx.insert(resources).values(parsed.data).returning().get()!;
      const a = c.get("actor")!;
      if (a.role !== "admin")
        tx.insert(userResources)
          .values({ userId: a.userId, resourceId: r.id })
          .run();
      return r;
    });
    audit(c, "resource.create", row.id);
    return c.json({ resource: row }, 201);
  });
  app.put("/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const parsed = shape.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json({ error: "Invalid resource details or expiry date" }, 400);
    const row = db
      .update(resources)
      .set(parsed.data)
      .where(eq(resources.id, id))
      .returning()
      .get();
    if (!row) return c.json({ error: "Not found" }, 404);
    audit(c, "resource.update", id);
    return c.json({ resource: row });
  });
  app.delete("/:id", (c) => {
    const id = Number(c.req.param("id"));
    db.transaction((tx) => {
      tx.delete(resources).where(eq(resources.id, id)).run();
      tx.delete(notificationPolicies)
        .where(eq(notificationPolicies.key, `resource:${id}`))
        .run();
    });
    audit(c, "resource.delete", id);
    return c.json({ ok: true });
  });
  return app;
}
