import { useEffect, useState } from "react";
import { useI18n } from "../lib/i18n";
export function ThemeSwitcher() {
  const { t } = useI18n();
  const [theme, setTheme] = useState(
    () => localStorage.getItem("bamdad.theme") || "system",
  );
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme =
        theme === "system" ? (media.matches ? "dark" : "light") : theme;
    };
    apply();
    localStorage.setItem("bamdad.theme", theme);
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
  return (
    <select
      aria-label={t("Theme")}
      value={theme}
      onChange={(e) => setTheme(e.target.value)}
      className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm"
    >
      <option value="system">{t("System theme")}</option>
      <option value="light">{t("Light")}</option>
      <option value="dark">{t("Dark")}</option>
    </select>
  );
}
