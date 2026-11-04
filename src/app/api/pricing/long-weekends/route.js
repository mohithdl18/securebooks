import { connection } from "next/server";
import { getDb } from "@/lib/mongodb";
import { jsonError, jsonOk, enforceRateLimit } from "@/lib/security";
import { isValidDate, getStayDates } from "@/lib/validation";
import { getLongWeekendDates } from "@/lib/pricing";

/**
 * Public: which nights of a stay the admin marked as long weekend.
 * Same database lookup the payment uses, so the price a guest sees
 * matches what they're charged.
 *
 * GET /api/pricing/long-weekends?checkIn=YYYY-MM-DD&checkOut=YYYY-MM-DD
 */
export async function GET(request) {
  await connection();
  const params = new URL(request.url).searchParams;
  const checkIn = params.get("checkIn") || "";
  const checkOut = params.get("checkOut") || "";

  if (!isValidDate(checkIn) || !isValidDate(checkOut) || checkOut <= checkIn) {
    return jsonError("Invalid dates.");
  }
  if (getStayDates(checkIn, checkOut).length > 31) {
    return jsonError("Date range too long.");
  }

  try {
    const db = await getDb();
    const limited = await enforceRateLimit(db, request, "pricing-nights", 120, 60 * 1000);
    if (limited) return limited;
    return jsonOk({ success: true, checkIn, checkOut, longWeekendDates: await getLongWeekendDates(db, checkIn, checkOut) });
  } catch (error) {
    console.error("Long weekend lookup failed:", error);
    return jsonError("Unable to load prices.", 500);
  }
}
