import "server-only";
import { getDb, clientPromise } from "@/lib/mongodb";
import { razorpayRequest, PAYMENT_ID_RE } from "@/lib/razorpay";
import { recordPromoUse } from "@/lib/promos";

/**
 * Single source of truth for turning a Razorpay payment into a booking.
 * Called by BOTH /api/payments/verify (browser) and the webhook, so a
 * booking is still confirmed if the customer closes the tab after paying.
 *
 * Safe to call many times for the same payment (idempotent).
 *
 * Returns one of:
 *   { state: "confirmed", bookingId, alreadyConfirmed }
 *   { state: "pending" }                  payment not captured yet
 *   { state: "failed" }                   payment failed
 *   { state: "refunded" | "refund_failed", bookingId }  could not allot room
 *   { state: "not_found" } | { state: "mismatch" }
 */
export async function finalizePayment({ orderId, paymentId }) {
  if (!PAYMENT_ID_RE.test(paymentId)) return { state: "mismatch" };

  const db = await getDb();
  const client = await clientPromise;
  const paymentOrders = db.collection("payment_orders");

  const record = await paymentOrders.findOne({ razorpay_order_id: orderId });
  if (!record) return { state: "not_found" };

  // Already done for this exact payment.
  if (record.status === "confirmed" && record.razorpay_payment_id === paymentId) {
    return { state: "confirmed", bookingId: record.booking_id, alreadyConfirmed: true };
  }

  // Always ask Razorpay directly — never trust amounts/status from the browser.
  let { ok, data: payment } = await razorpayRequest(
    `/payments/${encodeURIComponent(paymentId)}`
  );
  if (!ok) return { state: "pending" };

  if (
    payment.order_id !== orderId ||
    payment.amount !== record.amount_paise ||
    payment.currency !== record.currency
  ) {
    console.error("Payment/order mismatch", { orderId, paymentId });
    await paymentOrders.updateOne(
      { _id: record._id, status: { $ne: "confirmed" } },
      { $set: { status: "mismatch", lastVerificationAt: new Date() } }
    );
    return { state: "mismatch" };
  }

  if (payment.status === "failed") {
    await paymentOrders.updateOne(
      { _id: record._id, status: { $nin: ["confirmed", "refunded"] } },
      { $set: { status: "failed", lastVerificationAt: new Date() } }
    );
    return { state: "failed" };
  }

  // If the account isn't on auto-capture, capture the exact expected amount.
  if (payment.status === "authorized") {
    const capture = await razorpayRequest(
      `/payments/${encodeURIComponent(paymentId)}/capture`,
      { method: "POST", body: { amount: record.amount_paise, currency: record.currency } }
    );
    if (capture.ok) {
      payment = capture.data;
    } else {
      // Possibly auto-captured in the meantime — re-check.
      const again = await razorpayRequest(`/payments/${encodeURIComponent(paymentId)}`);
      if (!again.ok) return { state: "pending" };
      payment = again.data;
    }
  }

  if (payment.status !== "captured" || payment.captured !== true) {
    await paymentOrders.updateOne(
      { _id: record._id, status: { $nin: ["confirmed", "refunded"] } },
      { $set: { status: "verification_pending", lastVerificationAt: new Date() } }
    );
    return { state: "pending" };
  }

  // A second successful payment against an order that's already confirmed.
  if (record.status === "confirmed" && record.razorpay_payment_id !== paymentId) {
    return refundPayment(record, paymentId, "DUPLICATE_PAYMENT");
  }

  const session = client.startSession();
  let alreadyConfirmed = false;

  try {
    await session.withTransaction(
      async () => {
        const bookings = db.collection("bookings_data");
        const availability = db.collection("room_availabilty");
        const tempBooks = db.collection("temp_books");
        const roomNights = db.collection("room_nights");

        const current = await paymentOrders.findOne({ _id: record._id }, { session });
        const existing = await bookings.findOne({ booking_id: current.booking_id }, { session });
        if (existing?.status === "confirmed") {
          if (existing.payment?.payment_id === paymentId) {
            alreadyConfirmed = true;
            return;
          }
          throw new Error("DUPLICATE_PAYMENT");
        }

        const holds = Array.isArray(current.holds) ? current.holds : [];
        if (holds.length === 0) throw new Error("NO_PAYMENT_HOLDS");
        const now = new Date();

        for (const hold of holds) {
          for (const date of hold.stayDates || []) {
            const day = await availability.findOne({ date }, { session });
            if (
              (day?.booked_rooms || []).includes(hold.roomId) ||
              (day?.blocked_rooms || []).includes(hold.roomId)
            ) {
              throw new Error("ROOM_NO_LONGER_AVAILABLE");
            }
          }
          // If our hold lapsed while paying, we can still confirm as long as
          // nobody ELSE is holding the room right now.
          const otherHold = await tempBooks.findOne(
            {
              roomId: hold.roomId,
              TempID: { $ne: current.TempID },
              expiresAt: { $gt: now },
              stayDates: { $in: hold.stayDates || [] },
            },
            { session }
          );
          if (otherHold) throw new Error("ROOM_NO_LONGER_AVAILABLE");
        }

        // Hard guarantee against double-booking: one document per
        // room-night with a unique _id. A clash aborts the transaction.
        const nightDocs = holds.flatMap((hold) =>
          (hold.stayDates || []).map((date) => ({
            _id: `${hold.roomId}|${date}`,
            roomId: hold.roomId,
            date,
            booking_id: current.booking_id,
            created_at: now,
          }))
        );
        try {
          await roomNights.insertMany(nightDocs, { session, ordered: true });
        } catch (error) {
          if (error?.code === 11000) throw new Error("ROOM_NO_LONGER_AVAILABLE");
          throw error;
        }

        const customer = current.customer || {};
        const addons = current.addons || {};
        const quote = current.quote || {};

        await bookings.insertOne(
          {
            booking_id: current.booking_id,
            personal_info: {
              name: customer.name || "",
              email: customer.email || "",
              phone_number: customer.phone || "",
              aadhar_number: customer.aadhar_number || "",
              address: customer.address || "",
              pin_code: customer.pin_code || "",
              city: customer.city || "",
              special_request: customer.special_request || "",
            },
            check_in: holds[0].checkIn,
            check_out: holds[0].checkOut,
            nights: quote.nights || 1,
            rooms: quote.rooms || [],
            dinner: ["dinner", "lunchDinner"].includes(addons.mealPlan) ? addons.mealGuests || 0 : 0,
            lunch: ["lunch", "lunchDinner"].includes(addons.mealPlan) ? addons.mealGuests || 0 : 0,
            driver: {
              accommodation: Number(addons.drivers) > 0 ? "yes" : "no",
              dinner: ["dinner", "lunchDinner"].includes(addons.driverMealPlan) ? "yes" : "no",
            },
            terms_conditions: "yes",
            terms_accepted_at: current.terms_accepted_at || current.createdAt,
            paid_amount: current.amount_paise / 100,
            pricing: quote,
            payment: {
              provider: "razorpay",
              order_id: orderId,
              payment_id: paymentId,
              method: payment.method || null,
              status: "captured",
              currency: record.currency,
              captured_at: payment.created_at ? new Date(payment.created_at * 1000) : now,
            },
            lookup_token_hash: current.lookup_token_hash,
            status: "confirmed",
            created_at: now,
          },
          { session }
        );

        for (const hold of holds) {
          for (const date of hold.stayDates || []) {
            await availability.updateOne(
              { date },
              { $setOnInsert: { date, blocked_rooms: [] } },
              { upsert: true, session }
            );
            await availability.updateOne(
              { date },
              {
                $addToSet: { booked_rooms: hold.roomId },
                $pull: { temporary_holds: { TempID: current.TempID, roomId: hold.roomId } },
              },
              { session }
            );
          }
          await tempBooks.deleteMany(
            { TempID: current.TempID, roomId: hold.roomId, checkIn: hold.checkIn, checkOut: hold.checkOut },
            { session }
          );
        }

        await recordPromoUse(db, quote.promoCode, session);

        await paymentOrders.updateOne(
          { _id: current._id },
          {
            $set: {
              status: "confirmed",
              razorpay_payment_id: paymentId,
              verifiedAt: now,
            },
          },
          { session }
        );
      },
      {
        readConcern: { level: "snapshot" },
        writeConcern: { w: "majority" },
        readPreference: "primary",
      }
    );
  } catch (error) {
    if (["ROOM_NO_LONGER_AVAILABLE", "DUPLICATE_PAYMENT", "NO_PAYMENT_HOLDS"].includes(error.message)) {
      return refundPayment(record, paymentId, error.message);
    }
    throw error;
  } finally {
    await session.endSession();
  }

  return { state: "confirmed", bookingId: record.booking_id, alreadyConfirmed };
}

