import { getDb } from "@/lib/mongodb";
import { jsonError, jsonOk, rateLimit } from "@/lib/security";
import { requireAdmin, audit } from "@/lib/adminAuth";
import { BOOKING_ID_RE } from "@/lib/adminData";
import { sendBookingConfirmation, emailConfigured } from "@/lib/email";

// POST → (re)send the confirmation email for a booking
export async function POST(request, { params }) {
  const { id } = await params;
  const { session, response } = await requireAdmin(request, { mutating: true });
  if (response) return response;
  if (!BOOKING_ID_RE.test(id || "")) return jsonError("Booking not found.", 404);
  if (!emailConfigured()) return jsonError("Email isn't set up yet — add RESEND_API_KEY and EMAIL_FROM to .env.local.", 503);

  const db = await getDb();
  if (!(await rateLimit(db, `admin-email:${id}`, 3, 60 * 60 * 1000))) {
    return jsonError("This booking was emailed several times in the last hour. Try later.", 429);
  }

  const result = await sendBookingConfirmation(id, { force: true });
  await audit(request, session, "email_resend", { bookingId: id, status: result.status });
  if (result.status === "sent") return jsonOk({ success: true, message: "Confirmation email sent." });
  if (result.status === "skipped") return jsonError("Only confirmed bookings can be emailed (or a send is already in progress).", 409);
  return jsonError(result.error ? `Email failed: ${result.error}` : "Email failed.", 502);
}
