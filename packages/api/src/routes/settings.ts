import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "../db/index.js";
import { appSettings } from "../db/schema.js";
import type { AuthEnv } from "../middleware/auth.js";
import { recordAudit } from "../services/audit.js";

export function createSettingsRouter(db: DB) {
  const app = new Hono<AuthEnv>();
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
