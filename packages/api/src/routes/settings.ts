import {
  ldapSchema,
  publicLdap,
  mergeLdap,
  saveLdap,
  queryDirectory,
  completeLdap,
} from "../services/ldap.js";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "../db/index.js";
import { appSettings } from "../db/schema.js";
import type { AuthEnv } from "../middleware/auth.js";
import { recordAudit } from "../services/audit.js";

export function createSettingsRouter(db: DB) {
  const app = new Hono<AuthEnv>();
  app.use("*", async (c, next) => {
    if (c.get("actor")?.role !== "admin")
      return c.json({ error: "Administrator access required" }, 403);
    return next();
  });
  app.get("/ldap", (c) => c.json({ settings: publicLdap(db) }));
  for (const method of ["save", "test"] as const)
    app.post("/ldap/" + method, async (c) => {
      const raw = await c.req.json().catch(() => null);
      const parsed = ldapSchema.safeParse(raw?.settings);
      if (!parsed.success)
        return c.json({ error: "Invalid LDAP settings" }, 400);
      try {
        const settings = mergeLdap(db, parsed.data);
        if ((settings.enabled || method === "test") && !completeLdap(settings))
          return c.json(
            { error: "Complete the server, search account and allowed groups" },
            400,
          );
        if (method === "test") {
          const username = z
            .string()
            .trim()
            .max(128)
            .regex(/^[a-zA-Z0-9_.@-]*$/)
            .parse(raw.username || "");
          const result = await queryDirectory(
            settings,
            username ? { username } : undefined,
          );
          return c.json({ ok: true, role: result?.role ?? null });
        }
        saveLdap(db, settings);
        recordAudit(db, {
          actorType: c.get("actor")!.kind,
          actorId: c.get("actor")!.label,
          action: "settings.ldap.save",
          resourceType: "settings",
          resourceId: "ldap",
          metadata: { enabled: settings.enabled },
        });
        return c.json({ settings: publicLdap(db) });
      } catch {
        return c.json(
          {
            error:
              "Directory connection or lookup failed. Check TLS, credentials and groups.",
          },
          400,
        );
      }
    });
  const read = () =>
    Number(
      db
        .select()
        .from(appSettings)
        .where(eq(appSettings.key, "desired_web_port"))
        .get()?.value ?? 5173,
    );
  const response = (port: number) => ({
    desiredPort: port,
    command: `sudo bash scripts/set-web-port.sh ${port}`,
    requiresServerCommand: true,
  });
  app.get("/", (c) => c.json(response(read())));
  app.put("/port", async (c) => {
    const parsed = z
      .object({ port: z.number().int().min(1024).max(65535) })
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json({ error: "Port must be between 1024 and 65535" }, 400);
    const port = parsed.data.port;
    db.insert(appSettings)
      .values({ key: "desired_web_port", value: String(port) })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value: String(port) },
      })
      .run();
    recordAudit(db, {
      actorType: c.get("actor")!.kind,
      actorId: c.get("actor")!.label,
      action: "settings.port.request",
      resourceType: "settings",
      resourceId: "web_port",
      metadata: { port },
    });
    return c.json(response(port));
  });
  return app;
}
