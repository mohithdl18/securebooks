import { jsonError, jsonOk, RequestError } from "@/lib/security";
import { requireAdmin } from "@/lib/adminAuth";
import { getRoomsForDate } from "@/lib/adminData";

// GET /api/admin/rooms?date=YYYY-MM-DD
export async function GET(request) {
  const date = new URL(request.url).searchParams.get("date") || "";
  const { response } = await requireAdmin(request);
  if (response) return response;
  try {
    return jsonOk({ success: true, date, rooms: await getRoomsForDate(date) });
  } catch (error) {
    if (error instanceof RequestError) return jsonError(error.message, error.status);
    console.error("Admin rooms failed:", error);
    return jsonError("Unable to load rooms.", 500);
  }
}
