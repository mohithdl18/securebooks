import { getDb } from "@/lib/mongodb";
import {
  jsonError,
  jsonOk,
  readJsonBody,
  assertSameOrigin,
  enforceRateLimit,
  RequestError,
} from "@/lib/security";
import { resolvePromo } from "@/lib/promos";

/**
 * Lets the checkout show a discount preview. Purely informational —
 * create-order re-validates the code and computes the real amount.
 * Tightly rate-limited so codes can't be brute-forced.
 */
export async function POST(request) {
  try {
    const blocked = assertSameOrigin(request);
    if (blocked) return blocked;

    const { code } = await readJsonBody(request, 512);
    const db = await getDb();
    const limited = await enforceRateLimit(db, request, "promo", 8, 15 * 60 * 1000);
    if (limited) return limited;

    const promo = await resolvePromo(db, code);
    if (!promo) return jsonError("Please enter a promo code.");

    return jsonOk({
      success: true,
      code: promo.code,
      percent: promo.percent,
      maxDiscount: promo.maxDiscount,
    });
  } catch (error) {
    if (error instanceof RequestError) return jsonError(error.message, error.status);
    console.error("Promo validation failed:", error);
    return jsonError("Unable to check this code right now.", 500);
  }
}
