import type { DomainRow } from "./api";
import type { Resource } from "../pages/Resources";
export const types = [
  "Automatic SSL",
  "Domain registration",
  "Software license",
  "API expiry",
  "Manual domain",
  "Private SSL certificate",
];
export const states = [
  "Healthy",
  "Expiring soon",
  "Expired",
  "Unknown",
  "Invalid",
  "Disabled",
  "No expiry",
];
export const ranges = [
  [1, 7],
  [8, 30],
  [31, 60],
  [61, 90],
] as const;
export interface OverviewRow {
  key: string;
  target: string;
  title: string;
  hostname: string;
  type: string;
  expiry: string | null;
  days: number | null;
  status: string;
  enabled: boolean;
  manual: boolean;
  checkedAt: string | null;
  checkError: boolean;
  alert: boolean | undefined;
  href: string;
}
const remaining = (
  date: string | null | undefined,
  fallback: number | null,
  now: number,
) => (date ? Math.ceil((Date.parse(date) - now) / 86400000) : fallback);
export function buildOverview(
  domains: DomainRow[],
  resources: Resource[],
  coverage: Record<string, boolean> | undefined,
  now = Date.now(),
): OverviewRow[] {
  const rows: OverviewRow[] = [];
  const add = (r: Omit<OverviewRow, "status">, perpetual = false) => {
    let status = !r.enabled
      ? "Disabled"
      : perpetual
        ? "No expiry"
        : r.days !== null && r.days <= 0
          ? "Expired"
          : r.checkError
            ? "Invalid"
            : r.days === null
              ? "Unknown"
              : r.days <= 30
                ? "Expiring soon"
                : "Healthy";
    rows.push({ ...r, status });
  };
  for (const { domain: d, lastCheck: c } of domains)
    for (const cert of [true, false]) {
      const expiry = (cert ? c?.notAfter : c?.domainExpiresAt) ?? null,
        target = `domain:${d.id}`;
      add({
        key: target + ":" + cert,
        target,
        title: d.hostname,
        hostname: d.hostname,
        type: cert ? types[0] : types[1],
        expiry,
        days: remaining(
          expiry,
          (cert ? c?.daysRemaining : c?.domainExpiresDaysRemaining) ?? null,
          now,
        ),
        enabled: d.enabled,
        manual: false,
        checkedAt: c?.checkedAt ?? null,
        checkError: cert ? c?.valid === false : !!c?.domainRegistrarError,
        alert: coverage?.[target],
        href: `/domains/${d.id}`,
      });
    }
  for (const r of resources) {
    const target = `resource:${r.id}`;
    add(
      {
        key: target,
        target,
        title: r.title,
        hostname: r.hostname || "",
        type: {
          license: types[2],
          api: types[3],
          domain: types[4],
          cert: types[5],
        }[r.kind],
        expiry: r.expiresAt,
        days: remaining(
          r.expiresAt ? r.expiresAt + "T23:59:59.999Z" : null,
          null,
          now,
        ),
        enabled: r.enabled,
        manual: true,
        checkedAt: null,
        checkError: false,
        alert: coverage?.[target],
        href: `/resources?item=${r.id}`,
      },
      r.kind === "license" && !r.expiresAt,
    );
  }
  return rows;
}
export function needsAction(r: OverviewRow) {
  return (
    r.enabled &&
    (r.status === "Expired" ||
      r.checkError ||
      r.status === "Unknown" ||
      (r.days !== null && r.days <= 30) ||
      (r.status !== "No expiry" && r.alert === false))
  );
}
export function inRange(r: OverviewRow, index: number) {
  const [min, max] = ranges[index];
  return r.enabled && r.days !== null && r.days >= min && r.days <= max;
}
export function hostCount(rows: OverviewRow[]) {
  return new Set(
    rows
      .map((r) => r.hostname.trim().toLowerCase().replace(/\.$/, ""))
      .filter(Boolean),
  ).size;
}
