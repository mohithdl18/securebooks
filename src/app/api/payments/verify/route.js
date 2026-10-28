import { after } from "next/server";
import {
  jsonError,
  jsonOk,
  readJsonBody,
  assertSameOrigin,
  enforceRateLimit,
  RequestError,
} from "@/lib/security";
import { getDb } from "@/lib/mongodb";
import {
  razorpayConfigured,
  verifyCheckoutSignature,
  ORDER_ID_RE,
  PAYMENT_ID_RE,
} from "@/lib/razorpay";
import { finalizePayment } from "@/lib/finalizeBooking";
import { sendBookingConfirmation } from "@/lib/email";

/**
 * Called by the browser after Razorpay Checkout succeeds.
 * The signature proves the (order, payment) pair came from Razorpay;
 * finalizePayment() then re-checks amount + status with Razorpay's API.
 * The webhook runs the same logic, so this is not the only path.
 */
export async function POST(request) {
  try {
    const blocked = assertSameOrigin(request);
    if (blocked) return blocked;

    const body = await readJsonBody(request, 2048);
    const {
      razorpay_order_id: orderId,
      razorpay_payment_id: paymentId,
      razorpay_signature: signature,
    } = body;

    if (
      typeof orderId !== "string" || !ORDER_ID_RE.test(orderId) ||
      typeof paymentId !== "string" || !PAYMENT_ID_RE.test(paymentId) ||
      typeof signature !== "string" || !/^[a-f0-9]{64}$/i.test(signature)
    ) {
      return jsonError("Invalid payment verification fields.");
    }

    if (!razorpayConfigured()) return jsonError("Payment service is not configured.", 503);

    const db = await getDb();
    const limited = await enforceRateLimit(db, request, "verify", 30, 10 * 60 * 1000);
    if (limited) return limited;

    if (!verifyCheckoutSignature(orderId, paymentId, signature)) {
      return jsonError("Payment signature verification failed.", 400, { rejected: true });
    }

    const result = await finalizePayment({ orderId, paymentId });

    switch (result.state) {
      case "confirmed":
        // Email goes out after this response, so the confirmation page
        // shows immediately. Safe to trigger twice — sent once only.
        after(() => sendBookingConfirmation(result.bookingId).catch(() => {}));
        return jsonOk({
          success: true,
          bookingId: result.bookingId,
          alreadyConfirmed: result.alreadyConfirmed,
          message: "Payment verified and booking confirmed.",
        });
      case "failed":
        return jsonError("Payment was not completed.", 402, { rejected: true });
      case "refunded":
        return jsonError(
          "Sorry — the room was taken before your payment completed. Your payment is being refunded automatically (5–7 working days).",
          409,
          { rejected: true, refunded: true, bookingId: result.bookingId }
        );
      case "refund_failed":
        return jsonError(
          "Payment was received, but the room could not be confirmed. Our team will refund you — please do not pay again.",
          409,
          { pending: true, bookingId: result.bookingId }
        );
      case "not_found":
      case "mismatch":
        return jsonError("This payment could not be matched to a booking. Contact support; do not pay again.", 400, { pending: true });
      default:
        return jsonError("Payment is not confirmed yet. Please wait a minute before trying again.", 202, { pending: true });
    }
  } catch (error) {
    if (error instanceof RequestError) return jsonError(error.message, error.status);
    console.error("Payment verification/finalization failed:", error);
    return jsonError(
      "We could not finish verifying this payment. Please do not pay again — we will confirm by email.",
      500,
      { pending: true }
    );
  }
}
