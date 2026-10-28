"use client";

import { useEffect, useState } from "react";
import Modal from "@/components/Bookings/Modal";

export const OFFER_STORAGE_KEY = "suvilla_offer_code";

function formatUntil(value) {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });
}

/** Floating offers button (sits above the cart button). Shows PUBLIC offers only. */
export default function OffersButton() {
  const [isOpen, setIsOpen] = useState(false);
  const [offers, setOffers] = useState(null);
  const [error, setError] = useState("");
  const [picked, setPicked] = useState("");

  useEffect(() => {
    let alive = true;
    fetch("/api/offers", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => alive && (d.success ? setOffers(d.offers || []) : setError(d.message || "")))
      .catch(() => alive && setError("Couldn't load offers right now."));
    return () => {
      alive = false;
    };
  }, []);

  function applyOffer(code) {
    try {
      window.sessionStorage.setItem(OFFER_STORAGE_KEY, code);
    } catch {
      // storage unavailable — copying still works
    }
    navigator.clipboard?.writeText(code).catch(() => {});
    setPicked(code);
  }

  const count = offers?.length || 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        aria-label={`View offers${count ? `, ${count} available` : ""}`}
        className="fixed bottom-[6.25rem] right-5 z-[90] flex h-16 w-16 items-center justify-center rounded-full bg-[#e4b441] text-[#052a50] shadow-xl transition hover:scale-105 hover:bg-[#052a50] hover:text-white focus:outline-none focus:ring-4 focus:ring-[#e4b441]/50 sm:bottom-[7.25rem] sm:right-7"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-7 w-7" aria-hidden="true">
          <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z" />
          <circle cx="7.5" cy="7.5" r="1.5" />
        </svg>
        {count > 0 && (
          <span className="absolute -right-1 -top-1 flex h-6 min-w-6 items-center justify-center rounded-full border-2 border-[#F7FAEE] bg-[#052a50] px-1 text-xs font-bold text-white">
            {count}
          </span>
        )}
      </button>

      <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} title="Offers">
        <div className="space-y-3 text-[#052a50]">
          {!offers && !error && <p className="text-sm opacity-60">Loading offers…</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}
          {offers && !offers.length && (
            <p className="rounded-2xl border border-[#052a50]/10 bg-white p-5 text-center text-sm opacity-70">
              No offers right now. Check back soon!
            </p>
          )}

          {offers?.map((o) => (
            <div key={o.code} className="flex items-center justify-between gap-4 rounded-2xl border border-dashed border-[#e4b441] bg-white p-4">
              <div className="min-w-0">
                <p className="text-2xl font-bold">{o.percent}% OFF</p>
                <p className="mt-1 font-mono text-sm font-semibold tracking-widest">{o.code}</p>
                {o.validUntil && <p className="mt-1 text-xs opacity-60">Valid till {formatUntil(o.validUntil)}</p>}
              </div>
              <button
                type="button"
                onClick={() => applyOffer(o.code)}
                className={`shrink-0 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
                  picked === o.code ? "bg-green-700 text-white" : "bg-[#052a50] text-white hover:bg-[#e4b441] hover:text-[#052a50]"
                }`}
              >
                {picked === o.code ? "Copied ✓" : "Use code"}
              </button>
            </div>
          ))}

          {offers?.length > 0 && (
            <p className="pt-1 text-xs leading-5 opacity-60">
              {picked
                ? `${picked} will be filled in for you at checkout.`
                : "Tap “Use code” and it will be filled in at checkout."}{" "}
              The discount applies to your booking amount before tax and platform fee.
            </p>
          )}
        </div>
      </Modal>
    </>
  );
}
