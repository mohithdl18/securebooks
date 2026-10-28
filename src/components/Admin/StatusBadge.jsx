const STYLES = {
  confirmed: "bg-green-50 text-green-800 border-green-200",
  cancelled: "bg-red-50 text-red-700 border-red-200",
  Paid: "bg-green-50 text-green-800 border-green-200",
  Refunded: "bg-[#052a50]/5 text-[#052a50] border-[#052a50]/15",
  "Refund pending": "bg-amber-50 text-amber-800 border-amber-200",
  booked: "bg-[#052a50] text-white border-[#052a50]",
  available: "bg-green-50 text-green-800 border-green-200",
  blocked: "bg-red-50 text-red-700 border-red-200",
  held: "bg-amber-50 text-amber-800 border-amber-200",
};
const LABELS = { confirmed: "Confirmed", cancelled: "Cancelled", booked: "Booked", available: "Available", blocked: "Blocked", held: "On hold" };

export default function StatusBadge({ value }) {
  const cls = STYLES[value] || "bg-white text-[#052a50]/70 border-[#052a50]/15";
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold ${cls}`}>
      {LABELS[value] || value || "—"}
    </span>
  );
}
