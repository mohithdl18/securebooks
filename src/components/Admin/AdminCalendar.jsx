"use client";

import { useState } from "react";
import { PRICES } from "@/config/pricing";

const inr = (n) => `₹${Number(n).toLocaleString("en-IN")}`;

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const pad = (n) => String(n).padStart(2, "0");
const toKey = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;

export default function AdminCalendar({
  value,
  today,
  onChange,
  longWeekendDates = [],
  onToggleLongWeekend,
  longWeekendBusy = false,
  longWeekendError = "",
}) {
  const isLongWeekend = longWeekendDates.includes(value);
  const isPast = value < today;
  const [vy, vm] = value.split("-").map(Number);
  const [view, setView] = useState({ year: vy, month: vm - 1 });

  // Keep the visible month in sync when the selected date moves elsewhere.
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    setView({ year: vy, month: vm - 1 });
  }

  const first = new Date(view.year, view.month, 1);
  const daysInMonth = new Date(view.year, view.month + 1, 0).getDate();
  const leading = (first.getDay() + 6) % 7; // Monday first
  const cells = [
    ...Array(leading).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const move = (delta) =>
    setView(({ year, month }) => {
      const d = new Date(year, month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });

  const monthLabel = first.toLocaleDateString("en-IN", { month: "long", year: "numeric" });

  return (
    <div className="rounded-3xl border border-[#052a50]/10 bg-white p-4 sm:p-5">
      <div className="mb-4 flex items-center justify-between">
        <button type="button" onClick={() => move(-1)} aria-label="Previous month"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-[#052a50]/10 hover:bg-[#e4b441]">‹</button>
        <p className="font-semibold">{monthLabel}</p>
        <button type="button" onClick={() => move(1)} aria-label="Next month"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-[#052a50]/10 hover:bg-[#e4b441]">›</button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold uppercase tracking-wide opacity-50">
        {WEEKDAYS.map((d) => <div key={d} className="py-1">{d}</div>)}
      </div>

      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((day, i) => {
          if (!day) return <div key={`e${i}`} />;
          const key = toKey(view.year, view.month, day);
          const selected = key === value;
          const isToday = key === today;
          const isLong = longWeekendDates.includes(key);
          return (
            <button
              key={key}
              type="button"
              onClick={() => onChange(key)}
              aria-pressed={selected}
              className={`aspect-square rounded-xl text-sm transition ${
                selected
                  ? "bg-[#052a50] font-semibold text-white"
                  : isToday
                    ? "border border-[#e4b441] font-semibold hover:bg-[#e4b441]/30"
                    : "hover:bg-[#052a50]/5"
              }`}
            >
              <span className="relative inline-flex flex-col items-center leading-none">
                {day}
                {isLong && (
                  <span
                    aria-label="Long weekend"
                    className={`mt-0.5 h-1.5 w-1.5 rounded-full ${selected ? "bg-[#e4b441]" : "bg-[#b08a28]"}`}
                  />
                )}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex items-center justify-between text-xs">
        <span className="opacity-60">Showing rooms for the selected night</span>
        {value !== today && (
          <button type="button" onClick={() => onChange(today)} className="font-semibold underline underline-offset-4">
            Today
          </button>
        )}
      </div>

      {/* Long weekend pricing for the selected night */}
      <div className={`mt-4 rounded-2xl border p-3 ${isLongWeekend ? "border-[#e4b441] bg-[#e4b441]/10" : "border-[#052a50]/10 bg-[#F7FAEE]"}`}>
        <button
          type="button"
          onClick={() => onToggleLongWeekend?.(value, !isLongWeekend)}
          disabled={longWeekendBusy || isPast}
          aria-pressed={isLongWeekend}
          className={`w-full rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
            isLongWeekend
              ? "border border-[#052a50]/20 bg-white text-[#052a50] hover:bg-[#052a50]/5"
              : "bg-[#e4b441] text-[#052a50] hover:bg-[#052a50] hover:text-white"
          }`}
        >
          {longWeekendBusy
            ? "Saving…"
            : isPast
              ? "Past date"
              : isLongWeekend
                ? "Disable long weekend"
                : "Enable long weekend"}
        </button>
        <p className="mt-2 text-[11px] leading-4 opacity-70">
          {isLongWeekend ? (
            <><strong>Long weekend is on</strong> for this night: </>
          ) : (
            <>When on, this night is charged </>
          )}
          room {inr(PRICES.roomPerNight.longWeekend)} · extra adult {inr(PRICES.extraAdultPerNight.longWeekend)} · child {inr(PRICES.extraChildPerNight.longWeekend)}.
        </p>
        {longWeekendError && <p className="mt-1 text-[11px] text-red-600">{longWeekendError}</p>}
      </div>
    </div>
  );
}
