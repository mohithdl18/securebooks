import "server-only";
import rooms from "@/data/rooms.json";
import { getDb, clientPromise } from "@/lib/mongodb";
import { getStayDates, isValidDate, todayInIndia } from "@/lib/validation";
import { RequestError } from "@/lib/security";

export const ROOM_IDS = rooms.map((r) => r.id);
const roomName = (id) => rooms.find((r) => r.id === id)?.name || id;

export const BOOKING_ID_RE = /^SUV-[A-Z0-9-]{6,40}$/;

export function paymentLabel(booking) {
  const p = booking?.payment || {};
  if (p.refund_status === "processed" || p.refund_status === "refunded") return "Refunded";
  if (p.refund_status) return "Refund pending";
  if (p.status === "captured") return "Paid";
  return p.status ? String(p.status) : "Unknown";
}

/** Compact row for the bookings table. */
export function toSummary(b) {
  return {
    bookingId: b.booking_id,
    name: b.personal_info?.name || "",
    rooms: (b.rooms || []).map((r) => r.roomName || roomName(r.roomId)),
    roomIds: (b.rooms || []).map((r) => r.roomId),
    checkIn: b.check_in || "",
    checkOut: b.check_out || "",
    status: b.status || "",
    paymentStatus: paymentLabel(b),
    amount: Number(b.paid_amount) || 0,
    createdAt: b.created_at || null,
  };
}

/** Everything the details modal / invoice needs. Aadhaar is already masked at rest. */
export function toDetails(b, paymentOrder = null) {
  const info = b.personal_info || {};
  return {
    ...toSummary(b),
    guest: {
      name: info.name || "",
      email: info.email || "",
      phone: info.phone_number || "",
      address: info.address || "",
      city: info.city || "",
      pinCode: info.pin_code || "",
      aadhaar: info.aadhar_number || "",
      specialRequest: info.special_request || "",
    },
    nights: b.nights || 0,
    roomLines: (b.rooms || []).map((r) => ({
      roomId: r.roomId,
      roomName: r.roomName || roomName(r.roomId),
      nights: r.nights,
      nightlyRate: r.nightly_rate ?? null,
      extraAdults: r.extra_adults || 0,
      children: r.chargeable_children || 0,
      amount: r.amount || 0,
    })),
    pricing: b.pricing || null,
    driver: b.driver || null,
    payment: {
      provider: b.payment?.provider || "razorpay",
      orderId: b.payment?.order_id || "",
      paymentId: b.payment?.payment_id || "",
      method: b.payment?.method || "",
      capturedAt: b.payment?.captured_at || null,
      refunds: paymentOrder?.refunds || null,
    },
    termsAcceptedAt: b.terms_accepted_at || null,
    email: b.email
      ? { status: b.email.status, sentAt: b.email.sent_at || null, to: b.email.to || "", error: b.email.error || "" }
      : null,
    cancelledAt: b.cancelled_at || null,
    cancelReason: b.cancel_reason || "",
  };
}

export async function getStats() {
  const db = await getDb();
  const bookings = db.collection("bookings_data");
  const today = todayInIndia();
  const [total, active, cancelled, sum] = await Promise.all([
    bookings.countDocuments({}),
    bookings.countDocuments({ status: "confirmed", check_out: { $gte: today } }),
    bookings.countDocuments({ status: "cancelled" }),
    bookings
      .aggregate([
        { $match: { status: "confirmed" } },
        { $group: { _id: null, amount: { $sum: "$paid_amount" } } },
      ])
      .toArray(),
  ]);
  return {
    totalBookings: total,
    activeBookings: active,
    cancelledBookings: cancelled,
    amountCollected: Math.round((sum[0]?.amount || 0) * 100) / 100,
  };
}

export async function listBookings(page, pageSize = 30) {
  const db = await getDb();
  const bookings = db.collection("bookings_data");
  const total = await bookings.countDocuments({});
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), totalPages);
  const docs = await bookings
    .find({}, { projection: { personal_info: 1, booking_id: 1, rooms: 1, check_in: 1, check_out: 1, status: 1, payment: 1, paid_amount: 1, created_at: 1 } })
    .sort({ created_at: -1, _id: -1 })
    .skip((current - 1) * pageSize)
    .limit(pageSize)
    .toArray();
  return { page: current, pageSize, total, totalPages, bookings: docs.map(toSummary) };
}

export async function getBookingDetails(bookingId) {
  const db = await getDb();
  const booking = await db.collection("bookings_data").findOne({ booking_id: bookingId });
  if (!booking) return null;
  const order = await db
    .collection("payment_orders")
    .findOne({ booking_id: bookingId }, { projection: { refunds: 1 } });
  return toDetails(booking, order);
}

