import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { request } from "../lib/api";
import { useI18n, errorMessage } from "../lib/i18n";
import { NotificationPolicy } from "../pages/Notifications";
export function UserNotifications({ userId }: { userId: number }) {
  const { t } = useI18n();
  const [target, setTarget] = useState("global");
  const query = useQuery({
    queryKey: ["subscriptions", userId],
    queryFn: () =>
      request<{
        targets: {
          key: string;
          name: string;
          subscribed: boolean;
          inherited: boolean;
        }[];
      }>(`/api/notifications/recipients/${userId}`),
  });
  return (
    <details className="panel space-y-3">
      <summary>{t("User notification subscriptions")}</summary>
      <section className="space-y-3">
        <p>
          {t(
            "Choose a record to edit its recipients. Global defaults apply to records using inheritance.",
          )}
        </p>
        {query.isError && <p role="alert">{errorMessage(query.error)}</p>}
        <label>
          {t("Record")}
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="global">{t("Global notification defaults")}</option>
            {query.data?.targets.map((r) => (
              <option value={r.key} key={r.key}>
                {r.name}
                {r.subscribed ? " · " + t("Subscribed") : ""}
                {r.inherited ? " · " + t("Inherited") : ""}
              </option>
            ))}
          </select>
        </label>
        <NotificationPolicy key={target} targetKey={target} />
      </section>
    </details>
  );
}
