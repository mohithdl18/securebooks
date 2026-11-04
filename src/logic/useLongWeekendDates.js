"use client";

import { useEffect, useSyncExternalStore } from "react";

/**
 * Nights of the stay the admin marked as "long weekend".
 * Every price display (room cards, packages, cart, checkout) calls this
 * with the stay dates; one shared cache means one request per stay.
 * Refreshes when the guest returns to the tab and every minute, so a
 * change in the admin shows without reloading.
 */
const EMPTY = Object.freeze([]);
const cache = new Map(); // "checkIn|checkOut" -> { dates, at, loading }
const listeners = new Set();
const isDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

function emit() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function load(key, checkIn, checkOut, force) {
  const entry = cache.get(key);
  if (entry?.loading) return;
  if (entry && Date.now() - entry.at < (force ? 3000 : 30000)) return;

  cache.set(key, { dates: entry?.dates || EMPTY, at: entry?.at || 0, loading: true });
  let dates = entry?.dates || EMPTY;
  try {
    const response = await fetch(
      `/api/pricing/long-weekends?checkIn=${encodeURIComponent(checkIn)}&checkOut=${encodeURIComponent(checkOut)}`,
      { cache: "no-store" }
    );
    const data = await response.json().catch(() => ({}));
    if (response.ok && Array.isArray(data.longWeekendDates)) {
      const next = [...data.longWeekendDates].sort();
      const same = dates.length === next.length && dates.every((d, i) => d === next[i]);
      dates = same ? dates : Object.freeze(next);
    }
  } catch {
    // Keep the last known dates; the server re-checks at payment anyway.
  }
  cache.set(key, { dates, at: Date.now(), loading: false });
  emit();
}

export function useLongWeekendDates(checkIn, checkOut) {
  const key = isDate(checkIn) && isDate(checkOut) && checkOut > checkIn ? `${checkIn}|${checkOut}` : null;

  const dates = useSyncExternalStore(
    subscribe,
    () => (key ? cache.get(key)?.dates || EMPTY : EMPTY),
    () => EMPTY
  );

  useEffect(() => {
    if (!key) return undefined;
    load(key, checkIn, checkOut, false);

    const refresh = () => {
      if (document.visibilityState === "visible") load(key, checkIn, checkOut, true);
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const timer = setInterval(refresh, 60000);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      clearInterval(timer);
    };
  }, [key, checkIn, checkOut]);

  return dates;
}
