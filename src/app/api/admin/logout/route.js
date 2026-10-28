import { jsonOk, assertSameOrigin } from "@/lib/security";
import { destroyAdminSession, clearAdminCookie, getAdminSession, audit } from "@/lib/adminAuth";

export async function POST(request) {
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;
  try {
    const session = await getAdminSession(request);
    if (session) await audit(request, session, "logout");
    await destroyAdminSession(request);
  } catch (error) {
    console.error("Admin logout failed:", error);
  }
  return clearAdminCookie(jsonOk({ success: true }));
}
