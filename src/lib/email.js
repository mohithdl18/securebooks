import "server-only";
import { Resend } from "resend";
import { getDb } from "@/lib/mongodb";
import { getBookingDetails } from "@/lib/adminData";
import { buildSingleInvoicePdf } from "@/lib/invoicePdf";
import { BUSINESS } from "@/config/business";
import { PRICES } from "@/config/pricing";

/**
 * Booking confirmation email via Resend.
 *
 * Env (.env.local):
 *   RESEND_API_KEY   re_...
 *   EMAIL_FROM       "SU VILLA <bookings@mail.suvilla.in>"  (verified domain)
 *   EMAIL_REPLY_TO   optional — where guest replies go
 *   EMAIL_BCC        optional — copy every confirmation to the resort
 *
 * Sent at most once per booking: the booking document is "claimed"
 * atomically before sending, and Resend's idempotency key blocks
 * duplicates on retries.
 */

const STALE_CLAIM_MS = 10 * 60 * 1000;
const MEAL_LABEL = { lunch: "Lunch", dinner: "Dinner", lunchDinner: "Lunch + Dinner" };

let warned = false;
function config() {
  const apiKey = (process.env.RESEND_API_KEY || "").trim();
  const from = (process.env.EMAIL_FROM || "").trim();
  if (!apiKey || !from) {
    if (!warned) {
      warned = true;
      console.warn("[email] Confirmation emails are off — set RESEND_API_KEY and EMAIL_FROM in .env.local.");
    }
    return null;
  }
  const list = (v) => (v || "").split(",").map((x) => x.trim()).filter(Boolean);
  return {
    apiKey,
    from,
    replyTo: list(process.env.EMAIL_REPLY_TO),
    bcc: list(process.env.EMAIL_BCC),
  };
}

export function emailConfigured() {
  return Boolean(config());
}

/* ------------------------------------------------------------------ */
/* Template                                                            */
/* ------------------------------------------------------------------ */

