import { formatDate } from "../lib/format";
import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { request } from "../lib/api";
import { useI18n, errorMessage } from "../lib/i18n";
import { useAuth, permits } from "../lib/auth";
export interface Connection {
  id: number;
  name: string;
  channel: string;
  enabled: boolean;
  shared: boolean;
  config: Record<string, any>;
}
interface Policy {
  mode: string;
  connectionIds: number[];
  thresholds: number[];
  repeatHours: number;
}
export function NotificationPolicy({ targetKey }: { targetKey: string }) {
  const { t } = useI18n(),
    user = useAuth().data?.user,
    cache = useQueryClient();
  const editable =
    targetKey === "global" ? user?.role === "admin" : permits(user, "canEdit");
  const query = useQuery({
    queryKey: ["policy", targetKey],
    queryFn: () =>
      request<{ policy: Policy }>(`/api/notifications/policies/${targetKey}`),
  });
  const connections = useQuery({
    queryKey: ["connections"],
    queryFn: () =>
      request<{ connections: Connection[] }>("/api/notifications/connections"),
  });
  const [policy, setPolicy] = useState<Policy>({
      mode: "inherit",
      connectionIds: [],
      thresholds: [30, 7, 1, 0],
      repeatHours: 24,
    }),
    [thresholds, setThresholds] = useState("30,7,1,0"),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (query.data) {
      setPolicy(query.data.policy);
      setThresholds(query.data.policy.thresholds.join(","));
    }
  }, [query.data]);
  if (query.isError) return <p role="alert">{errorMessage(query.error)}</p>;
  return (
    <section className="panel space-y-4">
      <h2 className="text-lg font-semibold">
        {t(
          targetKey === "global"
            ? "Global notification defaults"
            : "Notification policy",
        )}
      </h2>
      <p className="text-sm text-slate-500">
        {t(
          "Custom settings replace global defaults. Disabled stops expiry notifications.",
        )}
      </p>
      <form
        className="form-grid"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await request(`/api/notifications/policies/${targetKey}`, {
              method: "PUT",
              body: JSON.stringify({
                ...policy,
                thresholds: thresholds.split(",").map((v) => Number(v.trim())),
              }),
            });
            await cache.invalidateQueries({ queryKey: ["policy", targetKey] });
            setMessage(t("Saved"));
          } catch (err) {
            setMessage(errorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset disabled={!editable || busy} className="space-y-4">
          <label>
            {t("Mode")}
            <select
              value={policy.mode}
              onChange={(e) => setPolicy({ ...policy, mode: e.target.value })}
            >
              {targetKey !== "global" && (
                <option value="inherit">{t("Inherit global defaults")}</option>
              )}
              <option value="custom">{t("Custom")}</option>
              <option value="disabled">{t("Disabled")}</option>
            </select>
          </label>
          {policy.mode === "custom" && (
            <>
              <div className="space-y-2">
                <p>{t("Connections")}</p>
                {connections.data?.connections.map((c) => (
                  <label key={c.id} className="check-label">
                    <input
                      type="checkbox"
                      checked={policy.connectionIds.includes(c.id)}
                      onChange={(e) =>
                        setPolicy({
                          ...policy,
                          connectionIds: e.target.checked
                            ? [...policy.connectionIds, c.id]
                            : policy.connectionIds.filter((id) => id !== c.id),
                        })
                      }
                    />
                    {c.name} {!c.enabled && `(${t("Disabled")})`}
                  </label>
                ))}
              </div>
              <label>
                {t("Reminder days (comma-separated)")}
                <input
                  required
                  dir="ltr"
                  value={thresholds}
                  pattern="[0-9]+(\s*,\s*[0-9]+)*"
                  onChange={(e) => setThresholds(e.target.value)}
                />
              </label>
              <label>
                {t("Repeat every (hours)")}
                <input
                  type="number"
                  required
                  min={1}
                  max={8760}
                  value={policy.repeatHours}
                  onChange={(e) =>
                    setPolicy({
                      ...policy,
                      repeatHours: Number(e.target.value),
                    })
                  }
                />
              </label>
            </>
          )}
          {editable && <button className="primary">{t("Save")}</button>}
        </fieldset>
        {message && <p role="status">{message}</p>}
      </form>
    </section>
  );
}
export function Notifications() {
  const { t } = useI18n(),
    user = useAuth().data?.user,
    cache = useQueryClient();
  const admin = user?.role === "admin";
  const query = useQuery({
    queryKey: ["connections"],
    queryFn: () =>
      request<{ connections: Connection[] }>("/api/notifications/connections"),
  });
  const [historyStatus, setHistoryStatus] = useState("");
  const [historyPage, setHistoryPage] = useState(0);
  const history = useQuery({
    queryKey: ["deliveries", historyStatus, historyPage],
    queryFn: () =>
      request<{ deliveries: any[]; hasMore: boolean }>(
        `/api/notifications/history?status=${historyStatus}&page=${historyPage}`,
      ),
  });
  const blank = {
    id: 0,
    name: "",
    channel: "email",
    enabled: true,
    shared: false,
    config: { language: "en" },
  } as Connection;
  const [editing, setEditing] = useState<Connection | null>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  async function action(fn: () => Promise<unknown>) {
    setBusy(true);
    setMessage("");
    try {
      await fn();
      await cache.invalidateQueries({ queryKey: ["connections"] });
      await cache.invalidateQueries({ queryKey: ["deliveries"] });
    } catch (err) {
      setMessage(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t("Notifications")}</h1>
        {admin && (
          <button className="primary" onClick={() => setEditing(blank)}>
            {t("Add connection")}
          </button>
        )}
      </div>
      {message && <p role="status">{message}</p>}
      {query.isError && <p role="alert">{errorMessage(query.error)}</p>}
      <div className="grid gap-4 md:grid-cols-2">
        {query.data?.connections.map((c) => (
          <section className="panel space-y-3" key={c.id}>
            <h2 className="text-lg font-semibold">{c.name}</h2>
            <p className="text-sm text-slate-500">
              {t(c.channel)} ·{" "}
              {t(c.config.language === "fa" ? "Persian" : "English")} ·{" "}
              {t(c.enabled ? "Enabled" : "Disabled")}
            </p>
            <div className="flex flex-wrap gap-2">
              {permits(user, "canTest") && (
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    action(async () => {
                      const r = await request<{ status: string }>(
                        `/api/notifications/connections/${c.id}/test`,
                        { method: "POST" },
                      );
                      setMessage(
                        t(
                          r.status === "sent"
                            ? "Accepted by delivery service"
                            : r.status === "partial"
                              ? "Some recipients were rejected by the email server."
                              : r.status === "logged"
                                ? "Logged only. Configure RESEND_API_KEY on the server to send email."
                                : "Please wait 30 seconds before testing again.",
                        ),
                      );
                    })
                  }
                >
                  {t(c.channel === "email" ? "Send test email" : "Send test")}
                </button>
              )}
              {admin && (
                <>
                  <button
                    className="secondary"
                    onClick={() =>
                      setEditing({ ...c, config: { ...c.config } })
                    }
                  >
                    {t("Edit")}
                  </button>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => {
                      if (confirm(t("Delete connection?")))
                        void action(() =>
                          request(`/api/notifications/connections/${c.id}`, {
                            method: "DELETE",
                          }),
                        );
                    }}
                  >
                    {t("Delete")}
                  </button>
                </>
              )}
            </div>
          </section>
        ))}
      </div>
      {editing && (
        <section className="panel">
          <h2 className="mb-4 text-xl">
            {t(editing.id ? "Edit connection" : "Add connection")}
          </h2>
          <form
            className="form-grid"
            onSubmit={(e) => {
              e.preventDefault();
              void action(async () => {
                const { id, ...body } = editing;
                body.config = { ...body.config };
                if (body.config.emailProvider === "smtp") {
                  body.config.smtpPort ??= 587;
                  body.config.smtpSecurity ??= "starttls";
                }
                delete body.config.smtpPasswordSet;
                delete body.config.resendApiKeySet;
                await request(
                  `/api/notifications/connections${id ? `/${id}` : ""}`,
                  { method: id ? "PUT" : "POST", body: JSON.stringify(body) },
                );
                setEditing(null);
              });
            }}
          >
            <label>
              {t("Name")}
              <input
                required
                value={editing.name}
                onChange={(e) =>
                  setEditing({ ...editing, name: e.target.value })
                }
              />
            </label>
            <label>
              {t("Channel")}
              <select
                value={editing.channel}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    channel: e.target.value,
                    config: { language: "en" },
                  })
                }
              >
                {["email", "telegram", "webhook", "slack", "ntfy"].map((v) => (
                  <option key={v} value={v}>
                    {t(v)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("Alert language")}
              <select
                value={editing.config.language || "en"}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    config: { ...editing.config, language: e.target.value },
                  })
                }
              >
                <option value="en">{t("English")}</option>
                <option value="fa">{t("Persian")}</option>
              </select>
            </label>
            {editing.channel === "email" && (
              <>
                <label>
                  {t("Email provider")}
                  <select
                    value={editing.config.emailProvider || "resend"}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        config: {
                          ...editing.config,
                          emailProvider: e.target.value,
                        },
                      })
                    }
                  >
                    <option value="resend">Resend</option>
                    <option value="smtp">SMTP</option>
                  </select>
                </label>
                <label>
                  {t("Sender name")}
                  <input
                    value={editing.config.senderName || ""}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        config: {
                          ...editing.config,
                          senderName: e.target.value,
                        },
                      })
                    }
                  />
                </label>
                {editing.config.emailProvider === "smtp" ? (
                  <>
                    <label>
                      {t("SMTP host")}
                      <input
                        required
                        dir="ltr"
                        value={editing.config.smtpHost || ""}
                        onChange={(e) =>
                          setEditing({
                            ...editing,
                            config: {
                              ...editing.config,
                              smtpHost: e.target.value,
                            },
                          })
                        }
                      />
                    </label>
                    <label>
                      {t("SMTP port")}
                      <input
                        required
                        type="number"
                        min="1"
                        max="65535"
                        value={editing.config.smtpPort ?? 587}
                        onChange={(e) =>
                          setEditing({
                            ...editing,
                            config: {
                              ...editing.config,
                              smtpPort: Number(e.target.value),
                            },
                          })
                        }
                      />
                    </label>
                    <label>
                      {t("Connection security")}
                      <select
                        value={editing.config.smtpSecurity || "starttls"}
                        onChange={(e) =>
                          setEditing({
                            ...editing,
                            config: {
                              ...editing.config,
                              smtpSecurity: e.target.value,
                            },
                          })
                        }
                      >
                        <option value="starttls">STARTTLS</option>
                        <option value="tls">TLS</option>
                        <option value="none">
                          {t("None (internal relay)")}
                        </option>
                      </select>
                    </label>
                    <label className="check-label">
                      <input
                        type="checkbox"
                        checked={!!editing.config.smtpAuth}
                        onChange={(e) =>
                          setEditing({
                            ...editing,
                            config: {
                              ...editing.config,
                              smtpAuth: e.target.checked,
                            },
                          })
                        }
                      />
                      {t("SMTP authentication")}
                    </label>
                    {editing.config.smtpAuth && (
                      <>
                        <label>
                          {t("SMTP username")}
                          <input
                            required
                            autoComplete="off"
                            value={editing.config.smtpUsername || ""}
                            onChange={(e) =>
                              setEditing({
                                ...editing,
                                config: {
                                  ...editing.config,
                                  smtpUsername: e.target.value,
                                },
                              })
                            }
                          />
                        </label>
                        <label>
                          {t("SMTP password")}
                          <input
                            type="password"
                            autoComplete="new-password"
                            placeholder={
                              editing.config.smtpPasswordSet
                                ? t("Saved; leave blank to keep")
                                : ""
                            }
                            value={editing.config.smtpPassword || ""}
                            onChange={(e) =>
                              setEditing({
                                ...editing,
                                config: {
                                  ...editing.config,
                                  smtpPassword: e.target.value || undefined,
                                },
                              })
                            }
                          />
                        </label>
                      </>
                    )}
                  </>
                ) : (
                  <label>
                    {t("Resend API key")}
                    <input
                      type="password"
                      autoComplete="new-password"
                      placeholder={
                        editing.config.resendApiKeySet
                          ? t("Saved; leave blank to keep")
                          : t("Optional: use server key")
                      }
                      value={editing.config.resendApiKey || ""}
                      onChange={(e) =>
                        setEditing({
                          ...editing,
                          config: {
                            ...editing.config,
                            resendApiKey: e.target.value || undefined,
                          },
                        })
                      }
                    />
                  </label>
                )}
              </>
            )}
            {editing.channel === "email" && (
              <label>
                {t("Recipient emails")}
                <textarea
                  aria-label={t("Recipient emails")}
                  required
                  dir="ltr"
                  rows={3}
                  placeholder="first@example.com, second@example.com"
                  value={
                    Array.isArray(editing.config.to)
                      ? editing.config.to.join("\n")
                      : editing.config.to || ""
                  }
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      config: { ...editing.config, to: e.target.value },
                    })
                  }
                />
                <span className="text-sm text-slate-500">
                  {t(
                    "Enter up to 50 email addresses, separated by commas or new lines. The test sends to all saved recipients.",
                  )}
                </span>
              </label>
            )}
            {(editing.channel === "email"
              ? ["from"]
              : editing.channel === "telegram"
                ? ["botToken", "chatId"]
                : editing.channel === "ntfy"
                  ? ["topic", "server"]
                  : editing.channel === "webhook"
                    ? ["url", "secret"]
                    : ["url"]
            ).map((field) => (
              <label key={field}>
                {t(
                  (
                    {
                      to: "Recipient email",
                      from: "Sender email",
                      botToken: "Bot token",
                      chatId: "Chat ID",
                      url: "Webhook URL",
                      secret: "Signing secret",
                      topic: "Topic",
                      server: "Server URL",
                    } as Record<string, string>
                  )[field],
                )}
                <input
                  dir="ltr"
                  type={
                    ["botToken", "secret"].includes(field) ? "password" : "text"
                  }
                  autoComplete="off"
                  required={
                    (field === "from" &&
                      editing.config.emailProvider === "smtp") ||
                    ["to", "botToken", "chatId", "url", "topic"].includes(field)
                  }
                  value={editing.config[field] ?? ""}
                  onChange={(e) => {
                    const config = { ...editing.config };
                    if (e.target.value) config[field] = e.target.value;
                    else delete config[field];
                    setEditing({ ...editing, config });
                  }}
                />
              </label>
            ))}
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
            <label className="check-label">
              <input
                type="checkbox"
                checked={editing.shared}
                onChange={(e) =>
                  setEditing({ ...editing, shared: e.target.checked })
                }
              />
              {t("Allow users to select this connection")}
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
      <NotificationPolicy targetKey="global" />
      <section className="panel">
        <h2 className="mb-4 text-xl">{t("Delivery history")}</h2>
        <label className="form-grid mb-4 max-w-xs">
          {t("Status")}
          <select
            value={historyStatus}
            onChange={(e) => {
              setHistoryStatus(e.target.value);
              setHistoryPage(0);
            }}
          >
            {["", "sent", "partial", "failed", "logged", "pending"].map((x) => (
              <option key={x} value={x}>
                {t(x || "All")}
              </option>
            ))}
          </select>
        </label>
        {history.isError && <p role="alert">{errorMessage(history.error)}</p>}
        <div className="overflow-x-auto">
          <table className="w-full text-start text-sm">
            <thead>
              <tr>
                {["When", "Item", "Source", "Channel", "Status"].map((x) => (
                  <th className="p-2 text-start" key={x}>
                    {t(x)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {history.data?.deliveries.map((r) => (
                <tr key={r.id}>
                  <td className="p-2">
                    <bdi>{formatDate(r.createdAt)}</bdi>
                  </td>
                  <td className="p-2">
                    <bdi>{r.targetName || r.targetKey}</bdi>
                    {r.isTest && ` · ${t("Test")}`}
                  </td>
                  <td className="p-2">{t(r.source)}</td>
                  <td className="p-2">
                    {r.connectionName} · {t(r.channel || "Deleted")}
                  </td>
                  <td className="p-2">
                    {t(
                      r.status === "sent"
                        ? "Accepted by delivery service"
                        : r.status,
                    )}
                    {r.error && <p className="text-rose-600">{t(r.error)}</p>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {history.data?.deliveries.length === 0 && (
            <p className="py-4 text-slate-500">{t("No deliveries yet")}</p>
          )}
        </div>
        <div className="flex gap-3">
          <button
            className="secondary"
            disabled={historyPage === 0 || history.isFetching}
            onClick={() => setHistoryPage((p) => p - 1)}
          >
            {t("Previous")}
          </button>
          <button
            className="secondary"
            disabled={!history.data?.hasMore || history.isFetching}
            onClick={() => setHistoryPage((p) => p + 1)}
          >
            {t("Next")}
          </button>
        </div>
      </section>
    </div>
  );
}