/** Status of all 4 rooms on one night. */
export async function getRoomsForDate(date) {
  if (!isValidDate(date)) throw new RequestError("Invalid date.");
  const db = await getDb();
  const [day, covering, holds] = await Promise.all([
    db.collection("room_availabilty").findOne({ date }),
    db
      .collection("bookings_data")
      .find(
        { status: "confirmed", check_in: { $lte: date }, check_out: { $gt: date } },
        { projection: { booking_id: 1, rooms: 1, "personal_info.name": 1, check_in: 1, check_out: 1 } }
      )
      .toArray(),
    db
      .collection("temp_books")
      .find({ stayDates: date, expiresAt: { $gt: new Date() } }, { projection: { roomId: 1, expiresAt: 1 } })
      .toArray(),
  ]);

  return rooms.map((room) => {
    const booking = covering.find((b) => (b.rooms || []).some((r) => r.roomId === room.id));
    const base = { roomId: room.id, name: room.name, image: room.image, maxGuests: room.maxGuests };
    if (booking) {
      return {
        ...base,
        status: "booked",
        bookingId: booking.booking_id,
        guestName: booking.personal_info?.name || "",
        checkIn: booking.check_in,
        checkOut: booking.check_out,
      };
    }
    if ((day?.booked_rooms || []).includes(room.id)) return { ...base, status: "booked", bookingId: null };
    if ((day?.blocked_rooms || []).includes(room.id)) return { ...base, status: "blocked" };
    const hold = holds.find((h) => h.roomId === room.id);
    if (hold) return { ...base, status: "held", holdExpiresAt: hold.expiresAt };
    return { ...base, status: "available" };
  });
}

function assertRoomAndDate(roomId, date) {
  if (typeof roomId !== "string" || !ROOM_IDS.includes(roomId)) throw new RequestError("Invalid room.");
  if (!isValidDate(date)) throw new RequestError("Invalid date.");
  if (date < todayInIndia()) throw new RequestError("Past dates can't be changed.");
}

/** Adds the room to room_availabilty.blocked_rooms for that date. */
export async function blockRoom(roomId, date) {
  assertRoomAndDate(roomId, date);
  const db = await getDb();
  const client = await clientPromise;
  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      const availability = db.collection("room_availabilty");
      const day = await availability.findOne({ date }, { session });
      if ((day?.booked_rooms || []).includes(roomId)) throw new RequestError("This room is booked on that date.", 409);
      const booked = await db.collection("bookings_data").findOne(
        { status: "confirmed", check_in: { $lte: date }, check_out: { $gt: date }, "rooms.roomId": roomId },
        { session }
      );
      if (booked) throw new RequestError("This room is booked on that date.", 409);
      const held = await db.collection("temp_books").findOne(
        { roomId, stayDates: date, expiresAt: { $gt: new Date() } },
        { session }
      );
      if (held) {
        throw new RequestError("A guest is checking out this room right now. Try again in a few minutes.", 409);
      }
      await availability.updateOne(
        { date },
        { $setOnInsert: { date, booked_rooms: [] }, $addToSet: { blocked_rooms: roomId } },
        { upsert: true, session }
      );
    });
  } finally {
    await session.endSession();
  }
}

export async function unblockRoom(roomId, date) {
  assertRoomAndDate(roomId, date);
  const db = await getDb();
  await db.collection("room_availabilty").updateOne({ date }, { $pull: { blocked_rooms: roomId } });
}

/**
 * Cancels a confirmed booking and frees its rooms for every night.
 * Does NOT refund automatically — refunds follow your cancellation
 * policy and are issued from the Razorpay dashboard.
 */
export async function cancelBooking(bookingId, { username, reason }) {
  const db = await getDb();
  const client = await clientPromise;
  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      const bookings = db.collection("bookings_data");
      const booking = await bookings.findOne({ booking_id: bookingId }, { session });
      if (!booking) throw new RequestError("Booking not found.", 404);
      if (booking.status !== "confirmed") throw new RequestError("Only confirmed bookings can be cancelled.", 409);

      const nights = getStayDates(booking.check_in, booking.check_out);
      const roomIds = (booking.rooms || []).map((r) => r.roomId).filter(Boolean);

      for (const date of nights) {
        await db.collection("room_availabilty").updateOne(
          { date },
          { $pull: { booked_rooms: { $in: roomIds } } },
          { session }
        );
      }
      await db.collection("room_nights").deleteMany({ booking_id: bookingId }, { session });

      await bookings.updateOne(
        { _id: booking._id, status: "confirmed" },
        {
          $set: {
            status: "cancelled",
            cancelled_at: new Date(),
            cancelled_by: username,
            cancel_reason: reason || "",
          },
        },
        { session }
      );
    });
  } finally {
    await session.endSession();
  }
}
