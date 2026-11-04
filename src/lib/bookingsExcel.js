import "server-only";
import writeExcelFile from "write-excel-file/node";
import { invoiceLines, guestSummary } from "@/config/invoiceLines";
import { PRICES } from "@/config/pricing";

/**
 * Builds the admin's bookings export (.xlsx):
 *   Sheet 1 "Bookings"    – one row per booking + totals row
 *   Sheet 2 "Line items"  – every invoice line (rooms / package / meals /
 *                           drivers) for every booking
 * Input: booking details from toDetails() (src/lib/adminData.js).
 *
 * Guest-entered text is always written as a plain text cell, never as a
 * formula, so it can't run anything when the file is opened.
 */

const NAVY = "#052a50";
const CREAM = "#F7FAEE";
const RUPEE = '"₹"#,##0.00';
const DATE = "dd-mmm-yyyy";

const text = (value, extra = {}) => ({ type: String, value: String(value ?? ""), ...extra });
const money = (value, extra = {}) => ({ type: Number, value: Math.round((Number(value) || 0) * 100) / 100, format: RUPEE, ...extra });
const num = (value, extra = {}) => ({ type: Number, value: Number(value) || 0, ...extra });

function day(value) {
  if (!value) return null;
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00.000Z`) : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
const date = (value, extra = {}) => {
  const d = day(value);
  return d ? { type: Date, value: d, format: DATE, ...extra } : text("", extra);
};

const header = (labels) =>
  labels.map((label) =>
    text(label, { fontWeight: "bold", textColor: "#FFFFFF", backgroundColor: NAVY, alignVertical: "center", height: 22, wrap: true })
  );

function paymentStatus(b) {
  if (b.payment?.refunds && Object.keys(b.payment.refunds).length) return "Refund issued";
  return b.paymentStatus || "";
}

const BOOKING_ID_RE = /^SUV-[A-Z0-9-]{6,40}$/;

/**
 * Clickable "Open invoice" cell → the admin invoice page for this booking.
 * Only our own site address + a strictly validated booking ID go into
 * the formula, so no guest-entered text can ever become a formula.
 */
function invoiceLink(baseUrl, bookingId, extra = {}) {
  if (!baseUrl || !BOOKING_ID_RE.test(bookingId || "")) return text("", extra);
  const url = `${baseUrl}/admin/invoice?id=${encodeURIComponent(bookingId)}`;
  return {
    type: "Formula",
    // Stored without the leading "=" (the .xlsx format expects that).
    value: `HYPERLINK("${url}","Open invoice")`,
    textColor: "#1D4ED8",
    textDecoration: { underline: true },
    ...extra,
  };
}

/** @param baseUrl  e.g. "https://book.suvilla.in" (no trailing slash) */
export async function buildBookingsWorkbook(bookings, days, { baseUrl = "" } = {}) {
  const plain = (v) => String(v ?? "");

  /* ---------------- Sheet 1: Bookings ---------------- */
  const bookingColumns = [
    "Booking ID", "Invoice", "Booked on", "Status", "Payment", "Guest name", "Email", "Phone", "City",
    "Rooms / Package", "Check-in", "Check-out", "Nights", "Guests",
    "Stay amount", "Add-ons", "Subtotal", "Promo code", "Discount",
    `Tax (${Math.round(PRICES.taxRate * 100)}%)`, `Platform fee (${Math.round(PRICES.platformFeeRate * 100)}%)`,
    "Total paid", "Razorpay payment ID", "Special request",
  ];
  const bookingRows = [header(bookingColumns)];
  const totals = { stay: 0, addons: 0, subtotal: 0, discount: 0, tax: 0, fee: 0, paid: 0 };

  bookings.forEach((b, i) => {
    const p = b.pricing || {};
    const cancelled = b.status === "cancelled";
    const shade = i % 2 ? { backgroundColor: CREAM } : {};
    const style = cancelled ? { ...shade, textColor: "#B91C1C" } : shade;

    if (!cancelled) {
      totals.stay += Number(p.roomSubtotal) || 0;
      totals.addons += Number(p.addons?.total) || 0;
      totals.subtotal += Number(p.subtotal) || 0;
      totals.discount += Number(p.discount) || 0;
      totals.tax += Number(p.tax) || 0;
      totals.fee += Number(p.platformFee) || 0;
      totals.paid += Number(b.amount) || 0;
    }

    bookingRows.push([
      text(b.bookingId, style),
      invoiceLink(baseUrl, b.bookingId, i % 2 ? { backgroundColor: CREAM } : {}),
      date(b.createdAt, style),
      text(cancelled ? "Cancelled" : "Confirmed", style),
      text(paymentStatus(b), style),
      text(b.guest?.name, style),
      text(b.guest?.email, style),
      text(b.guest?.phone, style),
      text(b.guest?.city, style),
      text(b.packageLine ? `${b.packageLine.name} (${b.rooms.join(", ")})` : b.rooms.join(", "), style),
      date(b.checkIn, style),
      date(b.checkOut, style),
      num(p.nights || b.nights, style),
      text(guestSummary(b, PRICES.includedGuestsPerRoom), style),
      money(p.roomSubtotal, style),
      money(p.addons?.total, style),
      money(p.subtotal, style),
      text(p.promoCode || "", style),
      money(p.discount, style),
      money(p.tax, style),
      money(p.platformFee, style),
      money(b.amount, { ...style, fontWeight: "bold" }),
      text(b.payment?.paymentId, style),
      text(b.guest?.specialRequest, { ...style, wrap: true }),
    ]);
  });

  const bold = { fontWeight: "bold", backgroundColor: "#FBEFCB", borderColor: NAVY };
  bookingRows.push([
    text(`Total — ${bookings.filter((b) => b.status !== "cancelled").length} confirmed bookings (cancelled excluded)`, { ...bold, columnSpan: 14 }),
    ...Array(13).fill(null),
    money(totals.stay, bold),
    money(totals.addons, bold),
    money(totals.subtotal, bold),
    text("", bold),
    money(totals.discount, bold),
    money(totals.tax, bold),
    money(totals.fee, bold),
    money(totals.paid, bold),
    text("", bold),
    text("", bold),
  ]);

  /* ---------------- Sheet 2: Line items ---------------- */
  const lineRows = [header(["Booking ID", "Guest name", "Check-in", "Check-out", "Item", "Details", "Amount", "Status"])];
  bookings.forEach((b, i) => {
    const shade = i % 2 ? { backgroundColor: CREAM } : {};
    const status = b.status === "cancelled" ? "Cancelled" : "Confirmed";
    invoiceLines(b, (v) => `₹${(Number(v) || 0).toLocaleString("en-IN")}`).forEach((line) => {
      lineRows.push([
        text(b.bookingId, shade),
        text(b.guest?.name, shade),
        date(b.checkIn, shade),
        date(b.checkOut, shade),
        text(plain(line.label), shade),
        text(plain(line.sub), { ...shade, wrap: true }),
        money(line.amount, shade),
        text(status, shade),
      ]);
    });
  });

  const widths = (list) => list.map((width) => ({ width }));

  return writeExcelFile(
    [
      {
        sheet: "Bookings",
        data: bookingRows,
        columns: widths([26, 14, 13, 11, 13, 22, 28, 15, 14, 36, 13, 13, 8, 18, 14, 12, 14, 12, 12, 13, 14, 15, 22, 30]),
        stickyRowsCount: 1,
        orientation: "landscape",
      },
      {
        sheet: "Line items",
        data: lineRows,
        columns: widths([26, 22, 13, 13, 34, 46, 14, 11]),
        stickyRowsCount: 1,
        orientation: "landscape",
      },
    ],
    { fontFamily: "Calibri", fontSize: 11 }
  ).toBuffer();
}

export function exportFileName(days) {
  const stamp = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  return `SU-VILLA-bookings-last-${days}-days-${stamp}.xlsx`;
}
