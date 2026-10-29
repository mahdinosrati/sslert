import { useEffect, useState } from "react";
import {
  Routes,
  Route,
  Link,
  useLocation,
  Navigate,
  useNavigate,
} from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, LogOut } from "lucide-react";
import { useI18n } from "./lib/i18n";
import { request } from "./lib/api";
import { useAuth, useSessionUpdate, permits } from "./lib/auth";
import { AddDomainDialog } from "./components/AddDomainDialog";
import { RequireAuth } from "./components/RequireAuth";
import { LanguageSwitcher } from "./components/LanguageSwitcher";
import { ThemeSwitcher } from "./components/ThemeSwitcher";
import { Dashboard } from "./pages/Dashboard";
import { DomainDetail } from "./pages/DomainDetail";
import { AuditLog } from "./pages/AuditLog";
import Login, { PasswordPage } from "./pages/Login";
import { Resources } from "./pages/Resources";
import { Notifications } from "./pages/Notifications";
import { Users, Settings } from "./pages/Users";
import { About } from "./pages/About";
export default function App() {
  const { t, language } = useI18n(),
    location = useLocation(),
    navigate = useNavigate(),
    auth = useAuth(),
    update = useSessionUpdate(),
    cache = useQueryClient();
  const user = auth.data?.user;
  const [addOpen, setAddOpen] = useState(false);
  useEffect(() => {
    document.title =
      language === "fa"
        ? "هشدار بامداد | پایش اعتبار و هشدار"
        : "Bamdad Alert | Expiry monitoring";
  }, [language]);
  useEffect(() => {
    const expired = () => {
      cache.clear();
      navigate("/login");
    };
    window.addEventListener("bamdad.unauthorized", expired);
    return () => window.removeEventListener("bamdad.unauthorized", expired);
  }, [cache, navigate]);
  const login = location.pathname === "/login";
  const links = [
    ["/", "Dashboard"],
    ["/resources", "Manual expiry records"],
    ["/notifications", "Notifications"],
    ...(user?.role === "admin"
      ? [
          ["/users", "Users & access"],
          ["/settings", "Settings"],
          ["/audit", "Audit"],
        ]
      : []),
    ["/about", "About us"],
  ];
  return (
    <div className="min-h-full bg-slate-50 text-slate-900">
      {!login && (
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-4">
            <Link
              to="/"
              className="flex items-center gap-2 text-xl font-semibold"
            >
              <ShieldCheck className="text-sky-600" />
              <span>{t("Bamdad Alert")}</span>
            </Link>
            <div className="flex flex-wrap items-center gap-2">
              <LanguageSwitcher />
              <ThemeSwitcher />
              {user && (
                <button
                  title={t("Sign out")}
                  aria-label={t("Sign out")}
                  className="secondary"
                  onClick={async () => {
                    await request("/api/auth/logout", { method: "POST" });
                    update();
                    navigate("/login");
                  }}
                >
                  <LogOut className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
          {user && !user.mustChangePassword && (
            <nav className="mx-auto flex max-w-7xl flex-wrap items-center gap-2 px-4 pb-3">
              {links.map(([href, label]) => (
                <Link
                  key={href}
                  to={href}
                  className={
                    location.pathname === href ? "primary" : "secondary"
                  }
                >
                  {t(label)}
                </Link>
              ))}
              {permits(user, "canCreate") && (
                <button className="secondary" onClick={() => setAddOpen(true)}>
                  {t("+ Add domain")}
                </button>
              )}
              <Link className="ms-auto text-sm text-slate-500" to="/password">
                {t("Change password")}
              </Link>
            </nav>
          )}
        </header>
      )}
      <main className={login ? "" : "mx-auto max-w-7xl px-4 py-6 sm:px-6"}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/password" element={<PasswordPage />} />
          <Route
            path="/"
            element={
              <RequireAuth>
                <Dashboard />
              </RequireAuth>
            }
          />
          <Route
            path="/domains/:id"
            element={
              <RequireAuth>
                <DomainDetail />
              </RequireAuth>
            }
          />
          <Route
            path="/resources"
            element={
              <RequireAuth>
                <Resources />
              </RequireAuth>
            }
          />
          <Route
            path="/notifications"
            element={
              <RequireAuth>
                <Notifications />
              </RequireAuth>
            }
          />
          <Route
            path="/users"
            element={
              <RequireAuth admin>
                <Users />
              </RequireAuth>
            }
          />
          <Route
            path="/settings"
            element={
              <RequireAuth admin>
                <Settings />
              </RequireAuth>
            }
          />
          <Route
            path="/audit"
            element={
              <RequireAuth admin>
                <AuditLog />
              </RequireAuth>
            }
          />
          <Route
            path="/about"
            element={
              <RequireAuth>
                <About />
              </RequireAuth>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      {!login && (
        <footer className="py-6 text-center text-xs text-slate-500">
          {t("Bamdad Alert")} · 1.0.2
        </footer>
      )}
      {user && !user.mustChangePassword && permits(user, "canCreate") && (
        <AddDomainDialog open={addOpen} onOpenChange={setAddOpen} />
      )}
    </div>
  );
}
