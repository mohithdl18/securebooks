"use client";

import { useState } from "react";

const PRESETS = [1, 7, 15, 30, 60, 90, 180, 365];

/** Downloads one PDF with every invoice from the last N days. */
export default function InvoiceExport() {
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function download() {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/admin/invoices?days=${days}`, { cache: "no-store" });
      if (response.status === 401) {
        window.location.replace("/admin/login");
        return;
      }
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || "Download failed.");
      }
      const count = response.headers.get("X-Invoice-Count");
      const name =
        /filename="([^"]+)"/.exec(response.headers.get("Content-Disposition") || "")?.[1] ||
        `invoices-last-${days}-days.pdf`;
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      setMessage(count === "0" ? "No bookings in that period." : `Downloaded ${count} invoice${count === "1" ? "" : "s"}.`);
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <div className="flex items-center gap-2">
        <label htmlFor="invoice-days" className="text-xs font-semibold opacity-70">Invoices from last</label>
        <select id="invoice-days" value={days} onChange={(e) => setDays(Number(e.target.value))}
          className="rounded-xl border border-[#052a50]/15 bg-white px-3 py-2 text-sm outline-none focus:border-[#e4b441]">
          {PRESETS.map((d) => <option key={d} value={d}>{d} day{d === 1 ? "" : "s"}</option>)}
        </select>
        <button type="button" onClick={download} disabled={busy}
          className="rounded-xl bg-[#052a50] px-4 py-2 text-sm font-semibold text-white hover:bg-[#e4b441] hover:text-[#052a50] disabled:opacity-50">
          {busy ? "Preparing…" : "Download PDF"}
        </button>
      </div>
      {message && <p role="status" className="text-xs opacity-70">{message}</p>}
    </div>
  );
}
