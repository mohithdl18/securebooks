import { getDb } from "@/lib/mongodb";
import { jsonError, jsonOk, readJsonBody, rateLimit, RequestError } from "@/lib/security";
import { requireAdmin, checkCancelPin, audit } from "@/lib/adminAuth";
import { cancelBooking, BOOKING_ID_RE } from "@/lib/adminData";

// POST { pin, reason? } — cancel only with the correct PIN.
export async function POST(request, { params }) {
  const { id } = await params;
  const { session, response } = await requireAdmin(request, { mutating: true });
  if (response) return response;
  if (!BOOKING_ID_RE.test(id || "")) return jsonError("Booking not found.", 404);

  try {
    const { pin, reason } = await readJsonBody(request, 1024);
    const db = await getDb();

    // 5 wrong-PIN tries per 15 min per admin session.
    const key = `cancel-pin:${session.tokenHash.slice(0, 16)}`;
    if (!(await rateLimit(db, key, 5, 15 * 60 * 1000))) {
      return jsonError("Too many PIN attempts. Try again in 15 minutes.", 429);
    }

    if (typeof pin !== "string" || !checkCancelPin(pin)) {
      await audit(request, session, "cancel_pin_failed", { bookingId: id });
      return jsonError("Incorrect PIN.", 403);
    }

    await cancelBooking(id, {
      username: session.username,
      reason: typeof reason === "string" ? reason.trim().slice(0, 300) : "",
    });
    await audit(request, session, "booking_cancel", { bookingId: id });
    return jsonOk({ success: true, message: "Booking cancelled and rooms released." });
  } catch (error) {
    if (error instanceof RequestError) return jsonError(error.message, error.status);
    console.error("Admin cancel failed:", error);
    return jsonError("Unable to cancel this booking. Please try again.", 500);
  }
}
