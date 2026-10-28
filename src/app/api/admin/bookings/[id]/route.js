import { jsonError, jsonOk } from "@/lib/security";
import { requireAdmin, audit } from "@/lib/adminAuth";
import { getBookingDetails, BOOKING_ID_RE } from "@/lib/adminData";

export async function GET(request, { params }) {
  const { id } = await params;
  const { session, response } = await requireAdmin(request);
  if (response) return response;
  if (!BOOKING_ID_RE.test(id || "")) return jsonError("Booking not found.", 404);
  try {
    const booking = await getBookingDetails(id);
    if (!booking) return jsonError("Booking not found.", 404);
    await audit(request, session, "booking_view", { bookingId: id });
    return jsonOk({ success: true, booking });
  } catch (error) {
    console.error("Admin booking details failed:", error);
    return jsonError("Unable to load booking.", 500);
  }
}