// Every guest-entered value goes through this before entering HTML.
function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const money = (v) =>
  `₹${(Number(v) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function longDate(v) {
  if (!v) return "—";
  const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00+05:30`) : new Date(v);
  return d.toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function buildConfirmationEmail(b) {
  const p = b.pricing || {};
  const a = p.addons || {};
  const nights = p.nights || b.nights || 1;
  const firstName = (b.guest.name || "").trim().split(/\s+/)[0] || "there";
  const adults = b.roomLines.reduce((t, r) => t + PRICES.includedGuestsPerRoom + (r.extraAdults || 0), 0);
  const children = b.roomLines.reduce((t, r) => t + (r.children || 0), 0);
  const guests = `${adults} adult${adults === 1 ? "" : "s"}${children ? `, ${children} child${children === 1 ? "" : "ren"}` : ""}`;

  const lines = [
    ...b.roomLines.map((r) => ({
      label: r.roomName,
      sub: [
        `${r.nights} night${r.nights === 1 ? "" : "s"}${r.nightlyRate ? ` × ${money(r.nightlyRate)}` : ""}`,
        r.extraAdults ? `+${r.extraAdults} extra adult` : "",
        r.children ? `+${r.children} child` : "",
      ].filter(Boolean).join(" · "),
      amount: r.amount,
    })),
    a.mealSubtotal > 0 && { label: `Meals — ${MEAL_LABEL[a.mealPlan] || ""}`, sub: `${a.mealGuests} guests × ${nights} nights`, amount: a.mealSubtotal },
    a.driverAccommodation > 0 && { label: "Driver accommodation", sub: `${a.drivers} × ${nights} nights`, amount: a.driverAccommodation },
    a.driverMeals > 0 && { label: `Driver meals — ${MEAL_LABEL[a.driverMealPlan] || ""}`, sub: `${a.drivers} × ${nights} nights`, amount: a.driverMeals },
  ].filter(Boolean);

  const totals = [
    ["Subtotal", money(p.subtotal)],
    p.discount > 0 && [`Discount (${esc(p.promoCode)}, ${p.discountPercent}%)`, `− ${money(p.discount)}`],
    [`Tax (${Math.round(PRICES.taxRate * 100)}%)`, money(p.tax)],
    [`Platform fee (${Math.round(PRICES.platformFeeRate * 100)}%)`, money(p.platformFee)],
  ].filter(Boolean);

  const NAVY = "#052a50", GOLD = "#e4b441", CREAM = "#F7FAEE", MUTED = "#5b6b7d", LINE = "#e3e8ee";
  const font = "font-family:Arial,Helvetica,sans-serif;";
  const contact = [BUSINESS.phone, BUSINESS.website].filter(Boolean).map(esc).join(" &nbsp;·&nbsp; ");

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only"><title>Booking confirmed — ${esc(b.bookingId)}</title></head>
<body style="margin:0;padding:0;background:${CREAM};">
<div style="display:none;max-height:0;overflow:hidden;">Your stay at ${esc(BUSINESS.name)} is confirmed — ${esc(longDate(b.checkIn))} to ${esc(longDate(b.checkOut))}.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CREAM};">
<tr><td align="center" style="padding:28px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid ${LINE};">

  <tr><td style="background:${NAVY};padding:28px 32px;${font}">
    <p style="margin:0;color:${GOLD};font-size:11px;letter-spacing:3px;font-weight:bold;">BOOKING CONFIRMED</p>
    <h1 style="margin:8px 0 0;color:#ffffff;font-size:26px;font-weight:bold;">${esc(BUSINESS.name)}</h1>
  </td></tr>

  <tr><td style="padding:30px 32px 6px;${font}color:${NAVY};">
    <p style="margin:0 0 14px;font-size:20px;font-weight:bold;">Thank you, ${esc(firstName)}!</p>
    <p style="margin:0 0 12px;font-size:15px;line-height:24px;">
      We're delighted you've chosen to stay with us. Your booking is confirmed and your payment has been received.
      We can't wait to welcome you to ${esc(BUSINESS.name)} — slow mornings, fresh air and the sound of the creek are waiting for you.
    </p>
    <p style="margin:0;font-size:15px;line-height:24px;">Your booking details and invoice are below. A PDF copy of the invoice is attached for your records.</p>
  </td></tr>

  <tr><td style="padding:22px 32px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CREAM};border-radius:14px;${font}color:${NAVY};font-size:14px;">
      <tr><td style="padding:18px 20px 6px;" colspan="2">
        <span style="font-size:11px;letter-spacing:2px;color:${MUTED};font-weight:bold;">BOOKING ID</span><br>
        <span style="font-family:'Courier New',monospace;font-size:16px;font-weight:bold;">${esc(b.bookingId)}</span>
      </td></tr>
      <tr>
        <td style="padding:10px 20px;width:50%;vertical-align:top;"><span style="color:${MUTED};font-size:12px;">Check-in</span><br><strong>${esc(longDate(b.checkIn))}</strong></td>
        <td style="padding:10px 20px;width:50%;vertical-align:top;"><span style="color:${MUTED};font-size:12px;">Check-out</span><br><strong>${esc(longDate(b.checkOut))}</strong></td>
      </tr>
      <tr>
        <td style="padding:10px 20px 18px;vertical-align:top;"><span style="color:${MUTED};font-size:12px;">Stay</span><br><strong>${nights} night${nights === 1 ? "" : "s"} · ${esc(guests)}</strong></td>
        <td style="padding:10px 20px 18px;vertical-align:top;"><span style="color:${MUTED};font-size:12px;">Room${b.rooms.length === 1 ? "" : "s"}</span><br><strong>${b.rooms.map(esc).join(", ")}</strong></td>
      </tr>
    </table>
  </td></tr>

  <tr><td style="padding:28px 32px 0;${font}color:${NAVY};">
    <p style="margin:0 0 4px;font-size:11px;letter-spacing:3px;color:#b08a28;font-weight:bold;">INVOICE</p>
    <p style="margin:0 0 14px;font-size:12px;color:${MUTED};">
      Billed to ${esc(b.guest.name)}${b.guest.city ? `, ${esc(b.guest.city)}` : ""} · Issued ${esc(longDate(b.createdAt))}
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;${font}color:${NAVY};">
      ${lines.map((l) => `<tr>
        <td style="padding:10px 0;border-bottom:1px solid ${LINE};vertical-align:top;">${esc(l.label)}${l.sub ? `<br><span style="font-size:12px;color:${MUTED};">${esc(l.sub)}</span>` : ""}</td>
        <td style="padding:10px 0;border-bottom:1px solid ${LINE};text-align:right;vertical-align:top;white-space:nowrap;">${money(l.amount)}</td>
      </tr>`).join("")}
      ${totals.map(([k, v]) => `<tr>
        <td style="padding:7px 0 0;color:${MUTED};">${k}</td>
        <td style="padding:7px 0 0;text-align:right;white-space:nowrap;">${v}</td>
      </tr>`).join("")}
      <tr><td colspan="2" style="height:12px;line-height:12px;font-size:0;">&nbsp;</td></tr>
      <tr>
        <td style="padding:14px 0 0;border-top:2px solid ${NAVY};font-size:16px;font-weight:bold;">Total paid</td>
        <td style="padding:14px 0 0;border-top:2px solid ${NAVY};font-size:16px;font-weight:bold;text-align:right;white-space:nowrap;">${money(b.amount)}</td>
      </tr>
    </table>
    <p style="margin:12px 0 0;font-size:12px;color:${MUTED};">
      Paid via Razorpay${b.payment.paymentId ? ` · Payment ID ${esc(b.payment.paymentId)}` : ""}${BUSINESS.gstin ? ` · GSTIN ${esc(BUSINESS.gstin)}` : ""}
    </p>
  </td></tr>

  <tr><td style="padding:26px 32px 0;${font}color:${NAVY};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${LINE};border-radius:14px;font-size:14px;line-height:22px;">
      <tr><td style="padding:16px 20px;">
        <strong>Before you arrive</strong><br>
        • Breakfast is complimentary every morning.<br>
        • Please carry an original government photo ID for every adult guest.<br>
        • Need to change something or have a special request? Just reply to this email${BUSINESS.phone ? ` or call us on ${esc(BUSINESS.phone)}` : ""}.
      </td></tr>
    </table>
  </td></tr>

  <tr><td style="padding:28px 32px 30px;${font}color:${NAVY};font-size:15px;line-height:24px;">
    Warm regards,<br><strong>Team ${esc(BUSINESS.name)}</strong>
  </td></tr>

  <tr><td style="background:${CREAM};padding:18px 32px;${font}font-size:12px;line-height:18px;color:${MUTED};border-top:1px solid ${LINE};">
    ${esc(BUSINESS.name)} · ${BUSINESS.addressLines.map(esc).join(", ")}<br>${contact}
  </td></tr>

