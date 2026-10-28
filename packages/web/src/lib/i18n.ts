import { useSyncExternalStore } from "react";
import fa from "./locales/fa.json";

export type Language = "en" | "fa";
const STORAGE_KEY = "sslert.language";
const listeners = new Set<() => void>();
function readLanguage(): Language {
  try { return localStorage.getItem(STORAGE_KEY) === "fa" ? "fa" : "en"; }
  catch { return "en"; }
}
let language: Language = readLanguage();
export function getLanguage(): Language { return language; }

function syncDocument() {
  if (typeof document === "undefined") return;
  document.documentElement.lang = language;
  document.documentElement.dir = language === "fa" ? "rtl" : "ltr";
}
syncDocument();

export function setLanguage(next: Language) {
  language = next;
  try { localStorage.setItem(STORAGE_KEY, next); } catch { /* Keep the session preference. */ }
  syncDocument();
  listeners.forEach((listener) => listener());
}
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    language = readLanguage();
    syncDocument();
    listeners.forEach((listener) => listener());
  });
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

// English source strings are also the fallback for unknown server messages.
export function t(message: string, values: Record<string, string | number> = {}): string {
  const template = language === "fa" ? (fa as Record<string, string>)[message] ?? message : message;
  return template.replace(/\{(\w+)\}/g, (match, key: string) => String(values[key] ?? match));
}
export function useI18n() {
  const current = useSyncExternalStore(subscribe, getLanguage, () => "en" as Language);
  return { language: current, t, setLanguage };
}
export function formatNumber(value: number): string {
  return new Intl.NumberFormat(language === "fa" ? "fa-IR" : "en-US").format(value);
}

export function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (language === "en") return message;
  const status = (error as { status?: number } | null)?.status;
  if (status === 401) return t("Unauthorized — check your API token");
  if (status === 429) return t("Too many requests. Please try again shortly.");
  if (status && status >= 500) return t("Server unavailable. Check the API logs.");
  if (message === "Failed to fetch" || message === "fetch failed") return t("Unable to connect to the server.");
  return t(message);
}
