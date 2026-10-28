import { useAuth, permits } from "../lib/auth";
import { useI18n, formatNumber } from "../lib/i18n";
import { useNavigate } from "react-router-dom";
import { RefreshCw, Trash2, Loader2, Globe, AlertCircle } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";
import { Button } from "./ui/button";
import { StatusBadge } from "./StatusBadge";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type DomainRow } from "../lib/api";
import { formatDistanceToNowStrict } from "../lib/format";
import { certErrorTitle } from "../lib/cert-errors";
import { humanizeCertError } from "../lib/cert-errors";

export function DomainTable({ rows }: { rows: DomainRow[] }) {
  const { t } = useI18n();
  const user = useAuth().data?.user;
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const checkMutation = useMutation({
    mutationFn: (id: number) => api.checkNow(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["domains"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.deleteDomain(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["domains"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 p-12 text-center text-sm text-slate-500">
        {t("No domains yet. Click")}{" "}
        <span className="font-medium">{t("+ Add")}</span>{" "}
        {t("to start monitoring.")}
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("Domain")}</TableHead>
          <TableHead>{t("Issuer")}</TableHead>
          <TableHead className="text-end">{t("Cert Days")}</TableHead>
          <TableHead className="text-end">{t("Domain Days")}</TableHead>
          <TableHead>{t("Last Check")}</TableHead>
          <TableHead>{t("Status")}</TableHead>
          <TableHead className="text-end">{t("Actions")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(({ domain, lastCheck }) => {
          const days = lastCheck?.daysRemaining ?? null;
          const domainDays = lastCheck?.domainExpiresDaysRemaining ?? null;
          return (
            <TableRow
              key={domain.id}
              className="cursor-pointer"
              onClick={() => navigate(`/domains/${domain.id}`)}
            >
              <TableCell dir="ltr" className="font-mono text-slate-900">
                {domain.hostname}
                <span className="ms-1 text-slate-400">:{domain.port}</span>
              </TableCell>
              <TableCell>
                {lastCheck?.issuerOrg ?? lastCheck?.issuer ?? "—"}
              </TableCell>
              <TableCell className="text-end font-mono">
                {days === null || days === undefined ? "—" : formatNumber(days)}
              </TableCell>
              <TableCell className="text-end font-mono">
                {domainDays === null || domainDays === undefined ? (
                  <span className="text-slate-400">—</span>
                ) : (
                  <span className="inline-flex items-center gap-1">
                    <Globe className="h-3 w-3 text-slate-400" />
                    {formatNumber(domainDays)}
                  </span>
                )}
              </TableCell>
              <TableCell>
                {lastCheck?.checkedAt
                  ? formatDistanceToNowStrict(new Date(lastCheck.checkedAt))
                  : "—"}
              </TableCell>
              <TableCell>
                <StatusBadge daysRemaining={days} />
                {/* Bug #2 fix (2026-06-23): when the check errored
                    (revoked / self-signed / untrusted / unreachable)
                    the StatusBadge above may say "Healthy" because
                    `daysRemaining` is null. Surface the human-readable
                    error inline so operators see the problem at a
                    glance, not just a missing number. */}
                {lastCheck?.valid === false && lastCheck.error && (
                  <span
                    title={certErrorTitle(lastCheck.error)}
                    className="ms-1 inline-flex items-center gap-1 text-xs text-rose-600"
                  >
                    <AlertCircle className="h-3 w-3" />
                    {certErrorTitle(lastCheck.error)}
                  </span>
                )}
              </TableCell>
              <TableCell className="text-end">
                <div
                  className="flex justify-end gap-1"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Button
                    size="icon"
                    variant="ghost"
                    title={t("Check now")}
                    disabled={
                      checkMutation.isPending || !permits(user, "canEdit")
                    }
                    onClick={() => checkMutation.mutate(domain.id)}
                  >
                    {checkMutation.isPending &&
                    checkMutation.variables === domain.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    title={t("Delete")}
                    disabled={user?.role !== "admin"}
                    onClick={() => {
                      if (
                        confirm(
                          t("Remove {hostname}?", {
                            hostname: domain.hostname,
                          }),
                        )
                      ) {
                        deleteMutation.mutate(domain.id);
                      }
                    }}
                  >
                    <Trash2 className="h-4 w-4 text-rose-500" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
