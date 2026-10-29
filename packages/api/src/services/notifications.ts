import { openConfig } from "./notification-secrets.js";
import { and, eq, gte, inArray } from "drizzle-orm";
import type { DB } from "../db/index.js";
import {
  connections,
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
  thresholds: [30, 7, 1, 0],
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
) {
  const now = new Date().toISOString();
  const claim = db.transaction((tx) => {
    const recent = tx
      .select()
      .from(deliveries)
      .where(
        and(
          eq(deliveries.targetKey, targetKey),
          eq(deliveries.source, source),
          eq(deliveries.connectionId, connection.id),
          eq(deliveries.level, level),
          eq(deliveries.isTest, isTest),
          gte(
            deliveries.createdAt,
            new Date(
              Date.now() - (isTest ? 30_000 : repeatHours * 3600_000),
            ).toISOString(),
          ),
        ),
      )
      .get();
    if (recent) return null;
    return tx
      .insert(deliveries)
      .values({
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
  try {
    const config = openConfig(JSON.parse(connection.config));
    const fa = config.language === "fa";
    const label = fa
      ? ({
          cert: "گواهی SSL",
          domain: "دامنه",
          license: "لایسنس نرم‌افزار",
          api: "اعتبار توکن API",
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
        ? `${label}: ${title}\nروزهای باقی‌مانده: ${new Intl.NumberFormat("fa-IR").format(days ?? 0)}\n${days !== null && days <= 0 ? "منقضی شده است." : "برای تمدید برنامه‌ریزی کنید."}`
        : `${label}: ${title}\nDays remaining: ${days}\n${days !== null && days <= 0 ? "Expired." : "Please arrange renewal."}`;
    const content: AlertContent = {
      subject,
      text,
      hostname: title,
      daysRemaining: days,
      source: (["cert", "domain", "license", "api"].includes(source)
        ? source
        : "cert") as AlertContent["source"],
      level,
    };
    const result = await getChannelSender(
      connection.channel as ChannelName,
    ).send(content, config, process.env);
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
          ? "Delivery failed. Check connection settings."
          : status === "partial"
            ? "Some recipients were rejected by the email server."
            : null,
    })
    .where(eq(deliveries.id, claim.id))
    .run();
  return { status };
}
export async function dispatchExpiry(
  db: DB,
  key: string,
  source: string,
  title: string,
  days: number | null,
) {
  if (days === null || !Number.isFinite(days)) return;
  const policy = resolvedPolicy(db, key);
  if (policy.mode === "disabled") return;
  const threshold = [...policy.thresholds]
    .sort((a, b) => a - b)
    .find((n) => days <= n);
  if (threshold === undefined || !policy.connectionIds.length) return;
  const targets = db
    .select()
    .from(connections)
    .where(
      and(
        inArray(connections.id, policy.connectionIds),
        eq(connections.enabled, true),
      ),
    )
    .all();
  for (const target of targets)
    await sendConnection(
      db,
      target,
      key,
      source,
      title,
      days,
      String(threshold),
      false,
      policy.repeatHours,
    );
}
export async function checkResourceExpiry(db: DB) {
  for (const resource of db
    .select()
    .from(resources)
    .where(eq(resources.enabled, true))
    .all()) {
    // A date is valid through the end of that UTC day.
    const days = resource.expiresAt
      ? Math.ceil(
          (Date.parse(resource.expiresAt + "T23:59:59.999Z") - Date.now()) /
            86400_000,
        )
      : null;
    await dispatchExpiry(
      db,
      `resource:${resource.id}`,
      resource.kind,
      resource.hostname
        ? `${resource.title} (${resource.hostname})`
        : resource.title,
      days,
    );
  }
}
