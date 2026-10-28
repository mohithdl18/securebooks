"use client";

import { useState } from "react";
import AdminModal from "./AdminModal";
import { adminFetch } from "@/lib/adminClient";

export default function PinDialog({ booking, onClose, onCancelled }) {
  const [pin, setPin] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    if (!/^\d{4,8}$/.test(pin)) {
      setError("Enter your cancellation PIN.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await adminFetch(`/api/admin/bookings/${encodeURIComponent(booking.bookingId)}/cancel`, {
        method: "POST",
        body: { pin, reason },
      });
      onCancelled?.(booking.bookingId);
    } catch (e) {
      setError(e.message);
      setPin("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminModal isOpen={Boolean(booking)} onClose={busy ? undefined : onClose} title="Cancel booking" size="sm">
      <form onSubmit={submit} className="space-y-4 text-[#052a50]">
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-800">
          You are cancelling <strong>{booking?.bookingId}</strong> for <strong>{booking?.name}</strong>.
          The rooms will be released for those dates. This can’t be undone.
        </div>
        <p className="text-xs leading-5 opacity-65">
          The guest is <strong>not refunded automatically</strong>. Issue any refund from the Razorpay dashboard as per your cancellation policy.
        </p>

        <div>
          <label htmlFor="cancel-reason" className="text-sm font-semibold">Reason (optional)</label>
          <input
            id="cancel-reason"
            value={reason}
            maxLength={300}
            onChange={(e) => setReason(e.target.value)}
            className="mt-2 w-full rounded-xl border border-[#052a50]/15 bg-white px-4 py-3 text-sm outline-none focus:border-[#e4b441]"
          />
        </div>

        <div>
          <label htmlFor="cancel-pin" className="text-sm font-semibold">Cancellation PIN</label>
          <input
            id="cancel-pin"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            autoFocus
            maxLength={8}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            className="mt-2 w-full rounded-xl border border-[#052a50]/15 bg-white px-4 py-3 text-center text-lg tracking-[0.5em] outline-none focus:border-[#e4b441]"
          />
        </div>

        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-3">
          <button type="button" onClick={onClose} disabled={busy}
            className="flex-1 rounded-xl border border-[#052a50]/20 bg-white px-4 py-3 text-sm font-semibold hover:bg-[#052a50]/5 disabled:opacity-50">
            Keep booking
          </button>
          <button type="submit" disabled={busy}
            className="flex-1 rounded-xl bg-red-700 px-4 py-3 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50">
            {busy ? "Cancelling..." : "Cancel booking"}
          </button>
        </div>
      </form>
    </AdminModal>
  );
}
