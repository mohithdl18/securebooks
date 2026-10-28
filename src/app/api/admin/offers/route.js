import { getDb } from "@/lib/mongodb";
import { jsonError, jsonOk, readJsonBody, RequestError } from "@/lib/security";
import { requireAdmin, audit } from "@/lib/adminAuth";
import { createOffer, disableOffer, listOffers } from "@/lib/promos";

// GET: all offers (newest first)
export async function GET(request) {
  const { response } = await requireAdmin(request);
  if (response) return response;
  try {
    return jsonOk({ success: true, offers: await listOffers(await getDb()) });
  } catch (error) {
    console.error("List offers failed:", error);
    return jsonError("Unable to load offers.", 500);
  }
}

// POST { code, visibility: "public"|"private", days, percent } → publish
export async function POST(request) {
  const { session, response } = await requireAdmin(request, { mutating: true });
  if (response) return response;
  try {
    const body = await readJsonBody(request, 1024);
    const offer = await createOffer(await getDb(), body, session.username);
    await audit(request, session, "offer_publish", offer);
    return jsonOk({ success: true, offer });
  } catch (error) {
    if (error instanceof RequestError) return jsonError(error.message, error.status);
    console.error("Publish offer failed:", error);
    return jsonError("Unable to publish the offer.", 500);
  }
}

// DELETE { code } → turn the offer off (kept for records)
export async function DELETE(request) {
  const { session, response } = await requireAdmin(request, { mutating: true });
  if (response) return response;
  try {
    const { code } = await readJsonBody(request, 512);
    await disableOffer(await getDb(), code);
    await audit(request, session, "offer_disable", { code });
    return jsonOk({ success: true });
  } catch (error) {
    if (error instanceof RequestError) return jsonError(error.message, error.status);
    console.error("Disable offer failed:", error);
    return jsonError("Unable to turn off the offer.", 500);
  }
}
