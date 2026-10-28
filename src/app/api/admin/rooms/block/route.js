import { jsonError, jsonOk, readJsonBody, RequestError } from "@/lib/security";
import { requireAdmin, audit } from "@/lib/adminAuth";
import { blockRoom, unblockRoom } from "@/lib/adminData";

async function handle(request, action) {
  const { session, response } = await requireAdmin(request, { mutating: true });
  if (response) return response;
  try {
    const { roomId, date } = await readJsonBody(request, 512);
    if (action === "block") await blockRoom(roomId, date);
    else await unblockRoom(roomId, date);
    await audit(request, session, action === "block" ? "room_block" : "room_unblock", { roomId, date });
    return jsonOk({ success: true });
  } catch (error) {
    if (error instanceof RequestError) return jsonError(error.message, error.status);
    console.error(`Admin ${action} failed:`, error);
    return jsonError("Unable to update the room. Please try again.", 500);
  }
}

// POST = block, DELETE = unblock. Body: { roomId, date }
export const POST = (request) => handle(request, "block");
export const DELETE = (request) => handle(request, "unblock");
