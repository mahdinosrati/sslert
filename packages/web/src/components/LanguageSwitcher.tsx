import { useI18n } from "../lib/i18n";

export function LanguageSwitcher() {
  const { language, setLanguage, t } = useI18n();
  return (
    <select
      aria-label={t("Language")}
      value={language}
      onChange={(event) => setLanguage(event.target.value === "fa" ? "fa" : "en")}
      className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700"
    >
      <option value="en" lang="en">English</option>
      <option value="fa" lang="fa">فارسی</option>
    </select>
  );
}
