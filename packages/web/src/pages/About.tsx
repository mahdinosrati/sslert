import { Mail, Send } from "lucide-react";
import { useI18n } from "../lib/i18n";
export function About() {
  const { language, t } = useI18n();
  return (
    <article className="panel mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold">{t("About us")}</h1>
      <h2 className="text-xl">
        {language === "fa"
          ? "گروه فناوری اطلاعات بامداد"
          : "Bamdad Information Technology Group"}
      </h2>
      <p className="leading-8">
        {language === "fa"
          ? "هشدار بامداد با هدف کمک به گروه فناوری اطلاعات بامداد در پایش اعتبار گواهی‌ها، دامنه‌ها، لایسنس‌های نرم‌افزاری و سرویس‌های API توسعه یافته است. این سامانه اطلاعات انقضا و هشدارها را در یک پنل متمرکز در اختیار تیم قرار می‌دهد."
          : "Bamdad Alert helps the Bamdad Information Technology Group monitor certificates, domain registrations, software licenses and API expiry dates. It brings expiry information and notifications together in one panel for the team."}
      </p>
      <p>
        {language === "fa"
          ? "این برنامه توسط مهدی نصرتی توسعه داده شده است."
          : "This application was developed by Mahdi Nosrati."}
      </p>
      <div className="flex gap-3">
        <a
          aria-label={t("Developer email")}
          title={t("Developer email")}
          className="secondary h-11 w-11 text-sky-700"
          href="mailto:mahdinosrati07@gmail.com"
        >
          <Mail aria-label={t("Email")} className="h-5 w-5" />
        </a>
        <a
          href="https://t.me/MiNosrati"
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t("Developer Telegram")}
          title={t("Developer Telegram")}
          className="secondary h-11 w-11 text-sky-700"
        >
          <Send className="h-5 w-5" aria-hidden="true" />
        </a>
      </div>
      <p className="text-sm text-slate-500">{t("Bamdad Alert")} · 1.0.3</p>
    </article>
  );
}
