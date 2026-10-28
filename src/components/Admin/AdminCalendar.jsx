"use client";

import { useState } from "react";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const pad = (n) => String(n).padStart(2, "0");
const toKey = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;

export default function AdminCalendar({ value, today, onChange }) {
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
              {day}
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
    </div>
  );
}
