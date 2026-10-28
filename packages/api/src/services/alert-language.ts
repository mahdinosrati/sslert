import type { AlertContent } from "./channels.js";

/** Translate presentation only. Routing, severity and deduplication keep their stable values. */
export function localizeAlert(
  content: AlertContent,
  language: unknown,
  checkId: number,
  recordedAt = new Date(),
): AlertContent {
  if (language !== "fa") return content;
  const number = (value: number) =>
    new Intl.NumberFormat("fa-IR").format(value);
  const resource = content.source === "domain" ? "ثبت دامنه" : "گواهی SSL";
  const levels: Record<string, string> = {
    warning: "هشدار",
    urgent: "فوری",
    critical: "بحرانی",
    emergency: "منقضی‌شده",
  };
  const days = content.daysRemaining;
  const status =
    days === null
      ? "زمان انقضا نامشخص است"
      : days <= 0
        ? `اعتبار ${resource} به پایان رسیده است`
        : `${resource} تا ${number(days)} روز دیگر منقضی می‌شود`;
  // Isolate technical values so punctuation and ports remain readable in RTL clients.
  const hostname = `\u2066${content.hostname}\u2069`;
  const timestamp = new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "UTC",
  }).format(recordedAt);
  return {
    ...content,
    subject: `[Bamdad Alert] ${hostname}: ${status}`,
    text: [
      `هشدار ${resource} — Bamdad Alert`,
      "",
      `دامنه: ${hostname}`,
      `سطح هشدار: ${levels[content.level] ?? content.level}`,
      `وضعیت: ${status}`,
      days === null
        ? "روزهای باقی‌مانده: نامشخص"
        : days < 0
          ? `روزهای گذشته از انقضا: ${number(Math.abs(days))}`
          : `روزهای باقی‌مانده: ${number(days)}`,
      "",
      content.source === "domain"
        ? "ثبت دامنه را از طریق شرکت ثبت‌کننده تمدید کنید."
        : "گواهی SSL را تمدید و نسخهٔ جدید را روی سرور نصب کنید.",
      "",
      `شناسهٔ بررسی: ${number(checkId)}`,
      `زمان ثبت هشدار: ${timestamp} (UTC)`,
    ].join("\n"),
  };
}
