import { NextResponse, after } from "next/server";
import { getDb } from "@/lib/mongodb";
import { verifyWebhookSignature, ORDER_ID_RE, PAYMENT_ID_RE } from "@/lib/razorpay";
import { finalizePayment } from "@/lib/finalizeBooking";
import { sendBookingConfirmation } from "@/lib/email";

/**
 * Razorpay → server webhook. Configure in Dashboard → Webhooks with
 * events: payment.authorized, payment.captured, payment.failed,
 * order.paid, refund.processed, refund.failed.
 *
 * This is what confirms bookings when the guest's browser closes or
 * loses network right after paying.
 */
const MAX_BODY = 256 * 1024;

export async function POST(request) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ success: false }, { status: 503 });
  }

  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY) {
    return NextResponse.json({ success: false }, { status: 413 });
  }

  const signature = request.headers.get("x-razorpay-signature") || "";
  if (!verifyWebhookSignature(raw, signature, secret)) {
    return NextResponse.json({ success: false }, { status: 400 });
  }

  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ success: false }, { status: 400 });
  }

  const db = await getDb();
  const events = db.collection("webhook_events");
  const eventId = request.headers.get("x-razorpay-event-id") || null;

  // Idempotency: Razorpay retries; process each event once.
  if (eventId) {
    try {
      await events.insertOne({ _id: eventId, event: event.event, receivedAt: new Date() });
    } catch (error) {
      if (error?.code === 11000) return NextResponse.json({ received: true, duplicate: true });
      throw error;
    }
  }

  try {
    const payment = event?.payload?.payment?.entity;
    const orderId = payment?.order_id;
    const paymentId = payment?.id;
    const type = String(event?.event || "");

    if (
      ["payment.authorized", "payment.captured", "order.paid"].includes(type) &&
      ORDER_ID_RE.test(orderId || "") &&
      PAYMENT_ID_RE.test(paymentId || "")
    ) {
      const result = await finalizePayment({ orderId, paymentId });
      if (result.state === "pending") throw new Error("PAYMENT_STILL_PENDING");
      // Covers guests who closed the tab before the confirmation page.
      if (result.state === "confirmed") {
        after(() => sendBookingConfirmation(result.bookingId).catch(() => {}));
      }
    } else if (type === "payment.failed" && ORDER_ID_RE.test(orderId || "")) {
      await db.collection("payment_orders").updateOne(
        { razorpay_order_id: orderId, status: { $in: ["created", "verification_pending"] } },
        { $set: { status: "failed", lastWebhookAt: new Date() } }
      );
    } else if (type.startsWith("refund.")) {
      const refund = event?.payload?.refund?.entity;
      if (refund?.payment_id && PAYMENT_ID_RE.test(refund.payment_id)) {
        await db.collection("payment_orders").updateOne(
          { [`refunds.${refund.payment_id}`]: { $exists: true } },
          {
            $set: {
              [`refunds.${refund.payment_id}.status`]: refund.status || type,
              [`refunds.${refund.payment_id}.refund_id`]: refund.id,
              [`refunds.${refund.payment_id}.updated_at`]: new Date(),
            },
          }
        );
      }
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Razorpay webhook processing failed:", error);
    // Let Razorpay retry this event later.
    if (eventId) await events.deleteOne({ _id: eventId }).catch(() => {});
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
