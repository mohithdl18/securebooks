import { getDb } from "@/lib/mongodb";
import { jsonError, jsonOk, readJsonBody, RequestError } from "@/lib/security";
import { requireAdmin, audit } from "@/lib/adminAuth";
import { isValidDate, todayInIndia } from "@/lib/validation";
import { getLongWeekendDates, LONG_WEEKENDS_COLLECTION } from "@/lib/pricing";

/**
 * Long-weekend nights (higher prices: room ₹14,999, extra adult ₹5,000,
 * child ₹3,000 — see src/config/pricing.js). Stored in the
 * `long_weekends` collection, one document per night.
 *
 * GET    ?from=YYYY-MM-DD&to=YYYY-MM-DD  → { dates: [...] }
 * POST   { date }  → turn on
 * DELETE { date }  → turn off
 */
export async function GET(request) {
  const params = new URL(request.url).searchParams;
  const from = params.get("from") || "";
  const to = params.get("to") || "";
  const { response } = await requireAdmin(request);
  if (response) return response;
  if (!isValidDate(from) || !isValidDate(to) || to <= from) return jsonError("Invalid date range.");
  try {
    return jsonOk({ success: true, dates: await getLongWeekendDates(await getDb(), from, to) });
  } catch (error) {
    console.error("Long weekends list failed:", error);
    return jsonError("Unable to load long weekends.", 500);
  }
}

function nextDay(date) {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function setLongWeekend(request, enable) {
  const { session, response } = await requireAdmin(request, { mutating: true });
  if (response) return response;
  try {
    const { date } = await readJsonBody(request, 256);
    if (!isValidDate(date)) throw new RequestError("Invalid date.");
    if (date < todayInIndia()) throw new RequestError("Past dates can't be changed.");

    const db = await getDb();
    const longWeekends = db.collection(LONG_WEEKENDS_COLLECTION);
    if (enable) {
      await longWeekends.updateOne(
        { _id: date },
        { $set: { date, created_by: session.username, created_at: new Date() } },
        { upsert: true }
      );
    } else {
      await longWeekends.deleteOne({ _id: date });
      // Also clear the older flag, if this night was set before the change.
      await db.collection("room_availabilty").updateOne(
        { date },
        { $unset: { long_weekend: "", long_weekend_by: "", long_weekend_at: "" } }
      );
    }
    // Confirm it's really saved before telling the admin.
    const saved = (await getLongWeekendDates(db, date, nextDay(date))).includes(date);
    if (saved !== enable) throw new Error("Long weekend change was not saved.");
    await audit(request, session, enable ? "long_weekend_on" : "long_weekend_off", { date });
    return jsonOk({ success: true, date, longWeekend: enable });
  } catch (error) {
    if (error instanceof RequestError) return jsonError(error.message, error.status);
    console.error("Long weekend update failed:", error);
    return jsonError("Unable to update this date. Please try again.", 500);
  }
}

export const POST = (request) => setLongWeekend(request, true);
export const DELETE = (request) => setLongWeekend(request, false);
