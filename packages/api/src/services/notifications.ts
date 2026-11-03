import { recipientsSchema } from "./email-recipients.js";
import { openConfig } from "./notification-secrets.js";
import { and, eq, gte, or, ne } from "drizzle-orm";
import type { DB } from "../db/index.js";
import {
  connections,
  users,
  notificationStages,
  notificationPolicies,
  deliveries,
  resources,
  domains,
  alertChannels,
  appSettings,
} from "../db/schema.js";
import {
  getChannelSender,
  type ChannelName,
  type AlertContent,
} from "./channels.js";

export const defaultPolicy = {
  mode: "inherit",
  connectionIds: [] as number[],
  recipients: [] as { userId: number; connectionId: number }[],
  scheduleMode: "milestones",
  thresholds: [30, 20, 10, 7, 6, 5, 4, 3, 2, 1, 0],
  repeatHours: 24,
};
export function readPolicy(db: DB, key: string) {
  const row = db
    .select()
    .from(notificationPolicies)
    .where(eq(notificationPolicies.key, key))
    .get();
  return row
    ? {
        mode: row.mode,
        recipients: JSON.parse(row.recipients) as {
          userId: number;
          connectionId: number;
        }[],
        scheduleMode: row.scheduleMode,
        connectionIds: JSON.parse(row.connectionIds) as number[],
        thresholds: JSON.parse(row.thresholds) as number[],
        repeatHours: row.repeatHours,
      }
    : { ...defaultPolicy, mode: key === "global" ? "custom" : "inherit" };
}
export function resolvedPolicy(db: DB, key: string) {
  const own = readPolicy(db, key);
  return own.mode === "inherit" ? readPolicy(db, "global") : own;
}
// One-time upgrade: preserve each domain's exact old receivers, including disabled email overrides.
export function initializeNotifications(db: DB) {
  if (
    db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, "central_notifications"))
      .get()
  )
    return;
  db.transaction((tx) => {
    const globalIds: number[] = [];
    if (process.env.ALERT_EMAIL_TO)
      globalIds.push(
        tx
          .insert(connections)
          .values({
            name: "Default email",
            channel: "email",
            shared: true,
            config: JSON.stringify({
              to: process.env.ALERT_EMAIL_TO,
              from: process.env.ALERT_EMAIL_FROM,
              language: "en",
            }),
          })
          .returning()
          .get()!.id,
      );
    tx.insert(notificationPolicies)
      .values({
        key: "global",
        mode: "custom",
        connectionIds: JSON.stringify(globalIds),
      })
      .onConflictDoNothing()
      .run();
    for (const domain of tx.select().from(domains).all()) {
      const old = tx
        .select()
        .from(alertChannels)
        .where(eq(alertChannels.domainId, domain.id))
        .all();
      const ids: number[] = [];
      for (const ch of old) {
        const conn = tx
          .insert(connections)
          .values({
            name: `${domain.hostname} · ${ch.channel}`,
            channel: ch.channel,
            config: ch.config,
            enabled: ch.enabled,
            shared: false,
          })
          .returning()
          .get()!;
        if (ch.enabled) ids.push(conn.id);
      }
      if (!old.some((ch) => ch.channel === "email")) ids.push(...globalIds);
      tx.insert(notificationPolicies)
        .values({
          key: `domain:${domain.id}`,
          mode: "custom",
          connectionIds: JSON.stringify(ids),
        })
        .onConflictDoNothing()
        .run();
    }
    tx.insert(appSettings)
      .values({ key: "central_notifications", value: "1" })
      .run();
  });
}
export function centralEnabled(db: DB) {
  return !!db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, "central_notifications"))
    .get();
}
export async function sendConnection(
  db: DB,
  connection: typeof connections.$inferSelect,
  targetKey: string,
  source: string,
  title: string,
  days: number | null,
  level: string,
  isTest = false,
  repeatHours = 24,
  delivery?: {
    recipient: string;
    cycle: string;
    config: Record<string, unknown>;
    milestone: boolean;
  },
): Promise<{ status: string }> {
  if (isTest && connection.channel === "email" && !delivery) {
    const config = JSON.parse(connection.config);
    const parsed = recipientsSchema.safeParse(
      config.to ?? process.env.ALERT_EMAIL_TO ?? "",
    );
    if (parsed.success) {
      const results = [];
      for (const address of Array.isArray(parsed.data)
        ? parsed.data
        : [parsed.data])
        results.push(
          await sendConnection(
            db,
            connection,
            targetKey,
            source,
            title,
            days,
            level,
            true,
            repeatHours,
            {
              recipient: address.toLowerCase(),
              cycle: "",
              config: { ...config, to: address },
              milestone: false,
            },
          ),
        );
      const statuses = results.map((r) => r.status);
      return {
        status: statuses.every((s) => s === "deduped")
          ? "deduped"
          : statuses.every((s) => s === "failed")
            ? "failed"
            : statuses.some((s) => s === "failed" || s === "partial")
              ? "partial"
              : statuses.some((s) => s === "logged")
                ? "logged"
                : "sent",
      };
    }
  }
  const now = new Date().toISOString();
  const stageMatch = delivery?.milestone
    ? and(
        eq(notificationStages.targetKey, targetKey),
        eq(notificationStages.source, source),
        eq(notificationStages.channel, connection.channel),
        eq(notificationStages.recipient, delivery.recipient),
        eq(notificationStages.expiryCycle, delivery.cycle),
      )
    : undefined;
  const claim = db.transaction((tx) => {
    if (stageMatch) {
      // A completed later stage also suppresses an earlier stage after a clock correction.
      const previous = tx
        .select()
        .from(notificationStages)
        .where(stageMatch)
        .all();
      if (
        previous.some(
          (p) =>
            p.stage <= Number(level) &&
            (p.status === "sent" ||
              p.status === "partial" ||
              ((p.status === "pending" ||
                p.status === "failed" ||
                p.status === "logged") &&
                p.stage === Number(level) &&
                Date.parse(p.attemptedAt) > Date.now() - 15 * 60_000)),
        )
      )
        return null;
      const stage = previous.find((p) => p.stage === Number(level));
      if (stage)
        tx.update(notificationStages)
          .set({ status: "pending", attemptedAt: now })
          .where(eq(notificationStages.id, stage.id))
          .run();
      else
        tx.insert(notificationStages)
          .values({
            targetKey,
            source,
            channel: connection.channel,
            recipient: delivery!.recipient,
            expiryCycle: delivery!.cycle,
            stage: Number(level),
            status: "pending",
            attemptedAt: now,
          })
          .run();
    }

    const recent = tx
      .select()
      .from(deliveries)
      .where(
        and(
          eq(deliveries.targetKey, targetKey),
          eq(deliveries.source, source),
          eq(deliveries.connectionId, connection.id),
          eq(deliveries.level, level),
          eq(deliveries.recipient, delivery?.recipient ?? ""),
          eq(deliveries.expiryCycle, delivery?.cycle ?? ""),
          eq(deliveries.isTest, isTest),
          or(
            and(
              ne(deliveries.status, "failed"),
              gte(
                deliveries.createdAt,
                new Date(
                  Date.now() - (isTest ? 30_000 : repeatHours * 3600_000),
                ).toISOString(),
              ),
            ),
            and(
              eq(deliveries.status, "failed"),
              gte(
                deliveries.createdAt,
                new Date(
                  Date.now() - (isTest ? 30_000 : 15 * 60_000),
                ).toISOString(),
              ),
            ),
          ),
        ),
      )
      .get();
    if (recent && !stageMatch) return null;
    return tx
      .insert(deliveries)
      .values({
        recipient: delivery?.recipient ?? "",
        expiryCycle: delivery?.cycle ?? "",
        targetKey,
        source,
        connectionId: connection.id,
        level,
        status: "pending",
        createdAt: now,
        isTest,
      })
      .returning()
      .get()!;
  });
  if (!claim) return { status: "deduped" };
  let status = "failed";
  let failureMessage = "Delivery failed. Check connection settings.";
  try {
    const config = openConfig(
      delivery?.config ?? JSON.parse(connection.config),
    );
    const fa = config.language === "fa";
    const label = fa
      ? ({
          cert: "گواهی SSL",
          domain: "دامنه",
          license: "لایسنس نرم‌افزار",
          api: "اعتبار توکن API",
          contract: "قرارداد",
        }[source] ?? "هشدار")
      : source;
    const subject = isTest
      ? fa
        ? "[هشدار بامداد] پیام آزمایشی"
        : "[Bamdad Alert] TEST notification"
      : `[${fa ? "هشدار بامداد" : "Bamdad Alert"}] ${title} · ${label}`;
    const text = isTest
      ? fa
        ? "این یک پیام آزمایشی است؛ نیازی به اقدام درباره انقضا نیست."
        : "This is a test notification. No expiry action is required."
      : fa
        ? `${label}: ${title}\nروزهای باقی‌مانده: ${new Intl.NumberFormat("fa-IR").format(days ?? 0)}\n${days !== null && days < 0 ? "منقضی شده است." : days === 0 ? "امروز روز انقضاست." : "برای تمدید برنامه‌ریزی کنید."}`
        : `${label}: ${title}\nDays remaining: ${days}\n${days !== null && days < 0 ? "Expired." : days === 0 ? "Expires today." : "Please arrange renewal."}`;
    const content: AlertContent = {
      subject,
      text,
      hostname: title,
      daysRemaining: days,
      source: (["cert", "domain", "license", "api", "contract"].includes(source)
        ? source
        : "cert") as AlertContent["source"],
      level,
    };
    const result = await getChannelSender(
      connection.channel as ChannelName,
    ).send(content, config, process.env);
    const reasons: Record<string, string> = {
      smtp_auth: "SMTP authentication failed.",
      smtp_tls: "SMTP TLS verification failed.",
      smtp_timeout: "SMTP connection timed out.",
      smtp_connection: "SMTP connection failed.",
      smtp_rejected: "SMTP server rejected the message or recipient.",
      smtp_temporary: "SMTP server temporarily rejected delivery.",
      smtp_unknown: "SMTP delivery failed.",
    };
    if (result.failureCode)
      failureMessage = reasons[result.failureCode] || failureMessage;
    status = result.error
      ? "failed"
      : result.partial
        ? "partial"
        : result.id?.startsWith("log-")
          ? "logged"
          : "sent";
  } catch {
    status = "failed";
  }
  // Never expose provider responses: they may contain bot tokens, webhook URLs or recipient details.
  db.update(deliveries)
    .set({
      status,
      error:
        status === "failed"
          ? failureMessage
          : status === "partial"
            ? "Some recipients were rejected by the email server."
            : null,
    })
    .where(eq(deliveries.id, claim.id))
    .run();
  if (stageMatch)
    db.update(notificationStages)
      .set({ status, attemptedAt: now })
      .where(and(stageMatch, eq(notificationStages.stage, Number(level))))
      .run();
  return { status };
}

