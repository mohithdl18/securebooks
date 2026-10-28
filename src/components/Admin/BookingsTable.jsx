"use client";

import StatusBadge from "./StatusBadge";
import InvoiceExport from "./InvoiceExport";
import { formatDate } from "@/lib/adminClient";

export default function BookingsTable({ data, loading, error, onPage, onOpen, onCancel }) {
  const rows = data?.bookings || [];
  const page = data?.page || 1;
  const totalPages = data?.totalPages || 1;

  return (
    <section className="rounded-3xl border border-[#052a50]/10 bg-white">
      <div className="flex flex-col gap-1 border-b border-[#052a50]/10 p-4 sm:flex-row sm:items-end sm:justify-between sm:p-5">
        <div>
          <h2 className="text-xl font-semibold">All bookings</h2>
          <p className="text-sm opacity-65">{data ? `${data.total} total · newest first` : "Loading…"}</p>
        </div>
        <InvoiceExport />
      </div>

      {error && <p className="m-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <div className="overflow-x-auto">
        <table className={`w-full min-w-[860px] text-left text-sm ${loading ? "opacity-60" : ""}`}>
          <thead className="bg-[#F7FAEE] text-xs uppercase tracking-wide text-[#052a50]/60">
            <tr>
              <th className="px-4 py-3 font-semibold">Booking ID</th>
              <th className="px-4 py-3 font-semibold">Name</th>
              <th className="px-4 py-3 font-semibold">Rooms</th>
              <th className="px-4 py-3 font-semibold">Payment</th>
              <th className="px-4 py-3 font-semibold">Check-in</th>
              <th className="px-4 py-3 font-semibold">Check-out</th>
              <th className="px-4 py-3 text-right font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#052a50]/10">
            {rows.map((b) => (
              <tr
                key={b.bookingId}
                onClick={() => onOpen(b.bookingId)}
                className="cursor-pointer transition hover:bg-[#e4b441]/10"
              >
                <td className="px-4 py-3 font-mono text-xs">{b.bookingId}</td>
                <td className="px-4 py-3 font-medium">{b.name || "—"}</td>
                <td className="px-4 py-3">{b.rooms.join(", ") || "—"}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    <StatusBadge value={b.paymentStatus} />
                    {b.status === "cancelled" && <StatusBadge value="cancelled" />}
                  </div>
                </td>
                <td className="px-4 py-3 whitespace-nowrap">{formatDate(b.checkIn)}</td>
                <td className="px-4 py-3 whitespace-nowrap">{formatDate(b.checkOut)}</td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                    <a
                      href={`/admin/invoice?id=${encodeURIComponent(b.bookingId)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-lg border border-[#052a50]/20 px-3 py-1.5 text-xs font-semibold hover:bg-[#052a50]/5"
                    >
                      Invoice
                    </a>
                    <button
                      type="button"
                      disabled={b.status !== "confirmed"}
                      onClick={() => onCancel(b)}
                      className="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {b.status === "cancelled" ? "Cancelled" : "Cancel"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!rows.length && !loading && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-sm opacity-60">No bookings yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-[#052a50]/10 p-4">
        <button type="button" disabled={page <= 1 || loading} onClick={() => onPage(page - 1)}
          className="rounded-xl border border-[#052a50]/20 px-4 py-2 text-sm font-semibold hover:bg-[#052a50]/5 disabled:opacity-40">
          ← Previous
        </button>
        <span className="text-sm opacity-70">Page {page} of {totalPages}</span>
        <button type="button" disabled={page >= totalPages || loading} onClick={() => onPage(page + 1)}
          className="rounded-xl bg-[#052a50] px-4 py-2 text-sm font-semibold text-white hover:bg-[#e4b441] hover:text-[#052a50] disabled:opacity-40">
          Next →
        </button>
      </div>
    </section>
  );
}
