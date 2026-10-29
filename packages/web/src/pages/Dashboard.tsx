import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  RefreshCw,
  Bell,
  Clock,
  ShieldCheck,
  AlertTriangle,
} from "lucide-react";
import { api, request } from "../lib/api";
import { useI18n, errorMessage, formatNumber } from "../lib/i18n";
import { formatDate } from "../lib/format";
import { useAuth, permits } from "../lib/auth";
import {
  buildOverview,
  needsAction,
  inRange,
  hostCount,
  ranges,
  states,
  types,
  type OverviewRow,
} from "../lib/overview";
import type { Resource } from "./Resources";
function Badge({ value }: { value: string }) {
  const { t } = useI18n();
  const tone =
    value === "Expired" || value === "Invalid"
      ? "text-rose-600 bg-rose-500/10"
      : value === "Expiring soon"
        ? "text-amber-600 bg-amber-500/10"
        : value === "Healthy"
          ? "text-emerald-600 bg-emerald-500/10"
          : "text-slate-500 bg-slate-500/10";
  return (
    <span
      className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${tone}`}
    >
      {t(value)}
    </span>
  );
}
export function Dashboard() {
  const { t } = useI18n(),
    user = useAuth().data?.user;
  const domains = useQuery({ queryKey: ["domains"], queryFn: api.listDomains });
  const resources = useQuery({
    queryKey: ["resources"],
    queryFn: () => request<{ resources: Resource[] }>("/api/resources"),
  });
  const coverage = useQuery({
    queryKey: ["coverage"],
    queryFn: () =>
      request<{ coverage: Record<string, boolean> }>(
        "/api/notifications/coverage",
      ),
  });
  const history = useQuery({
    queryKey: ["deliveries", "overview"],
    queryFn: () => request<{ deliveries: any[] }>("/api/notifications/history"),
  });
  const [search, setSearch] = useState(""),
    [type, setType] = useState(""),
    [state, setState] = useState(""),
    [range, setRange] = useState(-1),
    [actionOnly, setActionOnly] = useState(false),
    [sort, setSort] = useState("days"),
    [descending, setDescending] = useState(false),
    [page, setPage] = useState(0);
  const rows = buildOverview(
    domains.data?.domains ?? [],
    resources.data?.resources ?? [],
    coverage.data?.coverage,
  );
  const urgent = rows
    .filter(needsAction)
    .sort((a, b) => (a.days ?? Infinity) - (b.days ?? Infinity));
  const filtered = rows
    .filter(
      (r) =>
        (!type || r.type === type) &&
        (!state || r.status === state) &&
        (range < 0 || inRange(r, range)) &&
        (!actionOnly || needsAction(r)) &&
        (r.title + " " + r.hostname)
          .toLowerCase()
          .includes(search.toLowerCase()),
    )
    .sort((a, b) => {
      const av =
          sort === "title"
            ? a.title
            : sort === "type"
              ? a.type
              : sort === "status"
                ? a.status
                : a.days,
        bv =
          sort === "title"
            ? b.title
            : sort === "type"
              ? b.type
              : sort === "status"
                ? b.status
                : b.days;
      if (av === null) return bv === null ? 0 : 1;
      if (bv === null) return -1;
      return (
        (typeof av === "string"
          ? av.localeCompare(String(bv))
          : av - Number(bv)) * (descending ? -1 : 1)
      );
    });
  const totalPages = Math.max(1, Math.ceil(filtered.length / 15)),
    currentPage = Math.min(page, totalPages - 1);
  const count = (fn: (r: OverviewRow) => boolean) =>
    formatNumber(rows.filter(fn).length);
  function reset() {
    setPage(0);
    setRange(-1);
    setState("");
    setType("");
    setSearch("");
    setActionOnly(false);
  }
  function sortBy(key: string) {
    setDescending(sort === key ? !descending : false);
    setSort(key);
    setPage(0);
  }
  const loading = domains.isLoading || resources.isLoading,
    error = domains.error || resources.error;
  const alertText = (r: OverviewRow) =>
    !r.enabled || r.status === "No expiry"
      ? "Not applicable"
      : r.alert === undefined
        ? "Unknown"
        : r.alert
          ? "Alert configured"
          : "No active alert";
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-sky-600">
            {t("Expiry control center")}
          </p>
          <h1 className="text-3xl font-semibold">{t("Dashboard")}</h1>
          <p className="mt-2 text-sm text-slate-500">
            {t("See what needs attention before an expiry becomes an outage.")}
          </p>
        </div>
        <button
          className="secondary gap-2"
          disabled={
            domains.isFetching ||
            resources.isFetching ||
            coverage.isFetching ||
            history.isFetching
          }
          onClick={() => {
            void domains.refetch();
            void resources.refetch();
            void coverage.refetch();
            void history.refetch();
          }}
        >
          <RefreshCw size={16} />
          {t("Refresh")}
        </button>
      </div>
      {error ? (
        <p role="alert">{errorMessage(error)}</p>
      ) : loading ? (
        <p>{t("Loading…")}</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              {
                label: "All records",
                value: formatNumber(rows.length),
                hint: t("Unique hosts") + ": " + formatNumber(hostCount(rows)),
                icon: ShieldCheck,
                click: reset,
              },
              {
                label: "Expired",
                value: count((r) => r.status === "Expired"),
                hint: t("Requires renewal"),
                icon: AlertTriangle,
                click: () => {
                  reset();
                  setState("Expired");
                },
              },
              {
                label: "Due in 1–7 days",
                value: count((r) => inRange(r, 0)),
                hint: t("Immediate planning"),
                icon: Clock,
                click: () => {
                  reset();
                  setRange(0);
                },
              },
              {
                label: "Due in 8–30 days",
                value: count((r) => inRange(r, 1)),
                hint: t("Upcoming renewals"),
                icon: Bell,
                click: () => {
                  reset();
                  setRange(1);
                },
              },
            ].map((card) => (
              <button
                key={card.label}
                className="panel text-start"
                onClick={card.click}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-slate-500">
                    {t(card.label)}
                  </span>
                  <card.icon size={20} className="text-sky-600" />
                </div>
                <strong className="my-3 block text-4xl">{card.value}</strong>
                <span className="text-xs text-slate-500">{card.hint}</span>
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {["Healthy", "Unknown", "Invalid", "Disabled", "No expiry"].map(
              (s) => (
                <button
                  className="secondary gap-2 text-xs"
                  key={s}
                  onClick={() => {
                    reset();
                    setState(s);
                  }}
                >
                  {t(s)}
                  <b>{count((r) => r.status === s)}</b>
                </button>
              ),
            )}
          </div>
          <p className="text-xs text-slate-500">
            {t(
              "Time ranges do not overlap. One automatic host has separate SSL and domain registration records.",
            )}
          </p>
          <div className="grid gap-4 xl:grid-cols-2">
            <section className="panel space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">
                  {t("Needs attention")}
                </h2>
                <button
                  className="secondary"
                  onClick={() => {
                    reset();
                    setActionOnly(true);
                  }}
                >
                  {t("View all")} · {formatNumber(urgent.length)}
                </button>
              </div>
              {coverage.isError && (
                <p role="alert">{t("Alert coverage could not be loaded.")}</p>
              )}
              {urgent.slice(0, 5).map((r) => (
                <div
                  className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 py-3"
                  key={r.key}
                >
                  <div className="min-w-0">
                    <Link className="break-all font-semibold" to={r.href}>
                      {r.title}
                    </Link>
                    <p className="text-xs text-slate-500">
                      {t(r.type)} · {t(alertText(r))}
                    </p>
                  </div>
                  <Badge value={r.status} />
                </div>
              ))}
              {!urgent.length && (
                <p className="text-sm text-slate-500">
                  {t("No items currently need attention.")}
                </p>
              )}
            </section>
            <section className="panel space-y-4">
              <h2 className="text-lg font-semibold">{t("Next 90 days")}</h2>
              <p className="text-xs text-slate-500">
                {t("Select a time range to filter the records below.")}
              </p>
              {ranges.map(([min, max], i) => {
                const n = rows.filter((r) => inRange(r, i)).length,
                  peak = Math.max(
                    1,
                    ...ranges.map(
                      (_, j) => rows.filter((r) => inRange(r, j)).length,
                    ),
                  );
                return (
                  <button
                    key={min}
                    className="block w-full rounded-lg p-2 text-start hover:bg-slate-500/10"
                    aria-pressed={range === i}
                    onClick={() => {
                      reset();
                      setRange(i);
                    }}
                  >
                    <span className="mb-2 flex justify-between text-sm">
                      <span>
                        {t("Days")}{" "}
                        <bdi dir="ltr">
                          {formatNumber(min)}–{formatNumber(max)}
                        </bdi>
                      </span>
                      <b>{formatNumber(n)}</b>
                    </span>
                    <span className="block h-3 rounded-full bg-slate-500/10">
                      <span
                        className="block h-3 rounded-full bg-sky-600"
                        style={{ width: `${(n / peak) * 100}%` }}
                      />
                    </span>
                  </button>
                );
              })}
            </section>
          </div>
          <section className="panel space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">
                {t("All expiry records")}
              </h2>
              <button className="secondary" onClick={reset}>
                {t("Clear filters")}
              </button>
            </div>
            {(range >= 0 || actionOnly) && (
              <p className="text-sm text-sky-600">
                {actionOnly
                  ? t("Needs attention")
                  : t("Days") + " " + ranges[range].join("–")}
              </p>
            )}
            <div className="form-grid sm:grid-cols-3">
              <label>
                {t("Search")}
                <input
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(0);
                  }}
                />
              </label>
              <label>
                {t("Type")}
                <select
                  value={type}
                  onChange={(e) => {
                    setType(e.target.value);
                    setPage(0);
                  }}
                >
                  <option value="">{t("All")}</option>
                  {types.map((x) => (
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
                  onChange={(e) => {
                    setState(e.target.value);
                    setPage(0);
                  }}
                >
                  <option value="">{t("All")}</option>
                  {states.map((x) => (
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
                      ["Item", "title"],
                      ["Type", "type"],
                      ["Expiry date", "days"],
                      ["Status", "status"],
                    ].map(([label, key]) => (
                      <th
                        className="p-3 text-start"
                        key={label}
                        aria-sort={
                          sort === key
                            ? descending
                              ? "descending"
                              : "ascending"
                            : "none"
                        }
                      >
                        <button onClick={() => sortBy(key)}>
                          {t(label)}{" "}
                          {sort === key ? (descending ? "↓" : "↑") : "↕"}
                        </button>
                      </th>
                    ))}
                    <th className="p-3 text-start">{t("Notifications")}</th>
                    <th className="p-3 text-start">{t("Actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered
                    .slice(currentPage * 15, (currentPage + 1) * 15)
                    .map((r) => (
                      <tr key={r.key} className="border-t border-slate-200">
                        <td className="max-w-xs p-3">
                          <Link
                            className="break-words font-semibold"
                            to={r.href}
                          >
                            <bdi>{r.title}</bdi>
                          </Link>
                          {r.manual && r.hostname && (
                            <p className="text-xs text-slate-500">
                              <bdi>{r.hostname}</bdi>
                            </p>
                          )}
                          <p className="mt-1 text-xs text-slate-500">
                            {r.manual
                              ? t("Manual entry")
                              : t("Last check") +
                                ": " +
                                (r.checkedAt
                                  ? formatDate(r.checkedAt)
                                  : t("Not checked"))}
                          </p>
                          {r.checkError && (
                            <p className="text-xs text-rose-600">
                              {t("Check failed")}
                            </p>
                          )}
                        </td>
                        <td className="p-3">
                          <span className="rounded bg-slate-500/10 px-2 py-1 text-xs">
                            {t(r.type)}
                          </span>
                        </td>
                        <td className="p-3">
                          <bdi>{r.expiry ? formatDate(r.expiry) : "—"}</bdi>
                          <p className="text-xs text-slate-500">
                            {r.days === null
                              ? "—"
                              : formatNumber(r.days) +
                                " " +
                                t("Days remaining")}
                          </p>
                        </td>
                        <td className="p-3">
                          <Badge value={r.status} />
                        </td>
                        <td className="p-3 text-xs">{t(alertText(r))}</td>
                        <td className="p-3">
                          <div className="flex flex-wrap gap-2">
                            <Link className="secondary text-xs" to={r.href}>
                              {t("Details")}
                            </Link>
                            <Link
                              className="secondary text-xs"
                              to={
                                r.manual
                                  ? r.href + "&action=alerts"
                                  : r.href + "#notifications"
                              }
                            >
                              {t("Notifications")}
                            </Link>
                            {r.manual && permits(user, "canEdit") && (
                              <Link
                                className="secondary text-xs"
                                to={r.href + "&action=edit"}
                              >
                                {t("Edit")}
                              </Link>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
              {!filtered.length && (
                <p className="py-4">{t("No matching records")}</p>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm text-slate-500">
                {t("Records")}: {formatNumber(filtered.length)} · {t("Page")}{" "}
                {formatNumber(currentPage + 1)} / {formatNumber(totalPages)}
              </span>
              <div className="flex gap-2">
                <button
                  className="secondary"
                  disabled={currentPage === 0}
                  onClick={() => setPage(currentPage - 1)}
                >
                  {t("Previous")}
                </button>
                <button
                  className="secondary"
                  disabled={currentPage + 1 >= totalPages}
                  onClick={() => setPage(currentPage + 1)}
                >
                  {t("Next")}
                </button>
              </div>
            </div>
          </section>
          <section className="panel space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">
                {t("Recent alert activity")}
              </h2>
              <Link className="secondary" to="/notifications">
                {t("Delivery history")}
              </Link>
            </div>
            {history.isError ? (
              <p role="alert">{errorMessage(history.error)}</p>
            ) : history.isLoading ? (
              <p>{t("Loading…")}</p>
            ) : (
              history.data?.deliveries.slice(0, 5).map((r) => (
                <div
                  key={r.id}
                  className="flex flex-wrap justify-between gap-3 border-b border-slate-200 py-2 text-sm"
                >
                  <span>
                    {r.targetName || r.targetKey} ·{" "}
                    {r.connectionName || t(r.channel || "Deleted")}
                    {r.isTest ? " · " + t("Test") : ""}
                  </span>
                  <span
                    className={
                      r.status === "failed" || r.status === "partial"
                        ? "text-rose-600"
                        : "text-slate-500"
                    }
                  >
                    {t(
                      r.status === "sent"
                        ? "Accepted by delivery service"
                        : r.status,
                    )}
                  </span>
                  <bdi className="text-xs text-slate-500">
                    {formatDate(r.createdAt)}
                  </bdi>
                </div>
              ))
            )}
            {history.data?.deliveries.length === 0 && (
              <p>{t("No deliveries yet")}</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
