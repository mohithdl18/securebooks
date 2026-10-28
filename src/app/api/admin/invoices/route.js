import { getDb } from "@/lib/mongodb";
import { jsonError, enforceRateLimit } from "@/lib/security";
import { requireAdmin, audit } from "@/lib/adminAuth";
import { toDetails } from "@/lib/adminData";
import { buildInvoicesPdf } from "@/lib/invoicePdf";

const MAX_DAYS = 365;
const MAX_INVOICES = 500;

// GET /api/admin/invoices?days=30 → one PDF, one invoice per page
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
      .limit(MAX_INVOICES)
      .toArray();
    const orders = await db
      .collection("payment_orders")
      .find({ booking_id: { $in: docs.map((d) => d.booking_id) } }, { projection: { booking_id: 1, refunds: 1 } })
      .toArray();
    const bookings = docs.map((d) => toDetails(d, orders.find((o) => o.booking_id === d.booking_id)));

    const pdf = await buildInvoicesPdf(bookings, raw);
    await audit(request, session, "invoices_download", { days: raw, count: bookings.length });

    const stamp = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
    return new Response(pdf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="SU-VILLA-invoices-last-${raw}-days-${stamp}.pdf"`,
        "Cache-Control": "no-store",
        "X-Invoice-Count": String(bookings.length),
      },
    });
  } catch (error) {
    console.error("Invoice export failed:", error);
    return jsonError("Unable to create the invoices PDF.", 500);
  }
}
