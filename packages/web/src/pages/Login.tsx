import { useState } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { ShieldCheck } from "lucide-react";
import { request } from "../lib/api";
import { useAuth, useSessionUpdate, type User } from "../lib/auth";
import { useI18n, errorMessage } from "../lib/i18n";
import { LanguageSwitcher } from "../components/LanguageSwitcher";
import { ThemeSwitcher } from "../components/ThemeSwitcher";
export default function Login() {
  const { t } = useI18n();
  const navigate = useNavigate(),
    update = useSessionUpdate();
  const auth = useAuth();
  const [showPassword, setShowPassword] = useState(false);
  const [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  if (auth.data)
    return (
      <Navigate
        to={auth.data.user.mustChangePassword ? "/password" : "/"}
        replace
      />
    );
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <section className="panel w-full max-w-md">
        <div className="flex flex-wrap justify-end gap-2">
          <LanguageSwitcher />
          <ThemeSwitcher />
        </div>
        <ShieldCheck className="mx-auto mt-6 h-12 w-12 text-sky-600" />
        <h1 className="my-4 text-center text-2xl font-semibold">
          {t("Sign in to Bamdad Alert")}
        </h1>
        <p className="mb-6 text-center text-sm text-slate-500">
          {t("Monitor expiry. Stay ahead.")}
        </p>
        <form
          className="form-grid"
          data-testid="login-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              const r = await request<{ user: User }>("/api/auth/login", {
                method: "POST",
                body: JSON.stringify({ username, password }),
              });
              update(r.user);
              navigate(r.user.mustChangePassword ? "/password" : "/", {
                replace: true,
              });
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
              autoComplete="username"
              dir="ltr"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
          <label>
            {t("Password")}
            <input
              autoComplete="current-password"
              dir="ltr"
              required
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={showPassword}
              onChange={(e) => setShowPassword(e.target.checked)}
            />
            {t("Show password")}
          </label>
          {error && (
            <p role="alert" className="text-rose-600">
              {error}
            </p>
          )}
          <button className="primary" disabled={busy}>
            {busy ? t("Verifying…") : t("Sign in")}
          </button>
        </form>
      </section>
    </div>
  );
}
export function PasswordPage() {
  const { t } = useI18n();
  const auth = useAuth(),
    update = useSessionUpdate(),
    navigate = useNavigate();
  const [currentPassword, setCurrent] = useState(""),
    [password, setPassword] = useState(""),
    [confirm, setConfirm] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  if (auth.isPending) return <p>{t("Loading…")}</p>;
  if (!auth.data) return <Navigate to="/login" replace />;
  return (
    <section className="panel mx-auto max-w-md">
      <h1 className="text-xl font-semibold">{t("Change password")}</h1>
      <p className="my-3">
        {t("Use at least 12 characters. First login requires a new password.")}
      </p>
      <form
        className="form-grid"
        onSubmit={async (e) => {
          e.preventDefault();
          if (password !== confirm) {
            setError(t("Passwords do not match"));
            return;
          }
          setBusy(true);
          try {
            const r = await request<{ user: User }>("/api/auth/password", {
              method: "POST",
              body: JSON.stringify({ currentPassword, password }),
            });
            update(r.user);
            navigate("/");
          } catch (err) {
            setError(errorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          {t("Current password")}
          <input
            type="password"
            required
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </label>
        <label>
          {t("New password")}
          <input
            type="password"
            required
            minLength={12}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label>
          {t("Confirm password")}
          <input
            type="password"
            required
            minLength={12}
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <button disabled={busy} className="primary">
          {t("Save")}
        </button>
      </form>
    </section>
  );
}
