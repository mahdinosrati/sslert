import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import type { DB } from "../db/index.js";
import { alertChannels, appSettings, domains } from "../db/schema.js";
import type { AuthEnv } from "../middleware/auth.js";
import { getChannelSender, type AlertContent } from "../services/channels.js";
import { recordAudit } from "../services/audit.js";

export function createTestAlertsRouter(db: DB) {
  const app = new Hono<AuthEnv>();
  app.post("/domains/:domainId/channels/:id/test", async (c) => {
    const domainId = Number(c.req.param("domainId"));
    const id = Number(c.req.param("id"));
    if (
      !Number.isSafeInteger(domainId) ||
      !Number.isSafeInteger(id) ||
      domainId < 1 ||
      id < 0
    )
      return c.json({ error: "Invalid id" }, 400);
    const domain = db
      .select()
      .from(domains)
      .where(eq(domains.id, domainId))
      .get();
    if (!domain) return c.json({ error: "Not found" }, 404);
    const row =
      id === 0
        ? null
        : db
            .select()
            .from(alertChannels)
            .where(
              and(
                eq(alertChannels.id, id),
                eq(alertChannels.domainId, domainId),
              ),
            )
            .get();
    const hasExplicitEmail = db
      .select()
      .from(alertChannels)
      .where(
        and(
          eq(alertChannels.domainId, domainId),
          eq(alertChannels.channel, "email"),
        ),
      )
      .get();
    if (!row && !(id === 0 && !hasExplicitEmail && process.env.ALERT_EMAIL_TO))
      return c.json({ error: "Not found" }, 404);
    const channel = row?.channel ?? "email";
    if (channel !== "email" && channel !== "telegram")
      return c.json(
        { error: "Test sending supports email and Telegram only" },
        400,
      );
    const key = `test_alert:${domainId}:${channel}`;
    const reserved = db.transaction((tx) => {
      const previous = tx
        .select()
        .from(appSettings)
        .where(eq(appSettings.key, key))
        .get();
      if (previous && Date.now() - Number(previous.value) < 30_000)
        return false;
      tx.insert(appSettings)
        .values({ key, value: String(Date.now()) })
        .onConflictDoUpdate({
          target: appSettings.key,
          set: { value: String(Date.now()) },
        })
        .run();
      return true;
    });
    if (!reserved)
      return c.json(
        { error: "Wait 30 seconds before sending another test" },
        429,
      );
    const config = row
      ? (JSON.parse(row.config) as Record<string, unknown>)
      : {};
    const fa = config.language === "fa";
    const content: AlertContent = {
      subject: fa
        ? `[Bamdad Alert] پیام آزمایشی — ${domain.hostname}`
        : `[Bamdad Alert] TEST message — ${domain.hostname}`,
      text: fa
        ? `این یک پیام آزمایشی از Bamdad Alert است.\nدامنه: \u2066${domain.hostname}:${domain.port}\u2069\nارسال از داخل پنل درخواست شده است و به معنی انقضای دامنه یا گواهی نیست.`
        : `This is a test message from Bamdad Alert.\nDomain: ${domain.hostname}:${domain.port}\nRequested from the panel; this does not indicate certificate or domain expiry.`,
      source: "cert",
      level: "test",
      hostname: `${domain.hostname}:${domain.port}`,
      daysRemaining: null,
    };
    let result;
    try {
      result = await getChannelSender(channel).send(
        content,
        config,
        process.env,
      );
    } catch {
      result = { error: "Delivery failed" };
    }
    const status = result.error
      ? "failed"
      : channel === "email" && !process.env.RESEND_API_KEY
        ? "logged"
        : "sent";
    recordAudit(db, {
      actorType: c.get("actor")!.kind,
      actorId: c.get("actor")!.label,
      action: "channel.test",
      resourceType: "channel",
      resourceId: String(id),
      metadata: { domainId, channel, status },
    });
    // Never reflect provider bodies/URLs containing credentials to operators.
    if (result.error)
      return c.json(
        {
          error:
            "Test delivery failed. Check channel credentials and provider settings.",
          status,
        },
        502,
      );
    return c.json({
      status,
      message:
        status === "logged"
          ? "Email was logged only. Configure RESEND_API_KEY for real delivery."
          : "Test message accepted by the provider",
    });
  });
  return app;
}
