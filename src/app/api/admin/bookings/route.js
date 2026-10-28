import { jsonError, jsonOk } from "@/lib/security";
import { requireAdmin } from "@/lib/adminAuth";
import { listBookings } from "@/lib/adminData";

// GET /api/admin/bookings?page=1  (30 per page, newest first)
export async function GET(request) {
  const raw = Number(new URL(request.url).searchParams.get("page") || 1);
  const page = Number.isInteger(raw) && raw > 0 && raw < 100000 ? raw : 1;
  const { response } = await requireAdmin(request);
  if (response) return response;
  try {
    return jsonOk({ success: true, ...(await listBookings(page, 30)) });
  } catch (error) {
    console.error("Admin bookings list failed:", error);
    return jsonError("Unable to load bookings.", 500);
  }
}
