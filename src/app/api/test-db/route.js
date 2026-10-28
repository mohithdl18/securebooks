import { connection } from "next/server";
import { getDb } from "@/lib/mongodb";
import { hasBearerSecret } from "@/lib/security";

// Health check. Disabled in production unless called with
// "Authorization: Bearer $HEALTHCHECK_SECRET". Never reveals DB details.
export async function GET(request) {
  await connection(); // always evaluate per request, never prerender
  const allowed =
    process.env.NODE_ENV === "development" ||
    hasBearerSecret(request, process.env.HEALTHCHECK_SECRET);

  if (!allowed) {
    return Response.json({ success: false, message: "Not found." }, { status: 404 });
  }

  try {
    const db = await getDb();
    await db.command({ ping: 1 });
    return Response.json({ success: true, message: "OK" }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("MongoDB health check failed:", error);
    return Response.json({ success: false, message: "Database unavailable." }, { status: 503 });
  }
}
