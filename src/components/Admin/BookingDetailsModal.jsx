"use client";

import { useEffect, useState } from "react";
import AdminModal from "./AdminModal";
import StatusBadge from "./StatusBadge";
import { adminFetch, formatMoney, formatDate, formatDateTime } from "@/lib/adminClient";

const MEAL_LABEL = { lunch: "Lunch", dinner: "Dinner", lunchDinner: "Lunch + Dinner" };

function Row({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 text-sm">
      <span className="text-[#052a50]/60">{label}</span>
      <span className="text-right font-medium break-all">{value || "—"}</span>
    </div>
  );
}

function Card({ title, children }) {
  return (
    <section className="rounded-2xl border border-[#052a50]/10 bg-white p-4 sm:p-5">
      <h3 className="mb-2 text-sm font-semibold uppercase tracking-[0.12em] text-[#b08a28]">{title}</h3>
      {children}
    </section>
  );
}

export default function BookingDetailsModal({ bookingId, onClose, onRequestCancel }) {
  const [result, setResult] = useState({ id: null, booking: null, error: "" });

  useEffect(() => {
    if (!bookingId) return;
    let alive = true;
    adminFetch(`/api/admin/bookings/${encodeURIComponent(bookingId)}`)
      .then((d) => alive && setResult({ id: bookingId, booking: d.booking, error: "" }))
      .catch((e) => alive && setResult({ id: bookingId, booking: null, error: e.message }));
    return () => {
      alive = false;
    };
  }, [bookingId]);

  // Ignore a result that belongs to a previously opened booking.
  const current = result.id === bookingId ? result : { booking: null, error: "" };
  const { booking, error } = current;

  const p = booking?.pricing;
  const a = p?.addons;

  return (
    <AdminModal
      isOpen={Boolean(bookingId)}
      onClose={onClose}
      title={bookingId ? `Booking ${bookingId}` : "Booking"}
      footer={
        booking && (
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
            <a
              href={`/admin/invoice?id=${encodeURIComponent(booking.bookingId)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-xl border border-[#052a50]/20 bg-white px-5 py-3 text-center text-sm font-semibold text-[#052a50] hover:bg-[#052a50]/5"
            >
              Invoice
            </a>
            {booking.status === "confirmed" && (
              <button
                type="button"
                onClick={() => onRequestCancel?.(booking)}
                className="rounded-xl bg-red-700 px-5 py-3 text-sm font-semibold text-white hover:bg-red-800"
              >
                Cancel booking
              </button>
            )}
          </div>
        )
      }
    >
      {error && <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>}
      {!booking && !error && <p className="py-10 text-center text-sm opacity-60">Loading booking…</p>}

      {booking && (
        <div className="space-y-4 text-[#052a50]">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge value={booking.status} />
            <StatusBadge value={booking.paymentStatus} />
            <span className="text-xs opacity-60">Booked {formatDateTime(booking.createdAt)}</span>
          </div>

          {booking.status === "cancelled" && (
            <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              Cancelled {formatDateTime(booking.cancelledAt)}
              {booking.cancelReason ? ` — ${booking.cancelReason}` : ""}
            </p>
          )}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Card title="Guest">
              <Row label="Name" value={booking.guest.name} />
              <Row label="Email" value={booking.guest.email} />
              <Row label="Phone" value={booking.guest.phone} />
              <Row label="Address" value={booking.guest.address} />
              <Row label="City" value={booking.guest.city} />
              <Row label="PIN code" value={booking.guest.pinCode} />
              <Row label="Aadhaar" value={booking.guest.aadhaar} />
            </Card>

            <Card title="Stay">
              <Row label="Check-in" value={formatDate(booking.checkIn)} />
              <Row label="Check-out" value={formatDate(booking.checkOut)} />
              <Row label="Nights" value={String(booking.nights || "—")} />
              <Row label="Rooms" value={booking.rooms.join(", ")} />
              <Row label="Driver stay" value={booking.driver?.accommodation === "yes" ? `Yes (${a?.drivers || 0})` : "No"} />
              <Row label="Guest meals" value={a?.mealPlan ? `${MEAL_LABEL[a.mealPlan]} × ${a.mealGuests}` : "None"} />
              <Row label="Driver meals" value={a?.driverMealPlan ? MEAL_LABEL[a.driverMealPlan] : "None"} />
            </Card>
          </div>

          {booking.guest.specialRequest && (
            <Card title="Special request">
              <p className="text-sm leading-6">{booking.guest.specialRequest}</p>
            </Card>
          )}

          <Card title="Rooms">
            <div className="divide-y divide-[#052a50]/10">
              {booking.roomLines.map((r) => (
                <div key={r.roomId} className="flex items-start justify-between gap-4 py-2 text-sm">
                  <div>
                    <p className="font-medium">{r.roomName}</p>
                    <p className="text-xs opacity-60">
                      {r.nights} night{r.nights === 1 ? "" : "s"}
                      {r.nightlyRate ? ` × ${formatMoney(r.nightlyRate)}` : ""}
                      {r.extraAdults ? ` · +${r.extraAdults} adult` : ""}
                      {r.children ? ` · +${r.children} child` : ""}
                    </p>
                  </div>
                  <span className="font-semibold">{formatMoney(r.amount)}</span>
                </div>
              ))}
            </div>
          </Card>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Card title="Payment summary">
              {p ? (
                <>
                  <Row label="Rooms" value={formatMoney(p.roomSubtotal)} />
                  <Row label="Add-ons" value={formatMoney(a?.total)} />
                  {p.discount > 0 && <Row label={`Discount (${p.promoCode}, ${p.discountPercent}%)`} value={`− ${formatMoney(p.discount)}`} />}
                  <Row label="Tax" value={formatMoney(p.tax)} />
                  <Row label="Platform fee" value={formatMoney(p.platformFee)} />
                  <div className="mt-2 flex justify-between border-t border-[#052a50]/10 pt-2 text-base font-bold">
                    <span>Total paid</span>
                    <span>{formatMoney(booking.amount)}</span>
                  </div>
                </>
              ) : (
                <Row label="Total paid" value={formatMoney(booking.amount)} />
              )}
            </Card>

            <Card title="Payment">
              <Row label="Gateway" value="Razorpay" />
              <Row label="Payment ID" value={booking.payment.paymentId} />
              <Row label="Order ID" value={booking.payment.orderId} />
              <Row label="Method" value={booking.payment.method} />
              <Row label="Paid at" value={formatDateTime(booking.payment.capturedAt)} />
              {booking.payment.refunds &&
                Object.entries(booking.payment.refunds).map(([pid, r]) => (
                  <Row key={pid} label="Refund" value={`${r.status}${r.refund_id ? ` (${r.refund_id})` : ""}`} />
                ))}
            </Card>
          </div>
        </div>
      )}
    </AdminModal>
  );
}
