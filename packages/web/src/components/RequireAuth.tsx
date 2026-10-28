import type { ReactElement } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
export function RequireAuth({
  children,
  admin = false,
}: {
  children: ReactElement;
  admin?: boolean;
}) {
  const auth = useAuth();
  const { t } = useI18n();
  if (auth.isPending) return <p>{t("Loading…")}</p>;
  if (!auth.data) return <Navigate to="/login" replace />;
  if (auth.data.user.mustChangePassword)
    return <Navigate to="/password" replace />;
  if (admin && auth.data.user.role !== "admin")
    return <Navigate to="/" replace />;
  return children;
}