</table>
</td></tr></table>
</body></html>`;

  const text = [
    `Thank you, ${firstName}!`,
    ``,
    `Your booking at ${BUSINESS.name} is confirmed and your payment has been received.`,
    ``,
    `Booking ID: ${b.bookingId}`,
    `Check-in:  ${longDate(b.checkIn)}`,
    `Check-out: ${longDate(b.checkOut)}`,
    `Stay: ${nights} night(s), ${guests}`,
    `Rooms: ${b.rooms.join(", ")}`,
    ``,
    `INVOICE`,
    ...lines.map((l) => `${l.label}${l.sub ? ` (${l.sub})` : ""}: ${money(l.amount)}`),
    ...totals.map(([k, v]) => `${k.replace(/&[a-z#0-9]+;/g, "")}: ${v}`),
    `Total paid: ${money(b.amount)}`,
    b.payment.paymentId ? `Razorpay payment ID: ${b.payment.paymentId}` : "",
    ``,
    `Breakfast is complimentary. Please carry an original government photo ID for every adult guest.`,
    `Questions? Reply to this email${BUSINESS.phone ? ` or call ${BUSINESS.phone}` : ""}.`,
    ``,
    `Warm regards,`,
    `Team ${BUSINESS.name}`,
  ].filter((l) => l !== null).join("\n");

  return {
    subject: `Booking confirmed — ${BUSINESS.name} · ${b.bookingId}`,
    html,
    text,
  };
}

/* ------------------------------------------------------------------ */
/* Sending                                                             */
/* ------------------------------------------------------------------ */

/**
 * @param force  admin "send again" — bypasses the already-sent check
 * Returns { status: "sent" | "skipped" | "failed" | "not_configured", id?, error? }
 */
export async function sendBookingConfirmation(bookingId, { force = false } = {}) {
  const cfg = config();
  if (!cfg) return { status: "not_configured" };

  const db = await getDb();
  const bookings = db.collection("bookings_data");
  const now = new Date();

  // Claim the send so verify + webhook can't both email the guest.
  const claimFilter = force
    ? { booking_id: bookingId, status: "confirmed", "email.status": { $ne: "sending" } }
    : {
        booking_id: bookingId,
        status: "confirmed",
        $or: [
          { email: { $exists: false } },
          { "email.status": "failed" },
          { "email.status": "sending", "email.claimed_at": { $lt: new Date(now.getTime() - STALE_CLAIM_MS) } },
        ],
      };
  const claim = await bookings.updateOne(claimFilter, {
    $set: { "email.status": "sending", "email.claimed_at": now },
    $inc: { "email.attempts": 1 },
  });
  if (!claim.modifiedCount) return { status: "skipped" };

  try {
    const details = await getBookingDetails(bookingId);
    if (!details?.guest?.email) throw new Error("Booking has no guest email.");

    const { subject, html, text } = buildConfirmationEmail(details);
    const pdf = await buildSingleInvoicePdf(details);

    const resend = new Resend(cfg.apiKey);
    const { data, error } = await resend.emails.send(
      {
        from: cfg.from,
        to: [details.guest.email],
        ...(cfg.bcc.length ? { bcc: cfg.bcc } : {}),
        ...(cfg.replyTo.length ? { replyTo: cfg.replyTo } : {}),
        subject,
        html,
        text,
        attachments: [{ filename: `Invoice-${bookingId}.pdf`, content: pdf.toString("base64"), contentType: "application/pdf" }],
        tags: [{ name: "type", value: "booking_confirmation" }],
      },
      { idempotencyKey: force ? `booking-confirm/${bookingId}/${now.getTime()}` : `booking-confirm/${bookingId}` }
    );
    if (error) throw new Error(error.message || "Resend rejected the email.");

    await bookings.updateOne(
      { booking_id: bookingId },
      { $set: { "email.status": "sent", "email.id": data?.id || null, "email.sent_at": new Date(), "email.to": details.guest.email, "email.error": null } }
    );
    return { status: "sent", id: data?.id };
  } catch (err) {
    const message = String(err?.message || err).slice(0, 300);
    console.error(`[email] Confirmation for ${bookingId} failed:`, message);
    await bookings.updateOne(
      { booking_id: bookingId },
      { $set: { "email.status": "failed", "email.error": message, "email.failed_at": new Date() } }
    );
    return { status: "failed", error: message };
  }
}
