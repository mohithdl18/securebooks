"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { BUSINESS } from "@/config/business";
import { PRICES } from "@/config/pricing";
import { adminFetch, formatMoney, formatDate, formatDateTime } from "@/lib/adminClient";

const MEAL_LABEL = { lunch: "Lunch", dinner: "Dinner", lunchDinner: "Lunch + Dinner" };

function Line({ label, sub, amount, bold }) {
  return (
    <tr className={bold ? "font-bold" : ""}>
      <td className="py-2 pr-4 align-top">
        <p>{label}</p>
        {sub && <p className="text-xs opacity-60">{sub}</p>}
      </td>
      <td className="py-2 text-right align-top whitespace-nowrap">{amount}</td>
    </tr>
  );
}

function Invoice() {
  const id = useSearchParams().get("id") || "";
  const [b, setB] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!id) return;
    adminFetch(`/api/admin/bookings/${encodeURIComponent(id)}`)
      .then((d) => setB(d.booking))
      .catch((e) => setError(e.message));
  }, [id]);

  if (!id) return <p className="p-10 text-center text-sm">No booking selected.</p>;
  if (error) return <p className="p-10 text-center text-sm text-red-700">{error}</p>;
  if (!b) return <p className="p-10 text-center text-sm opacity-60">Loading invoice…</p>;

  const p = b.pricing || {};
  const a = p.addons || {};
  const nights = p.nights || b.nights || 1;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex justify-end gap-3 print:hidden">
        <button type="button" onClick={() => window.print()}
          className="rounded-xl bg-[#052a50] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#e4b441] hover:text-[#052a50]">
          Print / Save as PDF
        </button>
      </div>

      <article className="rounded-3xl border border-[#052a50]/10 bg-white p-6 text-[#052a50] sm:p-10 print:rounded-none print:border-0 print:p-0">
        <header className="flex flex-col justify-between gap-6 border-b border-[#052a50]/10 pb-6 sm:flex-row">
          <div>
            <h1 className="font-display text-4xl">{BUSINESS.name}</h1>
            <div className="mt-2 text-sm leading-6 opacity-75">
              {BUSINESS.addressLines.map((l) => <p key={l}>{l}</p>)}
              <p>{[BUSINESS.phone, BUSINESS.website, BUSINESS.email].filter(Boolean).join(" · ")}</p>
              {BUSINESS.gstin && <p>GSTIN: {BUSINESS.gstin}</p>}
            </div>
          </div>
          <div className="text-left sm:text-right">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#b08a28]">Invoice</p>
            <p className="mt-1 font-mono text-sm">{b.bookingId}</p>
            <p className="mt-2 text-sm opacity-75">Date: {formatDate(b.createdAt)}</p>
            {b.status === "cancelled" && (
              <p className="mt-2 inline-block rounded-full border border-red-300 px-3 py-0.5 text-xs font-bold text-red-700">CANCELLED</p>
            )}
          </div>
        </header>

        <section className="grid grid-cols-1 gap-6 border-b border-[#052a50]/10 py-6 text-sm sm:grid-cols-2">
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-[0.15em] opacity-55">Billed to</p>
            <p className="font-semibold">{b.guest.name}</p>
            <p className="opacity-75">{b.guest.address}</p>
            <p className="opacity-75">{[b.guest.city, b.guest.pinCode].filter(Boolean).join(" – ")}</p>
            <p className="opacity-75">{b.guest.phone}</p>
            <p className="opacity-75">{b.guest.email}</p>
          </div>
          <div className="sm:text-right">
            <p className="mb-1 text-xs font-semibold uppercase tracking-[0.15em] opacity-55">Stay</p>
            <p>Check-in: <strong>{formatDate(b.checkIn)}</strong></p>
            <p>Check-out: <strong>{formatDate(b.checkOut)}</strong></p>
            <p>{nights} night{nights === 1 ? "" : "s"}</p>
          </div>
        </section>

        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="border-b border-[#052a50]/10 text-xs uppercase tracking-wide opacity-60">
              <th className="py-2 text-left font-semibold">Description</th>
              <th className="py-2 text-right font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#052a50]/5">
            {b.roomLines.map((r) => (
              <Line
                key={r.roomId}
                label={r.roomName}
                sub={[
                  `${r.nights} night${r.nights === 1 ? "" : "s"}${r.nightlyRate ? ` × ${formatMoney(r.nightlyRate)}` : ""}`,
                  r.extraAdults ? `+${r.extraAdults} extra adult` : "",
                  r.children ? `+${r.children} child` : "",
                ].filter(Boolean).join(" · ")}
                amount={formatMoney(r.amount)}
              />
            ))}
            {a.mealSubtotal > 0 && (
              <Line label={`Meals — ${MEAL_LABEL[a.mealPlan]}`} sub={`${a.mealGuests} guests × ${nights} nights`} amount={formatMoney(a.mealSubtotal)} />
            )}
            {a.driverAccommodation > 0 && (
              <Line label="Driver accommodation" sub={`${a.drivers} × ${nights} nights`} amount={formatMoney(a.driverAccommodation)} />
            )}
            {a.driverMeals > 0 && (
              <Line label={`Driver meals — ${MEAL_LABEL[a.driverMealPlan]}`} sub={`${a.drivers} × ${nights} nights`} amount={formatMoney(a.driverMeals)} />
            )}
          </tbody>
        </table>

        <table className="ml-auto mt-4 w-full max-w-xs text-sm">
          <tbody>
            <Line label="Subtotal" amount={formatMoney(p.subtotal)} />
            {p.discount > 0 && <Line label={`Discount (${p.promoCode})`} amount={`− ${formatMoney(p.discount)}`} />}
            <Line label={`Tax (${Math.round(PRICES.taxRate * 100)}%)`} amount={formatMoney(p.tax)} />
            <Line label={`Platform fee (${Math.round(PRICES.platformFeeRate * 100)}%)`} amount={formatMoney(p.platformFee)} />
            <tr><td colSpan={2} className="border-t border-[#052a50]/15" /></tr>
            <Line label="Total paid" amount={formatMoney(b.amount)} bold />
          </tbody>
        </table>

        <footer className="mt-8 border-t border-[#052a50]/10 pt-4 text-xs leading-5 opacity-65">
          <p>Paid via Razorpay · Payment ID {b.payment.paymentId || "—"} · {formatDateTime(b.payment.capturedAt)}</p>
          <p>Breakfast complimentary. Thank you for staying with {BUSINESS.name}.</p>
        </footer>
      </article>
    </div>
  );
}

export default function InvoicePage() {
  return (
    <main className="min-h-screen bg-[#F7FAEE] px-4 py-8 print:bg-white print:p-0">
      <Suspense fallback={<p className="p-10 text-center text-sm opacity-60">Loading invoice…</p>}>
        <Invoice />
      </Suspense>
    </main>
  );
}
