import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { request } from "../lib/api";
import { useI18n, errorMessage } from "../lib/i18n";
type Config = {
  enabled: boolean;
  adminOnly?: boolean;
  host: string;
  port: number;
  security: "ldaps" | "starttls" | "ldap";
  baseDn: string;
  bindDn: string;
  bindPassword?: string;
  bindPasswordSet?: boolean;
  userAttribute: string;
  userGroup: string;
  adminGroup: string;
  caPem: string;
};
export function LdapSettings() {
  const { t } = useI18n(),
    cache = useQueryClient();
  const query = useQuery({
    queryKey: ["ldap-settings"],
    queryFn: () => request<{ settings: Config }>("/api/settings/ldap"),
  });
  const [settings, setSettings] = useState<Config | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [testUser, setTestUser] = useState("");
  useEffect(() => {
    if (query.data) setSettings(query.data.settings);
  }, [query.data]);
  async function submit(test: boolean) {
    if (!settings) return;
    setBusy(true);
    setMessage("");
    try {
      const { bindPasswordSet, ...data } = settings;
      const result = await request<{ settings: Config; role: string | null }>(
        "/api/settings/ldap/" + (test ? "test" : "save"),
        {
          method: "POST",
          body: JSON.stringify({ settings: data, username: testUser }),
        },
      );
      if (test)
        setMessage(
          t(
            result.role
              ? "Directory user found in an allowed group"
              : "Directory connection successful",
          ) +
            (result.role
              ? " · " + t(result.role === "admin" ? "Administrator" : "User")
              : ""),
        );
      else {
        setSettings(result.settings);
        await cache.invalidateQueries({ queryKey: ["login-providers"] });
        setMessage(t("Saved"));
      }
    } catch (e) {
      setMessage(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel space-y-4">
      <h2 className="text-xl font-semibold">LDAP</h2>
      <p className="text-sm text-slate-500">
        {t(
          "Directory login is optional. Keep a local administrator for recovery. Group membership controls directory roles; item permissions remain in the panel.",
        )}
      </p>
      {query.error && <p role="alert">{errorMessage(query.error)}</p>}
      {settings && (
        <form
          className="form-grid"
          onSubmit={(e) => {
            e.preventDefault();
            void submit(false);
          }}
        >
          <label className="check-label">
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={(e) =>
                setSettings({ ...settings, enabled: e.target.checked })
              }
            />
            {t("Enable LDAP login")}
          </label>
          <label className="check-label"><input type="checkbox" checked={!!settings.adminOnly} onChange={(e) => setSettings({...settings, adminOnly:e.target.checked})} />{t("One directory group, administrator access only")}</label>
          {settings.adminOnly && <p>{t("Only members of the administrator group can sign in. Every member receives full panel administrator access.")}</p>}
          {(
            [
              ["host", "Directory server"],
              ["baseDn", "Base DN"],
              ["bindDn", "Search account DN / UPN"],
              ["userGroup", "Allowed user group DN"],
              ["adminGroup", "Administrator group DN"],
            ] as const
          ).filter(([key]) => !settings.adminOnly || key !== "userGroup").map(([key, label]) => (
            <label key={key}>
              {t(label)}
              <input
                dir="ltr"
                value={settings[key]}
                onChange={(e) =>
                  setSettings({ ...settings, [key]: e.target.value })
                }
              />
            </label>
          ))}
          <label>
            {t("Directory port")}
            <input
              type="number"
              min={1}
              max={65535}
              value={settings.port}
              onChange={(e) =>
                setSettings({ ...settings, port: Number(e.target.value) })
              }
            />
          </label>
          <label>
            {t("Connection security")}
            <select
              value={settings.security}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  security: e.target.value as Config["security"],
                  port: e.target.value === "ldaps" ? 636 : 389,
                })
              }
            >
              <option value="ldaps">LDAPS</option>
              <option value="starttls">STARTTLS</option>
              <option value="ldap">{t("LDAP without encryption")}</option>
            </select>
          </label>
          {settings.security === "ldap" && <p role="note" className="text-amber-700 dark:text-amber-300">{t("Unencrypted LDAP sends search-account and user passwords without transport encryption. Use only on an explicitly trusted network.")}</p>}
          <label>
            {t("Search account password")}
            <input
              type="password"
              autoComplete="new-password"
              value={settings.bindPassword || ""}
              placeholder={
                settings.bindPasswordSet ? t("Saved; leave blank to keep") : ""
              }
              onChange={(e) =>
                setSettings({
                  ...settings,
                  bindPassword: e.target.value || undefined,
                })
              }
            />
          </label>
          <label>
            {t("Login attribute")}
            <select
              value={settings.userAttribute}
              onChange={(e) =>
                setSettings({ ...settings, userAttribute: e.target.value })
              }
            >
              <option value="sAMAccountName">sAMAccountName</option>
              <option value="userPrincipalName">userPrincipalName</option>
            </select>
          </label>
          <label>
            {t("Organizational CA certificate (PEM)")}
            <textarea
              rows={5}
              dir="ltr"
              value={settings.caPem}
              onChange={(e) =>
                setSettings({ ...settings, caPem: e.target.value })
              }
            />
          </label>
          <p className="text-sm text-slate-500">
            {t(
              "Use dedicated AD groups. Nested membership is supported; primary-group-only membership is not. Leave the administrator group empty to grant no directory administrator access.",
            )}
          </p>
          <label>
            {t("Test username (optional)")}
            <input
              dir="ltr"
              value={testUser}
              onChange={(e) => setTestUser(e.target.value)}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => void submit(true)}
            >
              {t("Test directory connection")}
            </button>
            <button className="primary" disabled={busy}>
              {t("Save directory settings")}
            </button>
          </div>
        </form>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
