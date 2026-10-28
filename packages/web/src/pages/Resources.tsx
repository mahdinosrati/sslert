import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { request } from "../lib/api";
import { useI18n, errorMessage, formatNumber } from "../lib/i18n";
import { useAuth, permits } from "../lib/auth";
import { NotificationPolicy } from "./Notifications";
import { formatDate } from "../lib/format";
export interface Resource {
  id: number;
  kind: "license" | "api";
  title: string;
  provider: string;
  owner: string;
  notes: string;
  expiresAt: string | null;
  enabled: boolean;
}
export function Resources() {
  const { t } = useI18n(),
    user = useAuth().data?.user,
    cache = useQueryClient();
  const query = useQuery({
    queryKey: ["resources"],
    queryFn: () => request<{ resources: Resource[] }>("/api/resources"),
  });
  const [editing, setEditing] = useState<Resource | null>(null),
    [selected, setSelected] = useState<number | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const blank: Resource = {
    id: 0,
    kind: "license",
    title: "",
    provider: "",
    owner: "",
    notes: "",
    expiresAt: "",
    enabled: true,
  };
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t("Licenses & API expiry")}</h1>
        {permits(user, "canCreate") && (
          <button className="primary" onClick={() => setEditing(blank)}>
            {t("Add item")}
          </button>
        )}
      </div>
      <p className="text-slate-500">
        {t(
          "Dates are entered manually. API tokens are not stored or validated.",
        )}
      </p>
      {error && (
        <p role="alert" className="text-rose-600">
          {error}
        </p>
      )}
      {query.isError && <p role="alert">{errorMessage(query.error)}</p>}
      {editing && (
        <section className="panel">
          <form
            className="form-grid"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                const {
                  id,
                  kind,
                  title,
                  provider,
                  owner,
                  notes,
                  expiresAt,
                  enabled,
                } = editing;
                const data = {
                  kind,
                  title,
                  provider,
                  owner,
                  notes,
                  expiresAt,
                  enabled,
                };
                await request(`/api/resources${id ? `/${id}` : ""}`, {
                  method: id ? "PUT" : "POST",
                  body: JSON.stringify(data),
                });
                setEditing(null);
                await cache.invalidateQueries({ queryKey: ["resources"] });
              } catch (err) {
                setError(errorMessage(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              {t("Type")}
              <select
                value={editing.kind}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    kind: e.target.value as Resource["kind"],
                    expiresAt: editing.expiresAt ?? "",
                  })
                }
              >
                <option value="license">{t("Software license")}</option>
                <option value="api">{t("API expiry")}</option>
              </select>
            </label>
            {(["title", "provider", "owner"] as const).map((f) => (
              <label key={f}>
                {t(
                  {
                    title: "Title",
                    provider: "Provider",
                    owner: "Responsible person",
                  }[f],
                )}
                <input
                  required={f === "title"}
                  maxLength={200}
                  value={editing[f]}
                  onChange={(e) =>
                    setEditing({ ...editing, [f]: e.target.value })
                  }
                />
              </label>
            ))}
            <label>
              {t("Expiry date (Gregorian, UTC)")}
              <input
                type="date"
                required={editing.expiresAt !== null}
                disabled={editing.expiresAt === null}
                value={editing.expiresAt ?? ""}
                onChange={(e) =>
                  setEditing({ ...editing, expiresAt: e.target.value })
                }
              />
            </label>
            {editing.kind === "license" && (
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={editing.expiresAt === null}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      expiresAt: e.target.checked ? null : "",
                    })
                  }
                />
                {t("Perpetual license")}
              </label>
            )}
            <label>
              {t("Notes")}
              <textarea
                maxLength={4000}
                value={editing.notes}
                onChange={(e) =>
                  setEditing({ ...editing, notes: e.target.value })
                }
              />
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                checked={editing.enabled}
                onChange={(e) =>
                  setEditing({ ...editing, enabled: e.target.checked })
                }
              />
              {t("Monitoring enabled")}
            </label>
            <div className="flex gap-2">
              <button disabled={busy} className="primary">
                {t("Save")}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => setEditing(null)}
              >
                {t("Cancel")}
              </button>
            </div>
          </form>
        </section>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {query.data?.resources.map((r) => {
          const days = r.expiresAt
            ? Math.ceil(
                (Date.parse(r.expiresAt + "T23:59:59.999Z") - Date.now()) /
                  86400000,
              )
            : null;
          return (
            <section key={r.id} className="panel space-y-3">
              <div className="flex justify-between gap-3">
                <h2 className="break-words text-xl font-semibold">{r.title}</h2>
                <span className="text-sm text-slate-500">
                  {t(r.kind === "api" ? "API expiry" : "Software license")}
                </span>
              </div>
              <p className="text-sm text-slate-500">
                {r.provider}
                {r.owner && ` · ${r.owner}`}
              </p>
              <p>
                {r.expiresAt
                  ? formatDate(r.expiresAt + "T00:00:00Z")
                  : t("Perpetual license")}
              </p>
              <p
                className={
                  days !== null && days <= 7 ? "text-rose-600" : "text-sky-700"
                }
              >
                {!r.enabled
                  ? t("Disabled")
                  : days === null
                    ? t("No expiry")
                    : days <= 0
                      ? t("Expired")
                      : t("{days} days remaining", {
                          days: formatNumber(days),
                        })}
              </p>
              <p className="whitespace-pre-wrap break-words text-sm">
                {r.notes}
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  className="secondary"
                  onClick={() => setSelected(selected === r.id ? null : r.id)}
                >
                  {t("Notifications")}
                </button>
                {permits(user, "canEdit") && (
                  <button
                    className="secondary"
                    onClick={() => setEditing({ ...r })}
                  >
                    {t("Edit")}
                  </button>
                )}
                {user?.role === "admin" && (
                  <button
                    className="secondary"
                    onClick={async () => {
                      if (!confirm(t("Delete item?"))) return;
                      try {
                        await request(`/api/resources/${r.id}`, {
                          method: "DELETE",
                        });
                        setSelected(null);
                        await cache.invalidateQueries({
                          queryKey: ["resources"],
                        });
                      } catch (err) {
                        setError(errorMessage(err));
                      }
                    }}
                  >
                    {t("Delete")}
                  </button>
                )}
              </div>
              {selected === r.id && (
                <NotificationPolicy targetKey={`resource:${r.id}`} />
              )}
            </section>
          );
        })}
      </div>
      {query.data?.resources.length === 0 && (
        <p className="panel">{t("No items yet")}</p>
      )}
    </div>
  );
}
