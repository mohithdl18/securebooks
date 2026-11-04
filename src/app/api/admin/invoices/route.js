import { getDb } from "@/lib/mongodb";
import { jsonError, enforceRateLimit } from "@/lib/security";
import { requireAdmin, audit } from "@/lib/adminAuth";
import { toDetails } from "@/lib/adminData";
import { buildBookingsWorkbook, exportFileName } from "@/lib/bookingsExcel";

const MAX_DAYS = 365;
const MAX_ROWS = 5000;

// The site's own address, for the "Open invoice" links in the file.
// Uses APP_ORIGIN when set (recommended in production).
function siteOrigin(request) {
  const configured = (process.env.APP_ORIGIN || "").split(",")[0].trim().replace(/\/$/, "");
  const candidate =
    configured ||
    `${request.headers.get("x-forwarded-proto") || new URL(request.url).protocol.replace(":", "")}://${
      request.headers.get("x-forwarded-host") || request.headers.get("host") || ""
    }`;
  // Only a plain http(s)://host[:port] is allowed into the formula.
  return /^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/.test(candidate) ? candidate : "";
}

// GET /api/admin/invoices?days=30 → Excel (.xlsx) of bookings made in the last N days
export async function GET(request) {
  const raw = Number(new URL(request.url).searchParams.get("days"));
  const { session, response } = await requireAdmin(request);
  if (response) return response;
  if (!Number.isInteger(raw) || raw < 1 || raw > MAX_DAYS) {
    return jsonError(`Choose between 1 and ${MAX_DAYS} days.`);
  }

  try {
    const db = await getDb();
    const limited = await enforceRateLimit(db, request, "admin-invoices", 20, 10 * 60 * 1000);
    if (limited) return limited;

    const since = new Date(Date.now() - raw * 24 * 60 * 60 * 1000);
    const docs = await db
      .collection("bookings_data")
      .find({ created_at: { $gte: since } })
      .sort({ created_at: 1 })
      .limit(MAX_ROWS)
      .toArray();
    const orders = await db
      .collection("payment_orders")
      .find({ booking_id: { $in: docs.map((d) => d.booking_id) } }, { projection: { booking_id: 1, refunds: 1 } })
      .toArray();
    const bookings = docs.map((d) => toDetails(d, orders.find((o) => o.booking_id === d.booking_id)));

    const xlsx = await buildBookingsWorkbook(bookings, raw, { baseUrl: siteOrigin(request) });
    await audit(request, session, "bookings_excel_download", { days: raw, count: bookings.length });

    return new Response(xlsx, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${exportFileName(raw)}"`,
        "Cache-Control": "no-store",
        "X-Invoice-Count": String(bookings.length),
      },
    });
  } catch (error) {
    console.error("Bookings Excel export failed:", error);
    return jsonError("Unable to create the Excel file.", 500);
  }
}