/**
 * Money was captured but no room could be allotted → refund automatically.
 * The claim on `refunds.<paymentId>` makes this run at most once even if
 * verify and the webhook race each other.
 */
async function refundPayment(record, paymentId, reason) {
  const db = await getDb();
  const paymentOrders = db.collection("payment_orders");
  const field = `refunds.${paymentId}`;

  const claim = await paymentOrders.updateOne(
    { _id: record._id, [field]: { $exists: false } },
    { $set: { [field]: { status: "requesting", reason, at: new Date() } } }
  );

  if (claim.modifiedCount === 0) {
    const fresh = await paymentOrders.findOne({ _id: record._id });
    const st = fresh?.refunds?.[paymentId]?.status;
    return { state: st === "failed" ? "refund_failed" : "refunded", bookingId: record.booking_id };
  }

  if (process.env.AUTO_REFUND_ON_CONFLICT === "false") {
    await paymentOrders.updateOne(
      { _id: record._id },
      { $set: { [field]: { status: "manual_review", reason, at: new Date() }, status: "needs_refund" } }
    );
    console.error("Payment needs manual refund", { bookingId: record.booking_id, paymentId, reason });
    return { state: "refund_failed", bookingId: record.booking_id };
  }

  const res = await razorpayRequest(`/payments/${encodeURIComponent(paymentId)}/refund`, {
    method: "POST",
    body: {
      amount: record.amount_paise,
      speed: "normal",
      receipt: `RF-${record.booking_id}`.slice(0, 40),
      notes: { booking_id: record.booking_id, reason },
    },
  });

  const ok = res.ok && res.data?.id;
  await paymentOrders.updateOne(
    { _id: record._id },
    {
      $set: {
        [field]: {
          status: ok ? "requested" : "failed",
          refund_id: res.data?.id || null,
          reason,
          at: new Date(),
        },
        ...(record.status === "confirmed" ? {} : { status: ok ? "refunded" : "needs_refund" }),
      },
    }
  );
  if (!ok) {
    console.error("AUTO-REFUND FAILED — refund manually", {
      bookingId: record.booking_id,
      paymentId,
      error: res.data?.error?.description,
    });
  }
  return { state: ok ? "refunded" : "refund_failed", bookingId: record.booking_id };
}