/** Calendar dates are evaluated in UTC, including day zero; missed stages collapse to the latest. */
export function expiryDays(expiry: string, now = Date.now()) {
  const timestamp = Date.parse(
    expiry.length === 10 ? expiry + "T00:00:00Z" : expiry,
  );
  if (!Number.isFinite(timestamp)) return null;
  return Math.floor(timestamp / 86400_000) - Math.floor(now / 86400_000);
}
export function notificationTargets(db: DB, key: string) {
  const policy = resolvedPolicy(db, key);
  if (policy.mode === "disabled") return [];
  const all = db
    .select()
    .from(connections)
    .where(eq(connections.enabled, true))
    .all();
  const result: {
    connection: typeof connections.$inferSelect;
    recipient: string;
    config: Record<string, unknown>;
  }[] = [];
  const seen = new Set<string>();
  function add(
    connection: typeof connections.$inferSelect,
    config: Record<string, unknown>,
    address?: string,
  ) {
    if (connection.channel === "sms") return; // Draft until the gateway response/template contract is verified.
    let destinations: string[];
    if (connection.channel === "email") {
      const parsed = recipientsSchema.safeParse(
        address ?? config.to ?? process.env.ALERT_EMAIL_TO ?? "",
      );
      if (!parsed.success) return;
      destinations = Array.isArray(parsed.data) ? parsed.data : [parsed.data];
    } else
      destinations = [
        address ??
          (connection.channel === "telegram"
            ? String(config.chatId ?? "")
            : String(config.url ?? config.topic ?? connection.id)),
      ];
    for (const destination of destinations) {
      const recipient =
        connection.channel === "email"
          ? destination.toLowerCase()
          : destination;
      const identity = connection.channel + ":" + recipient;
      if (!recipient || seen.has(identity)) continue;
      seen.add(identity);
      result.push({
        connection,
        recipient,
        config: {
          ...config,
          ...(connection.channel === "email"
            ? { to: destination }
            : connection.channel === "telegram"
              ? { chatId: destination }
              : {}),
        },
      });
    }
  }
  for (const id of policy.connectionIds) {
    const connection = all.find((c) => c.id === id);
    if (!connection) continue;
    try {
      add(connection, JSON.parse(connection.config));
    } catch {
      /* Unavailable credentials cannot produce a valid route. */
    }
  }
  for (const route of policy.recipients) {
    const user = db
      .select()
      .from(users)
      .where(eq(users.id, route.userId))
      .get();
    const connection = all.find((c) => c.id === route.connectionId);
    if (
      !user?.enabled ||
      !connection ||
      !JSON.parse(user.notificationChannels).includes(connection.channel)
    )
      continue;
    const address =
      connection.channel === "email"
        ? user.email
        : connection.channel === "telegram"
          ? user.telegramId
          : user.mobile;
    if (!address) continue;
    try {
      add(connection, JSON.parse(connection.config), address);
    } catch {}
  }
  return result;
}
export async function dispatchExpiry(
  db: DB,
  key: string,
  source: string,
  title: string,
  days: number | null,
  expiry?: string | null,
) {
  const policy = resolvedPolicy(db, key);
  const milestone = policy.scheduleMode === "milestones";
  // No inferred expiry dates: an unsuccessful scan cannot start a new renewal cycle.
  if (milestone && !expiry) return;
  if (milestone) days = expiryDays(expiry!);
  if (days === null || !Number.isFinite(days) || policy.mode === "disabled")
    return;
  const threshold = [...policy.thresholds]
    .sort((a, b) => a - b)
    .find((n) => days! <= n);
  if (threshold === undefined) return;
  const cycle = expiry
    ? new Date(
        expiry.length === 10 ? expiry + "T00:00:00Z" : expiry,
      ).toISOString()
    : "";
  for (const target of notificationTargets(db, key))
    await sendConnection(
      db,
      target.connection,
      key,
      source,
      title,
      days,
      String(threshold),
      false,
      policy.repeatHours,
      { recipient: target.recipient, cycle, config: target.config, milestone },
    );
}
export async function checkResourceExpiry(db: DB) {
  for (const resource of db
    .select()
    .from(resources)
    .where(eq(resources.enabled, true))
    .all()) {
    const days = resource.expiresAt ? expiryDays(resource.expiresAt) : null;
    await dispatchExpiry(
      db,
      "resource:" + resource.id,
      resource.kind,
      resource.hostname
        ? resource.title + " (" + resource.hostname + ")"
        : resource.title,
      days,
      resource.expiresAt,
    );
  }
}
