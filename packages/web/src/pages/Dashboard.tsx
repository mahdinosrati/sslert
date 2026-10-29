import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, request } from "../lib/api";
import { useI18n, errorMessage, formatNumber } from "../lib/i18n";
import { formatDate } from "../lib/format";
import type { Resource } from "./Resources";
type Row = {
  key: string;
  title: string;
  type: string;
  expiry: string | null;
  days: number | null;
  status: string;
  href: string;
};
function status(
  enabled: boolean,
  days: number | null,
  perpetual = false,
  invalid = false,
) {
  if (!enabled) return "Disabled";
  if (perpetual) return "No expiry";
  if (days === null) return "Unknown";
  if (days <= 0) return "Expired";
  if (invalid) return "Invalid";
  return days <= 30 ? "Expiring soon" : "Healthy";
}
export function Dashboard() {
  const { t } = useI18n();
  const domains = useQuery({ queryKey: ["domains"], queryFn: api.listDomains });
  const resources = useQuery({
    queryKey: ["resources"],
    queryFn: () => request<{ resources: Resource[] }>("/api/resources"),
  });
  const [search, setSearch] = useState(""),
    [type, setType] = useState(""),
    [state, setState] = useState("");
  const rows: Row[] = [];
  for (const { domain: d, lastCheck: c } of domains.data?.domains || []) {
    for (const cert of [true, false]) {
      const days =
        (cert ? c?.daysRemaining : c?.domainExpiresDaysRemaining) ?? null;
      rows.push({
        key: `domain:${d.id}:${cert}`,
        title: d.hostname,
        type: cert ? "Automatic SSL" : "Domain registration",
        expiry: (cert ? c?.notAfter : c?.domainExpiresAt) ?? null,
        days,
        status: status(d.enabled, days, false, cert && c?.valid === false),
        href: `/domains/${d.id}`,
      });
    }
  }
  for (const r of resources.data?.resources || []) {
    const days = r.expiresAt
      ? Math.ceil(
          (Date.parse(r.expiresAt + "T23:59:59.999Z") - Date.now()) / 86400000,
        )
      : null;
    rows.push({
      key: `resource:${r.id}`,
      title: r.title + (r.hostname ? ` (${r.hostname})` : ""),
      type: {
        license: "Software license",
        api: "API expiry",
        domain: "Manual domain",
        cert: "Private SSL certificate",
      }[r.kind],
      expiry: r.expiresAt,
      days,
      status: status(r.enabled, days, r.kind === "license" && !r.expiresAt),
      href: "/resources",
    });
  }
  const statuses = [
    "Healthy",
    "Expiring soon",
    "Expired",
    "Unknown",
    "Invalid",
    "Disabled",
    "No expiry",
  ];
  const visible = rows
    .filter(
      (r) =>
        (!type || r.type === type) &&
        (!state || r.status === state) &&
        r.title.toLowerCase().includes(search.toLowerCase()),
    )
    .sort((a, b) => (a.days ?? Infinity) - (b.days ?? Infinity));
  const loading = domains.isLoading || resources.isLoading;
  const error = domains.error || resources.error;
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t("Dashboard")}</h1>
      <p className="text-sm text-slate-500">
        {t(
          "All expiry records in one view. Automatic domains have separate SSL and registration entries.",
        )}
      </p>
      {error ? (
        <p role="alert">{errorMessage(error)}</p>
      ) : loading ? (
        <p>{t("Loading…")}</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {["All records", ...statuses].map((s) => (
              <button
                key={s}
                className="panel text-start"
                onClick={() => setState(s === "All records" ? "" : s)}
              >
                <span>{t(s)}</span>
                <strong
                  className={`block text-3xl ${s === "Expired" || s === "Invalid" ? "text-rose-500" : s === "Expiring soon" ? "text-amber-500" : ""}`}
                >
                  {formatNumber(
                    s === "All records"
                      ? rows.length
                      : rows.filter((r) => r.status === s).length,
                  )}
                </strong>
              </button>
            ))}
          </div>
          <section className="panel space-y-4">
            <div className="form-grid sm:grid-cols-3">
              <label>
                {t("Search")}
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              <label>
                {t("Type")}
                <select value={type} onChange={(e) => setType(e.target.value)}>
                  <option value="">{t("All")}</option>
                  {[
                    "Automatic SSL",
                    "Domain registration",
                    "Software license",
                    "API expiry",
                    "Manual domain",
                    "Private SSL certificate",
                  ].map((x) => (
                    <option key={x} value={x}>
                      {t(x)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t("Status")}
                <select
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                >
                  <option value="">{t("All")}</option>
                  {statuses.map((x) => (
                    <option key={x} value={x}>
                      {t(x)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    {[
                      "Item",
                      "Type",
                      "Expiry date",
                      "Days remaining",
                      "Status",
                    ].map((x) => (
                      <th key={x} className="p-3 text-start">
                        {t(x)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r) => (
                    <tr
                      key={r.key}
                      className="border-t border-slate-200 dark:border-slate-700"
                    >
                      <td className="p-3">
                        <Link
                          className="text-blue-600 dark:text-blue-400"
                          to={r.href}
                        >
                          <bdi>{r.title}</bdi>
                        </Link>
                      </td>
                      <td className="p-3">{t(r.type)}</td>
                      <td className="p-3">
                        <bdi>{r.expiry ? formatDate(r.expiry) : "—"}</bdi>
                      </td>
                      <td className="p-3">
                        {r.days === null ? "—" : formatNumber(r.days)}
                      </td>
                      <td className="p-3">{t(r.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!visible.length && <p>{t("No matching records")}</p>}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
