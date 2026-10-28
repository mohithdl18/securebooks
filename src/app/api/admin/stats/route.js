import { jsonError, jsonOk } from "@/lib/security";
import { requireAdmin } from "@/lib/adminAuth";
import { getStats } from "@/lib/adminData";

export async function GET(request) {
  const { response } = await requireAdmin(request);
  if (response) return response;
  try {
    return jsonOk({ success: true, ...(await getStats()) });
  } catch (error) {
    console.error("Admin stats failed:", error);
    return jsonError("Unable to load stats.", 500);
  }
}
