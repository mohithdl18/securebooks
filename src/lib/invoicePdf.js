import "server-only";
import PDFDocument from "pdfkit";
import { BUSINESS } from "@/config/business";
import { PRICES } from "@/config/pricing";

const NAVY = "#052a50";
const GOLD = "#b08a28";
const MUTED = "#5b6b7d";
const MEAL_LABEL = { lunch: "Lunch", dinner: "Dinner", lunchDinner: "Lunch + Dinner" };

// Built-in PDF fonts have no ₹ glyph, so amounts print as "Rs."
const money = (v) =>
  `Rs. ${(Number(v) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const date = (v) => {
  if (!v) return "-";
  const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00+05:30`) : new Date(v);
  return Number.isNaN(d.getTime())
    ? String(v)
    : d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });
};

function drawInvoice(doc, b) {
  const left = 50;
  const right = doc.page.width - 50;
  const width = right - left;
  const p = b.pricing || {};
  const a = p.addons || {};
  const nights = p.nights || b.nights || 1;

  // Header
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(20).text(BUSINESS.name, left, 50, { width: width * 0.6 });
  doc.font("Helvetica").fontSize(9).fillColor(MUTED);
  BUSINESS.addressLines.forEach((l) => doc.text(l, { width: width * 0.6 }));
  doc.text([BUSINESS.phone, BUSINESS.website, BUSINESS.email].filter(Boolean).join("  ·  "), { width: width * 0.6 });
  if (BUSINESS.gstin) doc.text(`GSTIN: ${BUSINESS.gstin}`);

  doc.font("Helvetica-Bold").fontSize(10).fillColor(GOLD).text("INVOICE", left, 50, { width, align: "right" });
  doc.font("Courier").fontSize(9).fillColor(NAVY).text(b.bookingId, { width, align: "right" });
  doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(`Date: ${date(b.createdAt)}`, { width, align: "right" });
  if (b.status === "cancelled") {
    doc.font("Helvetica-Bold").fillColor("#b91c1c").text("CANCELLED", { width, align: "right" });
  }

  let y = 140;
  doc.moveTo(left, y).lineTo(right, y).strokeColor("#dde3ea").stroke();
  y += 14;

  // Billed to / Stay
  doc.font("Helvetica-Bold").fontSize(8).fillColor(MUTED).text("BILLED TO", left, y);
  doc.text("STAY", left, y, { width, align: "right" });
  y += 14;
  doc.font("Helvetica-Bold").fontSize(10).fillColor(NAVY).text(b.guest.name || "-", left, y, { width: width / 2 });
  doc.font("Helvetica").fontSize(9).fillColor(NAVY);
  [b.guest.address, [b.guest.city, b.guest.pinCode].filter(Boolean).join(" - "), b.guest.phone, b.guest.email]
    .filter(Boolean)
    .forEach((l) => doc.text(l, { width: width / 2 }));
  const leftEnd = doc.y;
  doc.text(`Check-in: ${date(b.checkIn)}`, left, y, { width, align: "right" });
  doc.text(`Check-out: ${date(b.checkOut)}`, { width, align: "right" });
  doc.text(`${nights} night${nights === 1 ? "" : "s"}`, { width, align: "right" });
  y = Math.max(leftEnd, doc.y) + 14;
  doc.moveTo(left, y).lineTo(right, y).strokeColor("#dde3ea").stroke();
  y += 10;

  // Line items
  doc.font("Helvetica-Bold").fontSize(8).fillColor(MUTED).text("DESCRIPTION", left, y);
  doc.text("AMOUNT", left, y, { width, align: "right" });
  y += 16;

  const item = (label, sub, amount) => {
    doc.font("Helvetica").fontSize(10).fillColor(NAVY).text(label, left, y, { width: width - 120 });
    doc.text(amount, left, y, { width, align: "right" });
    y = doc.y;
    if (sub) {
      doc.fontSize(8).fillColor(MUTED).text(sub, left, y, { width: width - 120 });
      y = doc.y;
    }
    y += 8;
  };

  b.roomLines.forEach((r) => {
    const sub = [
      `${r.nights} night${r.nights === 1 ? "" : "s"}${r.nightlyRate ? ` x ${money(r.nightlyRate)}` : ""}`,
      r.extraAdults ? `+${r.extraAdults} extra adult` : "",
      r.children ? `+${r.children} child` : "",
    ].filter(Boolean).join("  ·  ");
    item(r.roomName, sub, money(r.amount));
  });
  if (a.mealSubtotal > 0) item(`Meals - ${MEAL_LABEL[a.mealPlan] || ""}`, `${a.mealGuests} guests x ${nights} nights`, money(a.mealSubtotal));
  if (a.driverAccommodation > 0) item("Driver accommodation", `${a.drivers} x ${nights} nights`, money(a.driverAccommodation));
  if (a.driverMeals > 0) item(`Driver meals - ${MEAL_LABEL[a.driverMealPlan] || ""}`, `${a.drivers} x ${nights} nights`, money(a.driverMeals));

  // Totals
  y += 6;
  const tx = left + width - 230;
  const total = (label, value, bold = false) => {
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 11 : 10).fillColor(NAVY);
    doc.text(label, tx, y, { width: 130 });
    doc.text(value, tx, y, { width: 230, align: "right" });
    y = doc.y + 6;
  };
  if (p.subtotal != null) {
    total("Subtotal", money(p.subtotal));
    if (p.discount > 0) total(`Discount (${p.promoCode}, ${p.discountPercent}%)`, `- ${money(p.discount)}`);
    total(`Tax (${Math.round(PRICES.taxRate * 100)}%)`, money(p.tax));
    total(`Platform fee (${Math.round(PRICES.platformFeeRate * 100)}%)`, money(p.platformFee));
    doc.moveTo(tx, y).lineTo(right, y).strokeColor(NAVY).stroke();
    y += 6;
  }
  total("Total paid", money(b.amount), true);

  // Footer
  y += 20;
  doc.moveTo(left, y).lineTo(right, y).strokeColor("#dde3ea").stroke();
  doc.font("Helvetica").fontSize(8).fillColor(MUTED)
    .text(`Paid via Razorpay  ·  Payment ID ${b.payment.paymentId || "-"}`, left, y + 8, { width })
    .text(`Breakfast complimentary. Thank you for staying with ${BUSINESS.name}.`, { width });
}

export function buildInvoicesPdf(bookings, days) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50, info: { Title: `${BUSINESS.name} invoices — last ${days} days` } });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    if (!bookings.length) {
      doc.font("Helvetica-Bold").fontSize(16).fillColor(NAVY).text(BUSINESS.name);
      doc.moveDown().font("Helvetica").fontSize(11).text(`No bookings in the last ${days} day${days === 1 ? "" : "s"}.`);
    }
    bookings.forEach((b, i) => {
      if (i > 0) doc.addPage();
      drawInvoice(doc, b);
    });
    doc.end();
  });
}


/** One booking → one-page invoice PDF (used as the email attachment). */
export function buildSingleInvoicePdf(booking) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50, info: { Title: `Invoice ${booking.bookingId}` } });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    drawInvoice(doc, booking);
    doc.end();
  });
}
