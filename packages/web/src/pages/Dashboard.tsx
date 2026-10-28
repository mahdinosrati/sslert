import { useI18n, formatNumber } from "../lib/i18n";
import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { DomainTable } from "../components/DomainTable";
import { api, type DomainRow } from "../lib/api";
import { Activity, AlertCircle, Globe, ShieldCheck, XCircle } from "lucide-react";

interface StatCardProps {
  label: string;
  value: number;
  hint?: string;
  icon: React.ReactNode;
  tone?: "default" | "warning" | "danger" | "success";
}

function StatCard({ label, value, hint, icon, tone = "default" }: StatCardProps) {
  const { t } = useI18n();
  const toneRing: Record<string, string> = {
    default: "ring-slate-200",
    warning: "ring-amber-200",
    danger: "ring-rose-200",
    success: "ring-emerald-200",
  };
  const toneIcon: Record<string, string> = {
    default: "text-slate-500",
    warning: "text-amber-500",
    danger: "text-rose-500",
    success: "text-emerald-500",
  };
  return (
    <Card className={`ring-1 ${toneRing[tone]}`}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle>{label}</CardTitle>
        <span className={toneIcon[tone]}>{icon}</span>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-semibold tracking-tight text-slate-900">
          {formatNumber(value)}
        </div>
        {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      </CardContent>
    </Card>
  );
}

export function Dashboard() {
  const { t } = useI18n();
  const dashboard = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api.dashboard(),
  });

  const domains = useQuery({
    queryKey: ["domains"],
    queryFn: async () => {
      const r = await api.listDomains();
      return r.domains;
    },
  });

  const summary = dashboard.data;
  const rows: DomainRow[] = domains.data ?? summary?.domains ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{t("Dashboard")}</h1>
        <p className="text-sm text-slate-500">{t("Self-hosted SSL certificate and domain expiry monitoring.")}</p>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">{t("TLS certificates")}</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label={t("Total Domains")}
            value={summary?.total ?? rows.length}
            hint={t("Being monitored")}
            icon={<Activity className="h-5 w-5" />}
          />
          <StatCard
            label={t("Cert Expiring Soon")}
            value={summary?.expiringSoon ?? 0}
            hint={t("≤ 30 days remaining")}
            tone="warning"
            icon={<AlertCircle className="h-5 w-5" />}
          />
          <StatCard
            label={t("Cert Expired")}
            value={summary?.expired ?? 0}
            hint={t("Cert past expiry")}
            tone="danger"
            icon={<XCircle className="h-5 w-5" />}
          />
          <StatCard
            label={t("Healthy")}
            value={summary?.healthy ?? 0}
            hint={t("> 30 days remaining")}
            tone="success"
            icon={<ShieldCheck className="h-5 w-5" />}
          />
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">{t("Domain registration")}</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-2">
          <StatCard
            label={t("Domain Expiring Soon")}
            value={summary?.domainExpiringSoon ?? 0}
            hint={t("≤ 30 days remaining")}
            tone="warning"
            icon={<Globe className="h-5 w-5" />}
          />
          <StatCard
            label={t("Domain Expired")}
            value={summary?.domainExpired ?? 0}
            hint={t("Registration past expiry")}
            tone="danger"
            icon={<Globe className="h-5 w-5" />}
          />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("Domains")}</CardTitle>
        </CardHeader>
        <CardContent>
          {dashboard.isLoading || domains.isLoading ? (
            <p className="py-8 text-center text-sm text-slate-500">{t("Loading…")}</p>
          ) : (
            <DomainTable rows={rows} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
