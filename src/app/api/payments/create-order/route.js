import crypto from "node:crypto";
import { getDb } from "@/lib/mongodb";
import rooms from "@/data/rooms.json";
import {
  jsonError,
  jsonOk,
  readJsonBody,
  assertSameOrigin,
  enforceRateLimit,
  readSession,
  deriveTempId,
  randomToken,
  sha256,
  RequestError,
} from "@/lib/security";
import { validateStay, validateCustomerDetails } from "@/lib/validation";
import { quoteBooking } from "@/lib/pricing";
import { resolvePromo } from "@/lib/promos";
import { razorpayConfigured, razorpayRequest, publicKeyId } from "@/lib/razorpay";


// A payment must be started with enough hold time left to finish it.
const MIN_HOLD_REMAINING_MS = 2 * 60 * 1000;
const MAX_AMOUNT_PAISE = 50_00_000 * 100; // ₹50 lakh sanity cap

export async function POST(request) {
  try {
    const blocked = assertSameOrigin(request);
    if (blocked) return blocked;

    const body = await readJsonBody(request, 8 * 1024);
    const { checkIn, checkOut, roomSelections, addons = {}, details, promoCode } = body;

    const sid = readSession(request);
    if (!sid) return jsonError("Your session has expired. Please select your rooms again.", 401);
    const TempID = deriveTempId(sid, body.TempID);

    const stayDates = validateStay(checkIn, checkOut);

    if (!Array.isArray(roomSelections) || roomSelections.length < 1 || roomSelections.length > rooms.length) {
      return jsonError("Select at least one room.");
    }
    const roomIds = roomSelections.map((r) => r?.roomId);
    if (
      new Set(roomIds).size !== roomIds.length ||
      roomIds.some((id) => typeof id !== "string" || !rooms.some((r) => r.id === id))
    ) {
      return jsonError("Invalid or duplicate room selection.");
    }
    if (body.acceptedTerms !== true) {
      return jsonError("Please accept the Terms and Conditions.");
    }

    const customer = validateCustomerDetails(details);

    if (!razorpayConfigured()) return jsonError("Payment service is not configured.", 503);

    const db = await getDb();
    const limited = await enforceRateLimit(db, request, "create-order", 10, 10 * 60 * 1000);
    if (limited) return limited;

    // The rooms must be held by THIS session (cookie-derived TempID).
    const now = new Date();
    const holds = await db
      .collection("temp_books")
      .find({ TempID, roomId: { $in: roomIds }, checkIn, checkOut, expiresAt: { $gt: now }, status: "active" })
      .toArray();
    if (holds.length !== roomIds.length || new Set(holds.map((h) => h.roomId)).size !== roomIds.length) {
      return jsonError("A room hold has expired. Please select your rooms again.", 409);
    }
    const holdExpiresAt = Math.min(...holds.map((h) => new Date(h.expiresAt).getTime()));
    if (holdExpiresAt - now.getTime() < MIN_HOLD_REMAINING_MS) {
      return jsonError("Your room hold is about to expire. Please select your rooms again.", 409);
    }

    for (const date of stayDates) {
      const record = await db.collection("room_availabilty").findOne({ date });
      if (roomIds.some((id) => (record?.booked_rooms || []).includes(id) || (record?.blocked_rooms || []).includes(id))) {
        return jsonError("A selected room is no longer available.", 409);
      }
    }

    // Price is computed ONLY here, from server-side tables.
    const preQuote = quoteBooking({ roomSelections, checkIn, checkOut, addons });
    const promo = await resolvePromo(db, promoCode, { subtotal: preQuote.subtotal, customer });
    const quote = promo ? quoteBooking({ roomSelections, checkIn, checkOut, addons, promo }) : preQuote;

    // The guest must be charged exactly what the site showed them.
    const expected = Number(body.expectedTotal);
    if (!Number.isFinite(expected) || Math.round(expected * 100) !== Math.round(quote.total * 100)) {
      console.warn("Displayed total differs from server total", { expected: body.expectedTotal, server: quote.total });
      return jsonError(
        "Your booking total has changed. Please review your cart and try again.",
        409,
        { priceChanged: true, total: quote.total }
      );
    }

    const amountPaise = Math.round(quote.total * 100);
    if (!Number.isSafeInteger(amountPaise) || amountPaise < 100 || amountPaise > MAX_AMOUNT_PAISE) {
      return jsonError("Invalid payment amount.");
    }

    const bookingId = `SUV-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(6).toString("hex").toUpperCase()}`;
    const lookupToken = randomToken(24);

    const { ok, data: order } = await razorpayRequest("/orders", {
      method: "POST",
      body: {
        amount: amountPaise,
        currency: "INR",
        receipt: bookingId.slice(0, 40),
        notes: { booking_id: bookingId },
      },
    });
    if (!ok || !order?.id || order.amount !== amountPaise || order.currency !== "INR") {
      console.error("Razorpay order creation failed:", order?.error?.description || "unknown");
      return jsonError("Unable to start payment. Please try again.", 502);
    }

    await db.collection("payment_orders").insertOne({
      booking_id: bookingId,
      TempID,
      razorpay_order_id: order.id,
      amount_paise: amountPaise,
      currency: "INR",
      quote,
      customer,
      holds: holds.map((h) => ({
        roomId: h.roomId,
        roomName: h.roomName || h.roomId,
        checkIn: h.checkIn,
        checkOut: h.checkOut,
        stayDates: h.stayDates,
        expiresAt: h.expiresAt,
      })),
      addons: quote.addons,
      lookup_token_hash: sha256(lookupToken),
      terms_accepted_at: now,
      status: "created",
      createdAt: now,
    });

    return jsonOk({
      success: true,
      orderId: order.id,
      keyId: publicKeyId(),
      amount: amountPaise,
      currency: "INR",
      quote,
      bookingId,
      lookupToken,
      // Checkout window closes before the hold lapses.
      holdExpiresAt: new Date(holdExpiresAt).toISOString(),
      checkoutTimeoutSeconds: Math.max(60, Math.floor((holdExpiresAt - Date.now()) / 1000) - 30),
    });
  } catch (error) {
    if (error instanceof RequestError) return jsonError(error.message, error.status);
    console.error("Create Razorpay order failed:", error);
    return jsonError("Unable to create payment order. Please try again.", 500);
  }
}
