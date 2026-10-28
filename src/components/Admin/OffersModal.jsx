"use client";

import { useEffect, useState } from "react";
import AdminModal from "./AdminModal";
import { adminFetch, todayIST, formatDate } from "@/lib/adminClient";

const DAY_PRESETS = [1, 3, 7, 15, 30, 60, 90];
const STATUS = {
  live: "bg-green-50 text-green-800 border-green-200",
  expired: "bg-[#052a50]/5 text-[#052a50]/60 border-[#052a50]/15",
  off: "bg-red-50 text-red-700 border-red-200",
};

// Day 1 = today, so N days ends on today + N − 1.
function lastValidDay(days) {
  const d = new Date(`${todayIST()}T00:00:00`);
  d.setDate(d.getDate() + Math.max(1, days) - 1);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export default function OffersModal({ isOpen, onClose }) {
  const [code, setCode] = useState("");
  const [visibility, setVisibility] = useState("public");
  const [days, setDays] = useState(7);
  const [percent, setPercent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [offers, setOffers] = useState(null);

  const loadOffers = () =>
    adminFetch("/api/admin/offers").then((d) => setOffers(d.offers)).catch((e) => setError(e.message));

  useEffect(() => {
    if (isOpen) loadOffers();
  }, [isOpen]);

  async function publish(event) {
    event.preventDefault();
    if (busy) return;
    setError("");
    setNotice("");
    const pct = Number(percent);
    if (!/^[A-Z0-9]{3,24}$/.test(code)) return setError("Offer code must be 3–24 letters or numbers (no spaces).");
    if (!Number.isInteger(pct) || pct < 1 || pct > 90) return setError("Percentage must be a whole number from 1 to 90.");
    if (!Number.isInteger(days) || days < 1 || days > 365) return setError("Validity must be 1–365 days.");

    setBusy(true);
    try {
      const { offer } = await adminFetch("/api/admin/offers", {
        method: "POST",
        body: { code, visibility, days, percent: pct },
      });
      setNotice(`${offer.code} (${offer.percent}% off) is live${offer.visibility === "public" ? " and shown on the bookings page" : " as a private code"}.`);
      setCode("");
      setPercent("");
      loadOffers();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function turnOff(offerCode) {
    setError("");
    setNotice("");
    try {
      await adminFetch("/api/admin/offers", { method: "DELETE", body: { code: offerCode } });
      setNotice(`${offerCode} was turned off.`);
      loadOffers();
    } catch (e) {
      setError(e.message);
    }
  }

  const input = "mt-2 w-full rounded-xl border border-[#052a50]/15 bg-white px-4 py-3 text-sm outline-none focus:border-[#e4b441]";

  return (
    <AdminModal isOpen={isOpen} onClose={onClose} title="Offers">
      <div className="space-y-6 text-[#052a50]">
        <form onSubmit={publish} className="rounded-2xl border border-[#052a50]/10 bg-white p-4 sm:p-5">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-[0.12em] text-[#b08a28]">New offer</h3>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="offer-code" className="text-sm font-semibold">Offer code</label>
              <input id="offer-code" value={code} maxLength={24} placeholder="e.g. WINTER15" autoComplete="off"
                onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                className={`${input} font-mono uppercase tracking-wider`} />
            </div>

            <div>
              <label htmlFor="offer-percent" className="text-sm font-semibold">Discount (%)</label>
              <input id="offer-percent" type="number" inputMode="numeric" min={1} max={90} step={1} value={percent} placeholder="e.g. 15"
                onChange={(e) => setPercent(e.target.value.replace(/\D/g, "").slice(0, 2))} className={input} />
            </div>

            <div>
              <span className="text-sm font-semibold">Visibility</span>
              <div className="mt-2 grid grid-cols-2 gap-2" role="radiogroup">
                {["public", "private"].map((v) => (
                  <button key={v} type="button" role="radio" aria-checked={visibility === v} onClick={() => setVisibility(v)}
                    className={`rounded-xl border px-4 py-3 text-sm font-semibold capitalize transition ${
                      visibility === v ? "border-[#052a50] bg-[#052a50] text-white" : "border-[#052a50]/15 bg-white hover:bg-[#052a50]/5"
                    }`}>
                    {v}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-xs opacity-60">
                {visibility === "public" ? "Shown to every guest on the bookings page." : "Not shown anywhere — only guests you give the code to can use it."}
              </p>
            </div>

            <div>
              <label htmlFor="offer-days" className="text-sm font-semibold">Valid for (days, from today)</label>
              <div className="mt-2 flex gap-2">
                <select id="offer-days" value={DAY_PRESETS.includes(days) ? days : "custom"}
                  onChange={(e) => e.target.value !== "custom" && setDays(Number(e.target.value))}
                  className="w-1/2 rounded-xl border border-[#052a50]/15 bg-white px-3 py-3 text-sm outline-none focus:border-[#e4b441]">
                  {DAY_PRESETS.map((d) => <option key={d} value={d}>{d} day{d === 1 ? "" : "s"}</option>)}
                  <option value="custom">Custom</option>
                </select>
                <input type="number" min={1} max={365} value={days} aria-label="Number of days"
                  onChange={(e) => setDays(Math.min(365, Math.max(1, Number(e.target.value.replace(/\D/g, "")) || 1)))}
                  className="w-1/2 rounded-xl border border-[#052a50]/15 bg-white px-3 py-3 text-sm outline-none focus:border-[#e4b441]" />
              </div>
              <p className="mt-1.5 text-xs opacity-60">Valid until end of {lastValidDay(days)}</p>
            </div>
          </div>

          <p className="mt-4 rounded-xl bg-[#F7FAEE] p-3 text-xs leading-5 opacity-80">
            The discount is taken off the booking amount before tax and platform fee.
          </p>

          {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
          {notice && <p role="status" className="mt-3 text-sm text-green-700">{notice}</p>}

          <button type="submit" disabled={busy}
            className="mt-4 w-full rounded-xl bg-[#052a50] px-5 py-3.5 text-sm font-semibold text-white transition hover:bg-[#e4b441] hover:text-[#052a50] disabled:opacity-50">
            {busy ? "Publishing..." : "Publish offer"}
          </button>
        </form>

        <section>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.12em] text-[#b08a28]">All offers</h3>
          {!offers && <p className="text-sm opacity-60">Loading…</p>}
          {offers && !offers.length && <p className="text-sm opacity-60">No offers yet.</p>}
          <div className="space-y-2">
            {offers?.map((o) => (
              <div key={o.code} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#052a50]/10 bg-white px-4 py-3">
                <div className="min-w-0">
                  <p className="font-mono text-sm font-semibold tracking-wider">{o.code}</p>
                  <p className="text-xs opacity-65">
                    {o.percent}% off · {o.visibility} · {o.status === "expired" ? "ended" : "until"} {formatDate(o.validUntil)} · used {o.usedCount}×
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize ${STATUS[o.status]}`}>
                    {o.status === "off" ? "Turned off" : o.status}
                  </span>
                  {o.status === "live" && (
                    <button type="button" onClick={() => turnOff(o.code)}
                      className="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50">
                      Turn off
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </AdminModal>
  );
}
