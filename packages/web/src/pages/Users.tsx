import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { request, api } from "../lib/api";
import type { User } from "../lib/auth";
import type { Resource } from "./Resources";
import { useI18n, errorMessage } from "../lib/i18n";
export function Users() {
  const { t } = useI18n(),
    cache = useQueryClient();
  const query = useQuery({
    queryKey: ["users"],
    queryFn: () => request<{ users: User[] }>("/api/users"),
  });
  const domains = useQuery({
    queryKey: ["admin-domains"],
    queryFn: api.listDomains,
  });
  const resources = useQuery({
    queryKey: ["resources"],
    queryFn: () => request<{ resources: Resource[] }>("/api/resources"),
  });
  const [editing, setEditing] = useState<(User & { password: string }) | null>(
      null,
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div className="space-y-6">
      <div className="flex justify-between">
        <h1 className="text-2xl font-semibold">{t("Users & access")}</h1>
        <button
          className="primary"
          onClick={() =>
            setEditing({
              id: 0,
              username: "",
              password: "",
              role: "user",
              enabled: true,
              mustChangePassword: true,
              canCreate: false,
              canEdit: false,
              canTest: false,
              domainIds: [],
              resourceIds: [],
            })
          }
        >
          {t("Add user")}
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {query.isError && <p role="alert">{errorMessage(query.error)}</p>}
      <div className="grid gap-3 md:grid-cols-2">
        {query.data?.users.map((u) => (
          <section
            className="panel flex items-center justify-between gap-3"
            key={u.id}
          >
            <div>
              <bdi>{u.username}</bdi>
              <p className="text-sm text-slate-500">
                {t(u.role === "admin" ? "Administrator" : "User")} ·{" "}
                {t(u.enabled ? "Enabled" : "Disabled")}
              </p>
            </div>
            <button
              className="secondary"
              onClick={() => setEditing({ ...u, password: "" })}
            >
              {t("Edit")}
            </button>
          </section>
        ))}
      </div>
      {editing && (
        <section className="panel">
          <form
            className="form-grid"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                const body = {
                  ...(!editing.id ? { username: editing.username } : {}),
                  ...(editing.password ? { password: editing.password } : {}),
                  role: editing.role,
                  canCreate: editing.canCreate,
                  canEdit: editing.canEdit,
                  canTest: editing.canTest,
                  domainIds: editing.domainIds,
                  resourceIds: editing.resourceIds,
                  ...(editing.id ? { enabled: editing.enabled } : {}),
                };
                await request(
                  `/api/users${editing.id ? `/${editing.id}` : ""}`,
                  {
                    method: editing.id ? "PATCH" : "POST",
                    body: JSON.stringify(body),
                  },
                );
                setEditing(null);
                await cache.invalidateQueries({ queryKey: ["users"] });
                await cache.invalidateQueries({ queryKey: ["auth"] });
              } catch (err) {
                setError(errorMessage(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              {t("Username")}
              <input
                required
                disabled={!!editing.id}
                dir="ltr"
                pattern="[a-zA-Z0-9_.-]{3,64}"
                autoComplete="off"
                value={editing.username}
                onChange={(e) =>
                  setEditing({ ...editing, username: e.target.value })
                }
              />
            </label>
            <label>
              {t(
                editing.id
                  ? "Reset password (leave blank to keep)"
                  : "Password",
              )}
              <input
                required={!editing.id}
                type="password"
                minLength={12}
                autoComplete="new-password"
                value={editing.password}
                onChange={(e) =>
                  setEditing({ ...editing, password: e.target.value })
                }
              />
            </label>
            <label>
              {t("Role")}
              <select
                value={editing.role}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    role: e.target.value as User["role"],
                  })
                }
              >
                <option value="user">{t("User")}</option>
                <option value="admin">{t("Administrator")}</option>
              </select>
            </label>
            {editing.id > 0 && (
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={editing.enabled}
                  onChange={(e) =>
                    setEditing({ ...editing, enabled: e.target.checked })
                  }
                />
                {t("Enabled")}
              </label>
            )}
            {editing.role === "user" && (
              <>
                <p className="text-sm text-slate-500">
                  {t(
                    "Users can view assigned items. Grant additional permissions below.",
                  )}
                </p>
                {(["canCreate", "canEdit", "canTest"] as const).map((f) => (
                  <label className="check-label" key={f}>
                    <input
                      type="checkbox"
                      checked={editing[f]}
                      onChange={(e) =>
                        setEditing({ ...editing, [f]: e.target.checked })
                      }
                    />
                    {t(
                      {
                        canCreate: "Create items",
                        canEdit: "Edit assigned items",
                        canTest: "Send test notifications",
                      }[f],
                    )}
                  </label>
                ))}
                <fieldset>
                  <legend>{t("Assigned domains")}</legend>
                  {domains.data?.domains.map(({ domain: d }) => (
                    <label className="check-label" key={d.id}>
                      <input
                        type="checkbox"
                        checked={editing.domainIds?.includes(d.id) ?? false}
                        onChange={(e) =>
                          setEditing({
                            ...editing,
                            domainIds: e.target.checked
                              ? [...(editing.domainIds ?? []), d.id]
                              : (editing.domainIds ?? []).filter(
                                  (id) => id !== d.id,
                                ),
                          })
                        }
                      />
                      <bdi>{d.hostname}</bdi>
                    </label>
                  ))}
                </fieldset>
                <fieldset>
                  <legend>{t("Assigned licenses & APIs")}</legend>
                  {resources.data?.resources.map((r) => (
                    <label className="check-label" key={r.id}>
                      <input
                        type="checkbox"
                        checked={editing.resourceIds?.includes(r.id) ?? false}
                        onChange={(e) =>
                          setEditing({
                            ...editing,
                            resourceIds: e.target.checked
                              ? [...(editing.resourceIds ?? []), r.id]
                              : (editing.resourceIds ?? []).filter(
                                  (id) => id !== r.id,
                                ),
                          })
                        }
                      />
                      {r.title}
                    </label>
                  ))}
                </fieldset>
              </>
            )}
            <div className="flex gap-2">
              <button className="primary" disabled={busy}>
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
    </div>
  );
}
export function Settings() {
  const { t } = useI18n();
  const query = useQuery({
    queryKey: ["settings"],
    queryFn: () =>
      request<{ desiredPort: number; command: string }>("/api/settings"),
  });
  const [port, setPort] = useState(""),
    [message, setMessage] = useState("");
  return (
    <section className="panel max-w-xl space-y-4">
      <h1 className="text-2xl font-semibold">{t("Server settings")}</h1>
      <p>
        {t(
          "Save a port, then run the command on your server. Saving does not change the running port.",
        )}
      </p>
      <form
        className="form-grid"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await request("/api/settings/port", {
              method: "PUT",
              body: JSON.stringify({
                port: Number(port || query.data?.desiredPort),
              }),
            });
            await query.refetch();
            setMessage(t("Saved"));
          } catch (err) {
            setMessage(errorMessage(err));
          }
        }}
      >
        <label>
          {t("Panel port")}
          <input
            type="number"
            required
            min={1024}
            max={65535}
            value={port || query.data?.desiredPort || 5173}
            onChange={(e) => setPort(e.target.value)}
          />
        </label>
        <button className="primary">{t("Save")}</button>
      </form>
      {query.data && (
        <pre className="overflow-x-auto rounded bg-slate-100 p-3" dir="ltr">
          {query.data.command}
        </pre>
      )}
      <p role="status">{message}</p>
    </section>
  );
}
