import { getDb } from "@/lib/mongodb";
import {
  jsonError,
  jsonOk,
  enforceRateLimit,
  safeEqualHex,
  sha256,
} from "@/lib/security";

const BOOKING_ID_RE = /^SUV-[A-Z0-9]{6,12}-[A-F0-9]{12}$/;

function maskEmail(email = "") {
  const [user, domain] = String(email).split("@");
  if (!domain) return "";
  return `${user.slice(0, 2)}${"*".repeat(Math.max(1, user.length - 2))}@${domain}`;
}

/**
 * Booking status lookup for the guest.
 * Requires BOTH the booking ID and the secret lookup token returned
 * when the order was created (a booking ID alone is not proof of
 * ownership). Returns no Aadhaar, address or phone.
 *
 * GET /api/Bookings?bookingId=SUV-...&token=...
 */
export async function GET(request) {
  const params = new URL(request.url).searchParams;
  const bookingId = params.get("bookingId") || "";
  const token = params.get("token") || "";

  try {
    if (!BOOKING_ID_RE.test(bookingId) || token.length < 20 || token.length > 100) {
      return jsonError("Booking not found.", 404);
    }

    const db = await getDb();
    const limited = await enforceRateLimit(db, request, "booking-lookup", 20, 10 * 60 * 1000);
    if (limited) return limited;

    const booking = await db.collection("bookings_data").findOne(
      { booking_id: bookingId },
      {
        projection: {
          _id: 0,
          booking_id: 1,
          status: 1,
          paid_amount: 1,
          check_in: 1,
          check_out: 1,
          nights: 1,
          "rooms.roomName": 1,
          "personal_info.name": 1,
          "personal_info.email": 1,
          lookup_token_hash: 1,
          created_at: 1,
        },
      }
    );

    if (!booking || !safeEqualHex(booking.lookup_token_hash || "", sha256(token))) {
      return jsonError("Booking not found.", 404);
    }

    const { lookup_token_hash, personal_info, ...safe } = booking;
    void lookup_token_hash;
    return jsonOk({
      success: true,
      booking: {
        ...safe,
        guest_name: personal_info?.name || "",
        guest_email: maskEmail(personal_info?.email),
      },
    });
  } catch (error) {
    console.error("Booking lookup failed:", error);
    return jsonError("Unable to retrieve booking.", 500);
  }
}
