import { connection } from "next/server";
import { getDb } from "@/lib/mongodb";
import { jsonError, jsonOk, enforceRateLimit } from "@/lib/security";
import { listPublicOffers } from "@/lib/promos";

// Public: live offers the admin marked as "public". Private codes never appear.
export async function GET(request) {
  await connection();
  try {
    const db = await getDb();
    const limited = await enforceRateLimit(db, request, "offers", 60, 60 * 1000);
    if (limited) return limited;
    return jsonOk({ success: true, offers: await listPublicOffers(db) });
  } catch (error) {
    console.error("Public offers failed:", error);
    return jsonError("Unable to load offers.", 500);
  }
}
