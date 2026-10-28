import { useI18n, formatNumber, errorMessage } from "../lib/i18n";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { formatDate } from "../lib/format";

const PAGE_SIZE = 50;

function fmtTime(iso: string): string {
  // SQLite `datetime('now')` produces "YYYY-MM-DD HH:MM:SS" in UTC. The
  // API may also return a full ISO string from the in-memory test
  // harness, so we handle both. We don't reformat the date — the user
  // already knows their timezone.
  return iso.replace("T", " ").replace(/\.\d{3}Z$/, " UTC").replace("Z", " UTC");
}

function actionBadgeClass(action: string): string {
  if (action.startsWith("domain.delete") || action.startsWith("token.revoke"))
    return "bg-rose-50 text-rose-700 ring-rose-200";
  if (action.startsWith("domain.create") || action.startsWith("channel.create"))
    return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  if (action.startsWith("auth.login.failure"))
    return "bg-amber-50 text-amber-700 ring-amber-200";
  return "bg-slate-50 text-slate-700 ring-slate-200";
}

export function AuditLog() {
  const { t } = useI18n();
  const [action, setAction] = React.useState("");
  const [actorType, setActorType] = React.useState("");
  const [resourceType, setResourceType] = React.useState("");
  const [since, setSince] = React.useState("");
  const [until, setUntil] = React.useState("");
  const [offset, setOffset] = React.useState(0);

  // Reset pagination when filters change.
  React.useEffect(() => {
    setOffset(0);
  }, [action, actorType, resourceType, since, until]);

  const query = useQuery({
    queryKey: ["audit-log", action, actorType, resourceType, since, until, offset],
    queryFn: () =>
      api.listAuditLog({
        action: action || undefined,
        actorType:
          actorType === ""
            ? undefined
            : (actorType as "user" | "api_token" | "system"),
        resourceType: resourceType || undefined,
        // The backend accepts ISO-8601 datetimes for `since` / `until`.
        // The HTML date input gives us a YYYY-MM-DD string, which is a
        // valid ISO-8601 *date* (interpreted as UTC midnight by the
        // server). That's good enough for a v0.3 filter UI; a
        // date+time picker is a v0.4 enhancement.
        since: since ? `${since}T00:00:00Z` : undefined,
        until: until ? `${until}T23:59:59Z` : undefined,
        limit: PAGE_SIZE,
        offset,
      }),
    refetchInterval: 15_000,
  });

  const rows = query.data?.rows ?? [];
  const total = query.data?.total ?? 0;
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{t("Audit log")}</h1>
          <p className="text-sm text-slate-500">{t("Who did what, and when. Newest first.")}</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => query.refetch()}
          disabled={query.isFetching}
        >
          <RefreshCw className="me-1 h-4 w-4" />{t("Refresh")}</Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("Filters")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3 lg:grid-cols-5">
            <div>
              <label
                htmlFor="audit-filter-action"
                className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500"
              >{t("Action")}</label>
              <Input
                id="audit-filter-action"
                dir="ltr"
                placeholder="domain.% or channel.create"
                value={action}
                onChange={(e) => setAction(e.target.value)}
              />
            </div>
            <div>
              <label
                htmlFor="audit-filter-actor"
                className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500"
              >{t("Actor")}</label>
              <select
                id="audit-filter-actor"
                className="block w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-sm text-slate-900"
                value={actorType}
                onChange={(e) => setActorType(e.target.value)}
              >
                <option value="">{t("All")}</option>
                <option value="user">{t("user")}</option>
                <option value="api_token">{t("api_token")}</option>
                <option value="system">{t("system")}</option>
              </select>
            </div>
            <div>
              <label
                htmlFor="audit-filter-resource"
                className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500"
              >{t("Resource")}</label>
              <Input
                id="audit-filter-resource"
                dir="ltr"
                placeholder="domain | channel | token"
                value={resourceType}
                onChange={(e) => setResourceType(e.target.value)}
              />
            </div>
            <div>
              <label
                htmlFor="audit-filter-since"
                className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500"
              >{t("Since")}</label>
              <Input
                id="audit-filter-since"
                dir="ltr"
                type="date"
                value={since}
                onChange={(e) => setSince(e.target.value)}
              />
            </div>
            <div>
              <label
                htmlFor="audit-filter-until"
                className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500"
              >{t("Until")}</label>
              <Input
                id="audit-filter-until"
                dir="ltr"
                type="date"
                value={until}
                onChange={(e) => setUntil(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {query.isLoading ? (
            <div className="p-6 text-sm text-slate-500">{t("Loading…")}</div>
          ) : query.isError ? (
            <div className="p-6 text-sm text-rose-700">{t("Failed to load:")}{" "}{errorMessage(query.error)}
            </div>
          ) : rows.length === 0 ? (
            <div className="p-6 text-sm text-slate-500">{t("No audit entries match the current filters.")}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-start text-xs font-medium uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-2">{t("When")}</th>
                    <th className="px-4 py-2">{t("Actor")}</th>
                    <th className="px-4 py-2">{t("Action")}</th>
                    <th className="px-4 py-2">{t("Resource")}</th>
                    <th className="px-4 py-2">{t("Metadata")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.id}
                      className="border-b border-slate-100 last:border-0 hover:bg-slate-50"
                    >
                      <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-slate-600">
                        {formatDate(r.timestamp)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-slate-700">
                        {t(r.actorType)}
                        {r.actorId ? (
                          <span className="ms-1 text-slate-400">
                            ({r.actorId})
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-2">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${actionBadgeClass(
                            r.action
                          )}`}
                        >
                          <bdi dir="ltr">{r.action}</bdi>
                        </span>
                      </td>
                      <td className="px-4 py-2 text-slate-700">
                        <bdi dir="ltr">{r.resourceType}</bdi>
                        {r.resourceId ? (
                          <span className="ms-1 text-slate-400">
                            ({r.resourceId})
                          </span>
                        ) : null}
                      </td>
                      <td className="max-w-xs truncate px-4 py-2 font-mono text-xs text-slate-500">
                        <bdi dir="ltr">{r.metadata ? JSON.stringify(r.metadata) : "—"}</bdi>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between text-sm text-slate-600">
        <span>
          {total === 0
            ? t("No entries")
            : t("Showing {start}–{end} of {total}", {
                start: formatNumber(offset + 1),
                end: formatNumber(Math.min(offset + PAGE_SIZE, total)),
                total: formatNumber(total),
              })}
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
          >
            <ChevronLeft className="me-1 h-4 w-4" />{t("Prev")}</Button>
          <span className="text-xs text-slate-500">
            {t("Page {page} / {total}", { page: formatNumber(page), total: formatNumber(totalPages) })}
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={offset + PAGE_SIZE >= total}
            onClick={() => setOffset(offset + PAGE_SIZE)}
          >{t("Next")}<ChevronRight className="ms-1 h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
