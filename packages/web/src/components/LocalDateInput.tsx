import { useEffect, useId, useRef, useState } from "react";
import { toJalaali, toGregorian, jalaaliMonthLength } from "jalaali-js";
import { useI18n, formatNumber } from "../lib/i18n";
import { fromJalaliDate, toJalaliDate } from "../lib/jalali";
const months = [
  "فروردین",
  "اردیبهشت",
  "خرداد",
  "تیر",
  "مرداد",
  "شهریور",
  "مهر",
  "آبان",
  "آذر",
  "دی",
  "بهمن",
  "اسفند",
];
export function LocalDateInput({
  value,
  onChange,
  required = false,
  disabled = false,
  start = false,
}: {
  value: string;
  onChange: (s: string) => void;
  required?: boolean;
  disabled?: boolean;
  start?: boolean;
}) {
  const { t, language } = useI18n();
  const fa = language === "fa",
    id = useId(),
    input = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(toJalaliDate(value)),
    [open, setOpen] = useState(false);
  const today = toJalaali(new Date()),
    [year, setYear] = useState(today.jy),
    [month, setMonth] = useState(today.jm);
  useEffect(() => {
    setDraft(toJalaliDate(value));
    if (value) {
      const p = toJalaliDate(value).split("/").map(Number);
      if (p[0]) {
        setYear(p[0]);
        setMonth(p[1]);
      }
    }
  }, [value, fa]);
  const invalid = fa && !!draft && !fromJalaliDate(draft);
  useEffect(() => {
    input.current?.setCustomValidity(invalid ? t("Invalid Jalali date") : "");
  }, [invalid, t]);
  const label = t(
    start
      ? fa
        ? "Valid from (Jalali)"
        : "Valid from (Gregorian, UTC)"
      : fa
        ? "Expiry date (Jalali)"
        : "Expiry date (Gregorian, UTC)",
  );
  function select(day: number) {
    const v = `${year}/${month}/${day}`,
      iso = fromJalaliDate(v);
    if (iso) {
      setDraft(toJalaliDate(iso));
      onChange(iso);
      setOpen(false);
    }
  }
  const first = toGregorian(year, month, 1),
    offset =
      (new Date(Date.UTC(first.gy, first.gm - 1, first.gd)).getUTCDay() + 1) %
      7;
  function move(delta: number) {
    const next = month + delta;
    if (next < 1) {
      if (year > 1) {
        setYear(year - 1);
        setMonth(12);
      }
    } else if (next > 12) {
      if (year < 3177) {
        setYear(year + 1);
        setMonth(1);
      }
    } else setMonth(next);
  }
  return (
    <div className="space-y-2">
      <label htmlFor={id}>{label}</label>
      <input
        ref={input}
        id={id}
        aria-label={label}
        dir="ltr"
        type={fa ? "text" : "date"}
        placeholder={fa ? "۱۴۰۵/۰۸/۱۰" : undefined}
        required={required}
        disabled={disabled}
        value={fa ? draft : value}
        aria-invalid={invalid || undefined}
        onChange={(e) => {
          if (!fa) {
            onChange(e.target.value);
            return;
          }
          setDraft(e.target.value);
          if (!e.target.value) onChange("");
          else {
            const iso = fromJalaliDate(e.target.value);
            if (iso) onChange(iso);
          }
        }}
      />
      {invalid && (
        <p className="text-sm text-rose-600" role="alert">
          {t("Invalid Jalali date")}
        </p>
      )}
      {fa && (
        <button
          type="button"
          className="secondary"
          disabled={disabled}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {t("Choose date")} · {label}
        </button>
      )}
      {fa && open && !disabled && (
        <div
          className="panel max-w-sm space-y-3"
          role="group"
          aria-label={t("Persian calendar")}
        >
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="secondary"
              aria-label={t("Previous month")}
              onClick={() => move(-1)}
            >
              ‹
            </button>
            <select
              aria-label={t("Month")}
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
            >
              {months.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
            <input
              aria-label={t("Year")}
              type="number"
              min={1}
              max={3177}
              value={year}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (n >= 1 && n <= 3177) setYear(n);
              }}
            />
            <button
              type="button"
              className="secondary"
              aria-label={t("Next month")}
              onClick={() => move(1)}
            >
              ›
            </button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-sm">
            {["ش", "ی", "د", "س", "چ", "پ", "ج"].map((d, i) => (
              <span key={i}>{d}</span>
            ))}
            {Array.from({ length: offset }, (_, i) => (
              <span key={"empty" + i} />
            ))}
            {Array.from({ length: jalaaliMonthLength(year, month) }, (_, i) => (
              <button
                className="rounded p-2 hover:bg-sky-500/20"
                key={i}
                type="button"
                aria-label={`${year}/${month}/${i + 1}`}
                onClick={() => select(i + 1)}
              >
                {formatNumber(i + 1)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
