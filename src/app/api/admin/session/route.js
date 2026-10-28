import { jsonOk } from "@/lib/security";
import { requireAdmin } from "@/lib/adminAuth";

export async function GET(request) {
  const { session, response } = await requireAdmin(request);
  if (response) return response;
  return jsonOk({
    success: true,
    username: session.username,
    expiresAt: new Date(session.expiresAt).toISOString(),
  });
}
